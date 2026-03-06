#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clipText,
  ensureParentDir,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readJson,
  readJsonlWithRaw,
  readNumberFlag,
  readStringFlag,
  writeJson,
} from './lib/pst-memory-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

function usage() {
  process.stdout.write([
    'Open Memory cross-source review synthesis',
    '',
    'Usage:',
    '  node ./scripts/open-memory-cross-source-review.mjs --wave-root ./output/memory/production-wave-2026-03-06f',
    '',
    'Options:',
    '  --wave-root <path>      Production wave root',
    '  --output-json <path>    JSON output path',
    '  --output-md <path>      Markdown output path',
    '  --mail-sample <n>       Number of mail runs to scan (default: 12)',
    '  --json                  Print JSON output',
  ].join('\n'));
}

function text(value) {
  return String(value ?? '').trim();
}

function readJsonSafe(path, fallback = null) {
  try {
    if (!existsSync(path)) return fallback;
    return readJson(path, fallback);
  } catch {
    return fallback;
  }
}

function sourceRootFromManifest(manifestPath) {
  return text(manifestPath).replace(/\/canonical-corpus\/manifest\.json$/, '');
}

function promotedRows(path) {
  if (!existsSync(path)) return [];
  return readJsonlWithRaw(path).filter((entry) => entry?.ok).map((entry) => entry.value).filter(Boolean);
}

function normalizeKey(value) {
  return text(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function isWeakWorkstreamLabel(value) {
  const normalized = normalizeKey(value);
  if (!normalized) return true;
  if (/@/.test(normalized)) return true;
  if (/^(att\d+(\.[a-z0-9]{1,8})?|invite(\.ics)?|winmail\.dat|@)$/.test(normalized)) return true;
  if (/\b(image\d+|img\d+|photo\d+|logo|background|header|footer|signature|banner|avatar)\b/.test(normalized)) return true;
  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return true;
  if (['dspace', 'altuniv', 'avatar', 'digital', 'misc', 'untitled'].includes(normalized)) return true;
  return false;
}

function isWeakDocsArtifactLabel(value) {
  const normalized = normalizeKey(value);
  return isWeakWorkstreamLabel(normalized) || /\.(jpg|jpeg|png|gif|htm|html|ics)$/i.test(normalized);
}

function titleCase(value) {
  return text(value).replace(/\b\w/g, (char) => char.toUpperCase());
}

function maybeAdd(map, key, payload) {
  const normalized = normalizeKey(key);
  if (!normalized || normalized.length < 3) return;
  const current = map.get(normalized) || { label: text(key), count: 0, sourceFamilies: new Set(), refs: [] };
  current.count += 1;
  current.sourceFamilies.add(payload.sourceFamily);
  if (current.refs.length < 8) current.refs.push(payload.ref);
  map.set(normalized, current);
}

function collectFromDocs(docsRoot, peopleMap, orgMap, projectMap, eraMap) {
  const rows = promotedRows(resolve(docsRoot, 'document-promoted-memory.jsonl')).filter((row) => row?.metadata?.memoryLayer === 'semantic');
  for (const row of rows) {
    const metadata = row.metadata || {};
    if (isWeakDocsArtifactLabel(metadata.attachmentName || metadata.title || metadata.attachmentStem || '')) continue;
    const ref = {
      sourceFamily: 'docs',
      runRoot: docsRoot,
      recordId: row.id,
      analysisType: metadata.analysisType || metadata.docSignalKind || 'unknown',
      snippet: clipText(text(row.content), 220),
    };
    for (const person of metadata.relatedPeople || []) maybeAdd(peopleMap, person, { sourceFamily: 'docs', ref });
    for (const org of metadata.relatedOrganizations || []) maybeAdd(orgMap, org, { sourceFamily: 'docs', ref });
    const label = text(metadata.attachmentName || metadata.title || metadata.path || '');
    if (!isWeakWorkstreamLabel(label)) maybeAdd(projectMap, label, { sourceFamily: 'docs', ref });
    const year = text(row.occurredAt).slice(0, 4);
    if (year && /^\d{4}$/.test(year)) maybeAdd(eraMap, year, { sourceFamily: 'docs', ref });
  }
}

function collectFromTwitter(twitterRoot, peopleMap, orgMap, projectMap, eraMap) {
  const rows = promotedRows(resolve(twitterRoot, 'twitter-promoted-memory.jsonl')).filter((row) => row?.metadata?.memoryLayer === 'semantic');
  for (const row of rows) {
    const metadata = row.metadata || {};
    const ref = {
      sourceFamily: 'twitter',
      runRoot: twitterRoot,
      recordId: row.id,
      analysisType: metadata.analysisType || metadata.twitterSignalFamily || 'unknown',
      snippet: clipText(text(row.content), 220),
    };
    for (const participant of metadata.participants || []) maybeAdd(peopleMap, participant, { sourceFamily: 'twitter', ref });
    for (const mention of metadata.mentionedAccounts || []) maybeAdd(peopleMap, mention, { sourceFamily: 'twitter', ref });
    for (const hashtag of metadata.hashtags || []) maybeAdd(projectMap, hashtag, { sourceFamily: 'twitter', ref });
    const year = text(row.occurredAt).slice(0, 4);
    if (year && /^\d{4}$/.test(year)) maybeAdd(eraMap, year, { sourceFamily: 'twitter', ref });
  }
}

function collectFromMail(mailRuns, peopleMap, orgMap, projectMap, eraMap, limit) {
  const ranked = mailRuns
    .map((run) => {
      const manifest = readJsonSafe(run.manifestPath, {});
      return {
        run,
        facts: Number(manifest?.counts?.factEvents || 0),
        sourceUnits: Number(manifest?.counts?.sourceUnits || 0),
      };
    })
    .sort((a, b) => b.facts - a.facts || b.sourceUnits - a.sourceUnits)
    .slice(0, limit);

  for (const entry of ranked) {
    const root = sourceRootFromManifest(entry.run.manifestPath);
    const rows = promotedRows(resolve(root, 'mail-promoted-memory.jsonl')).filter((row) => row?.metadata?.memoryLayer === 'semantic');
    for (const row of rows) {
      const metadata = row.metadata || {};
      const ref = {
        sourceFamily: 'mail',
        runRoot: root,
        recordId: row.id,
        analysisType: metadata.analysisType || 'unknown',
        snippet: clipText(text(row.content), 220),
      };
      const content = text(row.content);
      const emailMatches = [...content.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)].map((m) => m[0]);
      for (const email of emailMatches.slice(0, 6)) {
        maybeAdd(peopleMap, email, { sourceFamily: 'mail', ref });
        const domain = email.split('@')[1];
        if (domain && !/(gmail|hotmail|yahoo|outlook|icloud|live)\./i.test(domain)) {
          maybeAdd(orgMap, domain.split('.').slice(0, -1).join('.') || domain, { sourceFamily: 'mail', ref });
        }
      }
      for (const collaborator of metadata.collaborators || []) maybeAdd(peopleMap, collaborator, { sourceFamily: 'mail', ref });
      for (const topic of metadata.topicTokens || []) {
        if (text(metadata.analysisType) === 'identity_mode_shift') continue;
        if (isWeakWorkstreamLabel(topic)) continue;
        maybeAdd(projectMap, topic, { sourceFamily: 'mail', ref });
      }
      const year = text(row.occurredAt).slice(0, 4);
      if (year && /^\d{4}$/.test(year)) maybeAdd(eraMap, year, { sourceFamily: 'mail', ref });
    }
  }
}

function topItems(map, limit = 10) {
  return [...map.values()]
    .map((value) => ({
      label: value.label,
      count: value.count,
      sourceFamilies: [...value.sourceFamilies].sort(),
      refs: value.refs,
    }))
    .sort((a, b) => b.sourceFamilies.length - a.sourceFamilies.length || b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function markdown(report) {
  const lines = [
    `# Cross-Source Review ${report.waveId}`,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `## Coverage`,
    '',
    `- Mail runs scanned: ${report.coverage.mailRunsScanned}`,
    `- Docs source: ${report.coverage.docsRoot}`,
    `- Twitter source: ${report.coverage.twitterRoot}`,
    '',
    `## People`,
    '',
  ];
  for (const item of report.people) lines.push(`- ${item.label} (${item.count}; ${item.sourceFamilies.join(', ')})`);
  lines.push('', '## Organizations', '');
  for (const item of report.organizations) lines.push(`- ${item.label} (${item.count}; ${item.sourceFamilies.join(', ')})`);
  lines.push('', '## Workstreams / topics', '');
  for (const item of report.workstreams) lines.push(`- ${item.label} (${item.count}; ${item.sourceFamilies.join(', ')})`);
  lines.push('', '## Eras', '');
  for (const item of report.eras) lines.push(`- ${item.label} (${item.count}; ${item.sourceFamilies.join(', ')})`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, 'help', false) || readBoolFlag(flags, 'h', false)) {
    usage();
    return;
  }
  const waveRootFlag = readStringFlag(flags, 'wave-root', '').trim();
  if (!waveRootFlag) throw new Error('--wave-root is required');
  const waveRoot = resolve(REPO_ROOT, waveRootFlag);
  const outputJson = resolve(waveRoot, readStringFlag(flags, 'output-json', './cross-source-review.json'));
  const outputMd = resolve(waveRoot, readStringFlag(flags, 'output-md', './cross-source-review.md'));
  const mailSample = readNumberFlag(flags, 'mail-sample', 12, { min: 1, max: 30 });
  const printJson = readBoolFlag(flags, 'json', false);

  const catalog = readJsonSafe(resolve(waveRoot, 'ingest-catalog.json'));
  if (!catalog || !Array.isArray(catalog.runs)) throw new Error('ingest-catalog.json missing or invalid');
  const docsRun = catalog.runs.find((run) => run.sourceFamily === 'docs');
  const twitterRun = catalog.runs.find((run) => run.sourceFamily === 'twitter');
  const mailRuns = catalog.runs.filter((run) => run.sourceFamily === 'mail' && run.status === 'completed');
  if (!docsRun) throw new Error('No docs run found in catalog');
  if (!twitterRun) throw new Error('No twitter run found in catalog');

  const docsRoot = sourceRootFromManifest(docsRun.manifestPath);
  const twitterRoot = sourceRootFromManifest(twitterRun.manifestPath);

  const peopleMap = new Map();
  const orgMap = new Map();
  const projectMap = new Map();
  const eraMap = new Map();

  collectFromDocs(docsRoot, peopleMap, orgMap, projectMap, eraMap);
  collectFromTwitter(twitterRoot, peopleMap, orgMap, projectMap, eraMap);
  collectFromMail(mailRuns, peopleMap, orgMap, projectMap, eraMap, mailSample);

  const report = {
    schema: 'open-memory-cross-source-review.v1',
    generatedAt: isoNow(),
    waveId: text(waveRoot).split('/').filter(Boolean).pop(),
    waveRoot,
    coverage: {
      mailRunsScanned: Math.min(mailSample, mailRuns.length),
      docsRoot,
      twitterRoot,
    },
    people: topItems(peopleMap, 12),
    organizations: topItems(orgMap, 12),
    workstreams: topItems(projectMap, 12),
    eras: topItems(eraMap, 12),
  };

  ensureParentDir(outputJson);
  writeJson(outputJson, report);
  ensureParentDir(outputMd);
  writeFileSync(outputMd, markdown(report), 'utf8');

  if (printJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write('open-memory-cross-source-review complete\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`open-memory-cross-source-review failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
