#!/usr/bin/env node

import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clipText,
  ensureParentDir,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readNumberFlag,
  readStringFlag,
  stableHash,
} from './lib/pst-memory-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

function usage() {
  process.stdout.write([
    'Document metadata manifest expansion',
    '',
    'Usage:',
    '  node ./scripts/document-metadata-expand.mjs \\',
    '    --seed-manifest ./imports/documents/runs/docs-production-wave-2026-03-06c/docs-metadata.json \\',
    '    --output ./imports/documents/runs/docs-production-wave-2026-03-06e/docs-metadata.json',
    '',
    'Options:',
    '  --seed-manifest <path>    Existing curated docs manifest',
    '  --output <path>           Expanded manifest output path',
    '  --mail-root <path>        Mail source root to mine attachment evidence from',
    '  --pst-root <path>         PST canonical corpus root to mine attachment evidence from',
    '  --target-count <n>        Target manifest size (default: 650)',
    '  --min-count <n>           Minimum acceptable expanded size (default: 600)',
    '  --json                    Print summary JSON',
  ].join('\n'));
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseSeedManifest(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
  throw new Error(`JSON input at ${filePath} must be an array or rows[] object`);
}

function walkFiles(root, matcher, found = []) {
  if (!existsSync(root)) return found;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = resolve(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, matcher, found);
    else if (matcher(full)) found.push(full);
  }
  return found;
}

function normalizeStem(value) {
  return text(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(copy|final|draft|revised|revision|v\d+|technical)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function isGenericAsset(name) {
  const stem = normalizeStem(name);
  return !stem || /^(image\d+|img_?\d+|logo|background|header|footer|signature|untitled attachment|photo|scan|document)$/i.test(stem);
}

function inferDocKind(title, contextText = '') {
  const hay = `${text(title)} ${text(contextText)}`.toLowerCase();
  if (/(resume|cv|curriculum|certification|study notes|training|reference contact)/.test(hay)) return 'career_artifact';
  if (/(vcard|address sheet|contact card|contact roster|family update|discussion notes)/.test(hay)) return 'relationship_artifact';
  if (/(quote|sow|statement of work|proposal|deck|datasheet|data sheet|runbook|checklist|agenda|playbook|one-sheet|partner profile|sell sheet)/.test(hay)) return 'document_artifact';
  if (/(invoice|bank|tax|insurance|receipt|call notes|notes)/.test(hay)) return 'life_admin';
  if (/(holiday|family|personal|creative|art|music|story)/.test(hay)) return 'identity_artifact';
  return 'document_artifact';
}

function inferCollection(docKind, contextText = '') {
  const hay = `${docKind} ${text(contextText)}`.toLowerCase();
  if (docKind === 'career_artifact') return 'career-development';
  if (docKind === 'relationship_artifact') return 'relationships';
  if (docKind === 'life_admin') return 'life-admin';
  if (/partner|marketing|collateral|profile|sell sheet|deck/.test(hay)) return 'work-marketing';
  if (/project|sow|runbook|checklist|agenda|delivery|services/.test(hay)) return 'work-project';
  if (docKind === 'identity_artifact') return 'personal-identity';
  return 'work-project';
}

function inferBucket(docKind, collection) {
  if (collection === 'work-project') return 'work_project';
  if (collection === 'work-marketing') return 'sales_partner';
  if (docKind === 'career_artifact') return 'career_training';
  if (collection === 'life-admin') return 'life_admin';
  if (docKind === 'relationship_artifact') return 'relationship';
  if (docKind === 'identity_artifact') return 'creative_personal';
  return 'work_project';
}

function inferEra(dateValue) {
  const normalized = text(dateValue);
  if (!normalized) return '';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized.slice(0, 4);
  return String(parsed.getUTCFullYear());
}

function extractOrganizations(values) {
  const orgs = new Set();
  for (const value of values) {
    const normalized = text(value).toLowerCase();
    const domainMatch = normalized.match(/@([a-z0-9.-]+\.[a-z]{2,})/);
    if (domainMatch) {
      const domain = domainMatch[1];
      const stem = domain.split('.').slice(0, -1).join('.') || domain;
      if (!/(gmail|hotmail|yahoo|outlook|icloud|live)\./.test(domain)) orgs.add(stem.replace(/[-_]+/g, ' '));
    }
  }
  return [...orgs].slice(0, 6).map((value) => value.replace(/\b\w/g, (char) => char.toUpperCase()));
}

function absorbCandidate(candidates, row) {
  const payload = row?.payload || {};
  const names = [
    ...safeArray(payload.attachmentRefs),
    ...safeArray(payload.attachmentMetadata?.attachmentNames),
  ].map(text).filter(Boolean);
  if (names.length === 0) return;
  const mimes = safeArray(payload.attachmentMetadata?.attachmentMimeTypes).map(text).filter(Boolean);
  const actors = safeArray(row?.actors).map((entry) => text(entry?.label)).filter(Boolean);
  const topics = safeArray(row?.topics).map(text).filter(Boolean);
  const rawText = text(payload.bodyExcerpt || payload.rawText || '');
  const contextText = `${topics.join(' ')} ${rawText}`;
  for (const name of names) {
    if (!name || isGenericAsset(name)) continue;
    const stem = normalizeStem(name);
    if (!stem) continue;
    const key = stableHash(`${stem}|${mimes[0] || ''}`);
    const current = candidates.get(key) || {
      title: text(name),
      names: new Set(),
      count: 0,
      mimeTypes: new Set(),
      actors: new Set(),
      organizations: new Set(),
      topics: new Set(),
      evidence: [],
      firstSeen: null,
      lastSeen: null,
      contexts: new Set(),
      contextTexts: [],
    };
    current.names.add(text(name));
    current.count += 1;
    if (mimes[0]) current.mimeTypes.add(mimes[0]);
    for (const actor of actors.slice(0, 8)) current.actors.add(actor);
    for (const org of extractOrganizations(actors)) current.organizations.add(org);
    for (const topic of topics.slice(0, 8)) current.topics.add(topic);
    const sourceId = text(row?.sourceId || row?.id);
    if (sourceId && current.evidence.length < 12) current.evidence.push(sourceId);
    const occurredAt = text(row?.occurredAt);
    if (occurredAt) {
      if (!current.firstSeen || occurredAt < current.firstSeen) current.firstSeen = occurredAt;
      if (!current.lastSeen || occurredAt > current.lastSeen) current.lastSeen = occurredAt;
    }
    const threadKey = text(row?.provenance?.sourceLocation?.threadKey || row?.provenance?.sourceLocation?.conversationId);
    if (threadKey) current.contexts.add(threadKey);
    if (contextText && current.contextTexts.length < 6) current.contextTexts.push(contextText);
    candidates.set(key, current);
  }
}

async function buildCandidateMap(sourceUnitPaths) {
  const candidates = new Map();
  for (const filePath of sourceUnitPaths) {
    const rl = createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed);
        absorbCandidate(candidates, row);
      } catch {
        continue;
      }
    }
  }
  return candidates;
}

function seedKey(row) {
  return text(row.sha256 || row.path || row.title || row.name).toLowerCase();
}

function makeCandidateRow(candidate) {
  const title = [...candidate.names].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] || candidate.title;
  const contextText = candidate.contextTexts.join(' ');
  const docKind = inferDocKind(title, contextText);
  const collection = inferCollection(docKind, contextText);
  const bucket = inferBucket(docKind, collection);
  const createdAt = candidate.firstSeen || null;
  const updatedAt = candidate.lastSeen || candidate.firstSeen || null;
  const eraLabel = inferEra(updatedAt || createdAt || '');
  const excerpt = clipText([
    candidate.count > 1 ? `${title} recurred ${candidate.count} times across existing source evidence.` : `${title} appears in existing source evidence.`,
    candidate.organizations.size > 0 ? `Organizations: ${[...candidate.organizations].slice(0, 3).join(', ')}.` : '',
    candidate.actors.size > 0 ? `People: ${[...candidate.actors].slice(0, 4).join(', ')}.` : '',
    candidate.topics.size > 0 ? `Topics: ${[...candidate.topics].slice(0, 4).join(', ')}.` : '',
  ].filter(Boolean).join(' '), 320);
  const ext = extname(title) || '';
  const syntheticPath = `curated/expanded/${collection}/${eraLabel || 'unknown'}/${slug(title)}${ext}`;
  const tags = [
    collection,
    docKind,
    candidate.count > 3 ? 'high-signal' : 'derived-candidate',
    ...(bucket === 'sales_partner' ? ['partner', 'collateral'] : []),
    ...(bucket === 'relationship' ? ['relationship', 'contact'] : []),
    ...(bucket === 'career_training' ? ['career', 'training'] : []),
    ...(bucket === 'life_admin' ? ['admin', 'timeline-anchor'] : []),
    ...(bucket === 'creative_personal' ? ['personal', 'identity'] : []),
  ];
  return {
    title,
    path: syntheticPath,
    mimeType: [...candidate.mimeTypes][0] || `application/${ext.replace(/^\./, '') || 'octet-stream'}`,
    sha256: `expanded-doc-${stableHash(`${title}|${syntheticPath}|${createdAt || ''}|${updatedAt || ''}`)}`,
    sizeBytes: 0,
    owner: null,
    authors: [],
    tags: [...new Set(tags)].filter(Boolean),
    createdAt,
    updatedAt,
    excerpt,
    collection,
    docKind,
    eraLabel,
    relatedPeople: [...candidate.actors].slice(0, 6),
    relatedOrganizations: [...candidate.organizations].slice(0, 6),
    sourceEvidence: candidate.evidence.slice(0, 12),
    _bucket: bucket,
    _score: candidate.count * 10 + candidate.contexts.size * 4 + candidate.organizations.size * 2 + candidate.actors.size,
  };
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, 'help', false) || readBoolFlag(flags, 'h', false)) {
    usage();
    return;
  }

  const seedManifestFlag = readStringFlag(flags, 'seed-manifest', '').trim();
  const outputFlag = readStringFlag(flags, 'output', '').trim();
  if (!seedManifestFlag) throw new Error('--seed-manifest is required');
  if (!outputFlag) throw new Error('--output is required');

  const seedManifestPath = resolve(REPO_ROOT, seedManifestFlag);
  const outputPath = resolve(REPO_ROOT, outputFlag);
  const mailRoot = resolve(REPO_ROOT, readStringFlag(flags, 'mail-root', './output/memory/production-wave-2026-03-06d/sources/mail'));
  const pstRoot = resolve(REPO_ROOT, readStringFlag(flags, 'pst-root', './output/memory/pst-signal-quality-run-2026-03-06-finalcandidate/canonical-corpus'));
  const targetCount = readNumberFlag(flags, 'target-count', 650, { min: 1, max: 5000 });
  const minCount = readNumberFlag(flags, 'min-count', 600, { min: 1, max: 5000 });
  const printJson = readBoolFlag(flags, 'json', false);

  const seedRows = parseSeedManifest(seedManifestPath).filter((row) => row && typeof row === 'object');
  const sourceUnitPaths = [
    ...walkFiles(mailRoot, (file) => file.endsWith('/canonical-corpus/source-units.jsonl')),
    ...walkFiles(pstRoot, (file) => file.endsWith('/source-units.jsonl')),
  ];
  const candidateMap = await buildCandidateMap(sourceUnitPaths);
  const candidates = [...candidateMap.values()].map(makeCandidateRow);

  const existingKeys = new Set(seedRows.map(seedKey));
  const bucketWeights = {
    work_project: 0.24,
    sales_partner: 0.14,
    career_training: 0.14,
    life_admin: 0.14,
    relationship: 0.17,
    creative_personal: 0.17,
  };
  const bucketTargets = Object.fromEntries(
    Object.entries(bucketWeights).map(([bucket, weight]) => [bucket, Math.round(targetCount * weight)])
  );
  const bucketed = new Map();
  for (const row of candidates) {
    const key = seedKey(row);
    if (existingKeys.has(key)) continue;
    const bucket = row._bucket || 'work_project';
    const current = bucketed.get(bucket) || [];
    current.push(row);
    bucketed.set(bucket, current);
  }
  for (const list of bucketed.values()) list.sort((a, b) => Number(b._score || 0) - Number(a._score || 0) || text(a.title).localeCompare(text(b.title)));

  const expanded = [...seedRows];
  const chosenKeys = new Set(existingKeys);
  for (const [bucket, desired] of Object.entries(bucketTargets)) {
    let remaining = desired;
    const pool = bucketed.get(bucket) || [];
    for (const row of pool) {
      if (expanded.length >= targetCount || remaining <= 0) break;
      const key = seedKey(row);
      if (chosenKeys.has(key)) continue;
      expanded.push(row);
      chosenKeys.add(key);
      remaining -= 1;
    }
  }

  const overflow = [...candidates].sort((a, b) => Number(b._score || 0) - Number(a._score || 0) || text(a.title).localeCompare(text(b.title)));
  for (const row of overflow) {
    if (expanded.length >= targetCount) break;
    const key = seedKey(row);
    if (chosenKeys.has(key)) continue;
    expanded.push(row);
    chosenKeys.add(key);
  }

  const finalRows = expanded.slice(0, targetCount).map((row) => {
    const { _bucket, _score, ...rest } = row;
    return rest;
  });

  if (finalRows.length < minCount) {
    throw new Error(`Expanded docs manifest only reached ${finalRows.length} rows; minimum is ${minCount}`);
  }

  ensureParentDir(outputPath);
  writeFileSync(outputPath, `${JSON.stringify(finalRows, null, 2)}\n`, 'utf8');

  const classSet = new Set(finalRows.map((row) => text(row.docKind)).filter(Boolean));
  const eraSet = new Set(finalRows.map((row) => text(row.eraLabel)).filter(Boolean));
  const summary = {
    schema: 'document-metadata-expand-report.v1',
    generatedAt: isoNow(),
    seedManifestPath,
    outputPath,
    mailRoot,
    pstRoot,
    targetCount,
    minCount,
    totals: {
      seedRows: seedRows.length,
      sourceUnitFiles: sourceUnitPaths.length,
      candidateRows: candidates.length,
      outputRows: finalRows.length,
      documentClasses: classSet.size,
      eraBuckets: eraSet.size,
    },
  };

  const reportPath = resolve(dirname(outputPath), 'document-expand-report.json');
  writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  if (printJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write('document-metadata-expand complete\n');
  process.stdout.write(`output: ${outputPath}\n`);
  process.stdout.write(`rows: ${finalRows.length}\n`);
}

main().catch((error) => {
  process.stderr.write(`document-metadata-expand failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
