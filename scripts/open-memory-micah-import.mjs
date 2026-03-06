#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureParentDir, isoNow, parseCliArgs, readBoolFlag, readStringFlag, writeJson } from './lib/pst-memory-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

function usage() {
  process.stdout.write([
    'Open Memory Micah proposed import wrapper',
    '',
    'Usage:',
    '  node ./scripts/open-memory-micah-import.mjs --wave-root ./output/memory/production-wave-2026-03-06f --micah-root ./micah-v2',
    '',
    'Options:',
    '  --wave-root <path>      Production wave root',
    '  --micah-root <path>     Micah bundle root relative to wave root (default: ./micah)',
    '  --memory-root <path>    Local memory root (default: ./memory)',
    '  --input <path>          Override input JSONL path',
    '  --report <path>         Import ledger/report path',
    '  --json                  Print JSON report',
  ].join('\n'));
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { malformedLine: line };
    }
  });
}

function appendJsonl(path, records) {
  if (!records.length) return;
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  writeFileSync(path, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${body}\n`, 'utf8');
}

function text(value) {
  return String(value ?? '').trim();
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
  const micahRoot = resolve(waveRoot, readStringFlag(flags, 'micah-root', './micah'));
  const memoryRoot = resolve(REPO_ROOT, readStringFlag(flags, 'memory-root', './memory'));
  const inputPath = resolve(waveRoot, readStringFlag(flags, 'input', `${text(micahRoot).replace(`${waveRoot}/`, './')}/micah-memory-candidates.jsonl`));
  const reportPath = resolve(waveRoot, readStringFlag(flags, 'report', `${text(micahRoot).replace(`${waveRoot}/`, './')}/micah-import-ledger.json`));
  const printJson = readBoolFlag(flags, 'json', false);

  const proposedPath = resolve(memoryRoot, 'proposed/proposed.jsonl');
  const acceptedPath = resolve(memoryRoot, 'accepted/accepted.jsonl');
  if (!existsSync(inputPath)) throw new Error(`missing Micah candidate input: ${inputPath}`);

  const candidateRows = readJsonl(inputPath).filter((row) => !Object.prototype.hasOwnProperty.call(row, 'malformedLine'));
  const proposedRows = readJsonl(proposedPath).filter((row) => !Object.prototype.hasOwnProperty.call(row, 'malformedLine'));
  const acceptedRows = readJsonl(acceptedPath).filter((row) => !Object.prototype.hasOwnProperty.call(row, 'malformedLine'));

  const proposedIds = new Set(proposedRows.map((row) => text(row.id)).filter(Boolean));
  const acceptedIds = new Set(acceptedRows.map((row) => text(row.id)).filter(Boolean));

  const alreadyProposed = [];
  const alreadyAccepted = [];
  const toImport = [];

  for (const row of candidateRows) {
    const id = text(row.id);
    if (!id) continue;
    if (acceptedIds.has(id)) {
      alreadyAccepted.push(id);
      continue;
    }
    if (proposedIds.has(id)) {
      alreadyProposed.push(id);
      continue;
    }
    toImport.push({
      ...row,
      tags: Array.from(new Set([...(Array.isArray(row.tags) ? row.tags : []), 'micah', 'micah-bundle', 'quarantine'])),
      metadata: {
        ...(row.metadata || {}),
        quarantine: true,
        stagedBy: 'open-memory-micah-import',
        stagedAt: isoNow(),
      },
    });
  }

  ensureParentDir(proposedPath);
  appendJsonl(proposedPath, toImport);

  const report = {
    schema: 'open-memory-micah-import-ledger.v1',
    generatedAt: isoNow(),
    waveRoot,
    micahRoot,
    inputPath,
    memoryRoot,
    proposedPath,
    acceptedPath,
    scanned: candidateRows.length,
    imported: toImport.length,
    alreadyProposed: alreadyProposed.length,
    alreadyAccepted: alreadyAccepted.length,
    importedIds: toImport.map((row) => row.id),
    alreadyProposedIds: alreadyProposed,
    alreadyAcceptedIds: alreadyAccepted,
    posture: 'proposed-only-quarantine',
  };

  ensureParentDir(reportPath);
  writeJson(reportPath, report);

  if (printJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write('open-memory-micah-import complete\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`open-memory-micah-import failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
