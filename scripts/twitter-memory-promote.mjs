#!/usr/bin/env node

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clipText,
  isoNow,
  normalizeWhitespace,
  parseCliArgs,
  readBoolFlag,
  readJsonlWithRaw,
  readNumberFlag,
  readStringFlag,
  stableHash,
  writeJson,
  writeJsonl,
} from './lib/pst-memory-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const AFFINITY_BAD_TOKENS = new Set(['item','url','this','you','the','are','all','who','but','how','one','can','was','has','new','people']);

function usage() {
  process.stdout.write([
    'Twitter native promote stage',
    '',
    'Usage:',
    '  node ./scripts/twitter-memory-promote.mjs --input ./output/memory/twitter-analysis-memory.jsonl --output ./output/memory/twitter-promoted-memory.jsonl',
    '',
    'Options:',
    '  --input <path>        Analysis JSONL input',
    '  --output <path>       Promoted JSONL output',
    '  --dead-letter <path>  Dropped rows JSONL',
    '  --report <path>       Report JSON output',
    '  --max-output <n>      Max promoted rows (default: 60)',
    '  --json                Print report JSON',
  ].join('\n'));
}

function confidenceFromScore(score) {
  return Number(Math.max(0, Math.min(1, Number(score || 0) / 12)).toFixed(3));
}

function deriveMemoryId(clientRequestId) {
  return `mem_req_${stableHash(String(clientRequestId || ''))}`;
}

function familyForRow(row) {
  return normalizeWhitespace(row?.metadata?.twitterSignalFamily || row?.metadata?.signalFamily || 'unknown') || 'unknown';
}

function quotaPlan(maxOutput) {
  return {
    public_expression: Math.min(20, maxOutput),
    relationship_signal: Math.min(12, maxOutput),
    conversation_signal: Math.min(10, maxOutput),
    identity_time: Math.min(8, maxOutput),
    affinity_signal: Math.min(8, maxOutput),
    media_signal: Math.min(4, maxOutput),
  };
}

function thresholdsForFamily(family) {
  if (family === 'public_expression') return { semantic: 8, episodic: 6 };
  if (family === 'relationship_signal') return { semantic: 7, episodic: 5 };
  if (family === 'conversation_signal') return { semantic: 6, episodic: 4 };
  if (family === 'identity_time') return { semantic: 6, episodic: 4 };
  if (family === 'affinity_signal') return { semantic: 6, episodic: 4 };
  if (family === 'media_signal') return { semantic: 6, episodic: 3 };
  return { semantic: 7, episodic: 4 };
}

function shouldReject(row, family) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  if (family === 'affinity_signal') {
    const token = String((Array.isArray(metadata.topicTokens) ? metadata.topicTokens[0] : '') || '').replace(/^[@#]/, '').toLowerCase();
    if (!token || AFFINITY_BAD_TOKENS.has(token)) return 'generic_affinity_token';
  }
  return null;
}

function shouldBeSemantic(row, family, score) {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const thresholds = thresholdsForFamily(family);
  if (score < thresholds.episodic) return null;
  if (family === 'media_signal') {
    return score >= thresholds.semantic && Number(metadata.attachmentCount || 0) >= 100;
  }
  return score >= thresholds.semantic;
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, 'help', false) || readBoolFlag(flags, 'h', false)) {
    usage();
    return;
  }

  const inputPath = resolve(REPO_ROOT, readStringFlag(flags, 'input', './output/memory/twitter-analysis-memory.jsonl'));
  const outputPath = resolve(REPO_ROOT, readStringFlag(flags, 'output', './output/memory/twitter-promoted-memory.jsonl'));
  const deadLetterPath = resolve(REPO_ROOT, readStringFlag(flags, 'dead-letter', './output/memory/twitter-promote-dead-letter.jsonl'));
  const reportPath = resolve(REPO_ROOT, readStringFlag(flags, 'report', './output/memory/twitter-promote-report.json'));
  const maxOutput = readNumberFlag(flags, 'max-output', 60, { min: 1, max: 2000 });
  const maxContentChars = readNumberFlag(flags, 'max-content-chars', 1800, { min: 200, max: 20000 });
  const printJson = readBoolFlag(flags, 'json', false);

  const rows = readJsonlWithRaw(inputPath);
  const malformed = [];
  const valid = [];
  for (const row of rows) {
    if (!row.ok || !row.value || typeof row.value !== 'object') {
      malformed.push({ stage: 'promote', reason: 'malformed_jsonl_row', raw: row.raw });
      continue;
    }
    if (!normalizeWhitespace(row.value.content || '')) {
      malformed.push({ stage: 'promote', reason: 'missing_content', raw: row.raw });
      continue;
    }
    valid.push(row.value);
  }

  const plan = quotaPlan(maxOutput);
  const buckets = new Map();
  for (const row of valid) {
    const family = familyForRow(row);
    const list = buckets.get(family) || [];
    const score = Number(row?.metadata?.score || 0);
    list.push({ row, family, score });
    buckets.set(family, list);
  }
  for (const list of buckets.values()) list.sort((a, b) => b.score - a.score);

  const promoted = [];
  const dropped = [...malformed];
  const decisionMatrix = {};
  const quotaUsage = {};
  let semanticRows = 0;
  let episodicRows = 0;

  const pushDrop = (item, reason) => {
    decisionMatrix[item.family] = decisionMatrix[item.family] || {};
    quotaUsage[item.family] = quotaUsage[item.family] || { promoted: 0, semantic: 0, episodic: 0, dropped: 0 };
    decisionMatrix[item.family][reason] = Number(decisionMatrix[item.family][reason] || 0) + 1;
    quotaUsage[item.family].dropped += 1;
    dropped.push({ stage: 'promote', reason, signalFamily: item.family, score: item.score, content: item.row.content, metadata: item.row.metadata || {} });
  };

  for (const family of ['public_expression', 'relationship_signal', 'conversation_signal', 'identity_time', 'affinity_signal', 'media_signal']) {
    const quota = Number(plan[family] || 0);
    const bucket = buckets.get(family) || [];
    quotaUsage[family] = quotaUsage[family] || { promoted: 0, semantic: 0, episodic: 0, dropped: 0 };
    for (const item of bucket.slice(0, quota)) {
      if (promoted.length >= maxOutput) {
        pushDrop(item, 'max_output_exceeded');
        continue;
      }
      const rejectReason = shouldReject(item.row, family);
      if (rejectReason) {
        pushDrop(item, rejectReason);
        continue;
      }
      const semanticDecision = shouldBeSemantic(item.row, family, item.score);
      if (semanticDecision === null) {
        pushDrop(item, 'below_episodic_min_score');
        continue;
      }
      const memoryLayer = semanticDecision ? 'semantic' : 'episodic';
      const metadata = {
        ...(item.row.metadata && typeof item.row.metadata === 'object' ? item.row.metadata : {}),
        memoryLayer,
        confidence: confidenceFromScore(item.score),
        analysisVersion: 'twitter-analysis.v2',
        policyVersion: 'twitter-memory-promotion.v3',
      };
      const clientRequestId = String(item.row.clientRequestId || '').trim() || `twitter-promoted-${stableHash(item.row.content || '')}`;
      promoted.push({
        id: deriveMemoryId(clientRequestId),
        content: clipText(item.row.content, maxContentChars),
        source: 'social:twitter-export:promoted-memory',
        tags: Array.isArray(item.row.tags) ? item.row.tags.map((tag) => String(tag)) : [],
        metadata,
        occurredAt: item.row.occurredAt || undefined,
        clientRequestId,
      });
      quotaUsage[family].promoted += 1;
      if (memoryLayer === 'semantic') {
        quotaUsage[family].semantic += 1;
        semanticRows += 1;
      } else {
        quotaUsage[family].episodic += 1;
        episodicRows += 1;
      }
    }
    for (const item of bucket.slice(quota)) pushDrop(item, 'family_quota_exceeded');
  }

  writeJsonl(outputPath, promoted);
  writeJsonl(deadLetterPath, dropped);
  const report = {
    schema: 'twitter-memory-promote-report.v3',
    generatedAt: isoNow(),
    inputPath,
    outputPath,
    deadLetterPath,
    quotaPlan: plan,
    counts: {
      inputRows: rows.length,
      validRows: valid.length,
      promotedRows: promoted.length,
      semanticRows,
      episodicRows,
      droppedRows: dropped.length,
      malformedRows: malformed.length,
    },
    decisionMatrix,
    quotaUsage,
  };
  writeJson(reportPath, report);
  if (printJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try { run(); } catch (error) {
  process.stderr.write(`twitter-memory-promote failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
