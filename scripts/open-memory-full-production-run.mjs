#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function appendEvent(filePath, event) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`);
}

function nowIso() {
  return new Date().toISOString();
}

async function runChild({ cmd, args, cwd, logPath, env, onHeartbeat }) {
  ensureDir(path.dirname(logPath));
  const out = fs.createWriteStream(logPath, { flags: 'a' });
  const startedAt = Date.now();
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  let heartbeat = null;
  if (onHeartbeat) {
    heartbeat = setInterval(() => {
      onHeartbeat({ pid: child.pid, elapsedMs: Date.now() - startedAt, logPath });
    }, 15000);
  }
  const result = await new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  if (heartbeat) clearInterval(heartbeat);
  out.end();
  return result;
}

function summarizeDocsReport(report) {
  if (!report) return {};
  return {
    sourceUnits: report.sourceUnits ?? report.counts?.sourceUnits ?? null,
    analyzedRows: report.analyzedRows ?? report.counts?.analyzedRows ?? null,
    promotedRows: report.promotedRows ?? report.counts?.promotedRows ?? null,
  };
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const waveId = argv['wave-id'] || 'production-wave-2026-03-06e';
  const repoRoot = process.cwd();
  const waveRoot = path.resolve(argv['wave-root'] || path.join('output/memory', waveId));
  const fullRoot = waveRoot;
  const statusPath = path.resolve(argv['status'] || path.join(fullRoot, 'full-run-status.json'));
  const eventsPath = path.resolve(argv['events'] || path.join(fullRoot, 'full-run-events.jsonl'));
  const summaryJsonPath = path.resolve(path.join(fullRoot, 'full-run-summary.json'));
  const summaryMdPath = path.resolve(path.join(fullRoot, 'full-run-summary.md'));
  const docsSeedManifest = path.resolve(argv['docs-seed-manifest'] || 'imports/documents/runs/docs-production-wave-2026-03-06c/docs-metadata.json');
  const docsOutputManifest = path.resolve(argv['docs-output-manifest'] || 'imports/documents/runs/docs-production-wave-2026-03-06e/docs-metadata.json');
  const docsTargetCount = Number(argv['docs-target-count'] || 500);
  const docsMinCount = Number(argv['docs-min-count'] || 450);
  const mailFolderQueue = path.resolve(argv['mail-folder-queue'] || 'output/memory/production-wave-2026-03-06b-mail-unread-queue.json');
  const twitterInputDir = path.resolve(argv['twitter-input-dir'] || 'imports/zips-extracted/twitter-2022-11-05-ae20eb107636a73b2c164f5a827dd5896fc313b88cc28cdce7581ce5eb8ba2bb/data');
  const pstManifest = path.resolve(argv['reuse-pst-manifest'] || 'output/memory/pst-signal-quality-run-2026-03-06-finalcandidate/canonical-corpus/manifest.json');
  const mailSnapshotRoot = path.resolve(argv['mail-snapshot-root'] || 'output/memory/production-wave-2026-03-06b/sources/mail');
  const reuseTwitterRoot = argv['reuse-twitter-root'] ? path.resolve(argv['reuse-twitter-root']) : '';
  const reuseDocsRoot = argv['reuse-docs-root'] ? path.resolve(argv['reuse-docs-root']) : '';
  const heartbeatSeconds = Number(argv['heartbeat-seconds'] || 15);
  const aggregateSeed = String(argv['aggregate-audit-seed'] || '20260306');
  const aggregateSeedCount = Number(argv['aggregate-audit-seed-count'] || 16);

  ensureDir(fullRoot);

  const state = {
    schema: 'open-memory-full-production-run.v1',
    waveId,
    state: 'running',
    startedAt: nowIso(),
    updatedAt: nowIso(),
    currentPhase: 'preflight',
    elapsedMs: 0,
    phases: {
      docsExpansion: { status: 'pending' },
      productionWave: { status: 'pending' },
      crossSourceReview: { status: 'pending' },
      aggregateAudit: { status: 'pending' },
      spotAudit: { status: 'pending' },
      micahBundle: { status: 'pending' },
      micahImport: { status: 'pending' },
    },
  };

  function save() {
    state.updatedAt = nowIso();
    state.elapsedMs = Date.now() - Date.parse(state.startedAt);
    writeJson(statusPath, state);
  }

  function event(type, extra = {}) {
    appendEvent(eventsPath, { type, at: nowIso(), waveId, ...extra });
  }

  save();
  event('full_run_started', { statusPath, summaryJsonPath });

  const phaseConfig = [
    {
      key: 'docsExpansion',
      label: 'docs-expansion',
      logPath: path.join(fullRoot, 'docs-expansion.log'),
      cmd: 'node',
      args: [
        './scripts/document-metadata-expand.mjs',
        '--seed-manifest', docsSeedManifest,
        '--output', docsOutputManifest,
        '--mail-root', mailSnapshotRoot,
        '--pst-root', path.resolve('output/memory/pst-signal-quality-run-2026-03-06-finalcandidate/canonical-corpus'),
        '--target-count', String(docsTargetCount),
        '--min-count', String(docsMinCount),
        '--json',
      ],
      after: () => {
        const report = readJsonIfExists(docsOutputManifest.replace(/\.json$/i, '-expand-report.json'))
          || readJsonIfExists(path.join(path.dirname(docsOutputManifest), 'document-expand-report.json'))
          || null;
        state.phases.docsExpansion.reportPath = report ? (docsOutputManifest.replace(/\.json$/i, '-expand-report.json')) : null;
        state.phases.docsExpansion.outputManifest = docsOutputManifest;
        state.phases.docsExpansion.count = report?.count ?? report?.outputCount ?? null;
      },
    },
    {
      key: 'productionWave',
      label: 'production-wave',
      logPath: path.join(fullRoot, 'production-wave.log'),
      cmd: 'node',
      args: [
        './scripts/open-memory-production-wave.mjs',
        '--wave-id', waveId,
        '--output-root', fullRoot,
        '--mail-folder-queue', mailFolderQueue,
        '--twitter-input-dir', twitterInputDir,
        '--docs-input', docsOutputManifest,
        '--reuse-pst-manifest', pstManifest,
        '--mail-snapshot-root', mailSnapshotRoot,
        ...(reuseTwitterRoot ? ['--reuse-twitter-root', reuseTwitterRoot] : []),
        ...(reuseDocsRoot ? ['--reuse-docs-root', reuseDocsRoot] : []),
        '--heartbeat-seconds', String(heartbeatSeconds),
      ],
      after: () => {
        const summary = readJsonIfExists(path.join(fullRoot, 'wave-summary.json'));
        state.phases.productionWave.summaryPath = path.join(fullRoot, 'wave-summary.json');
        state.phases.productionWave.waveState = summary?.state ?? null;
      },
    },
    {
      key: 'crossSourceReview',
      label: 'cross-source-review',
      logPath: path.join(fullRoot, 'cross-source-review.log'),
      cmd: 'node',
      args: [
        './scripts/open-memory-cross-source-review.mjs',
        '--wave-root', fullRoot,
      ],
      after: () => {
        state.phases.crossSourceReview.reviewPath = path.join(fullRoot, 'cross-source-review.json');
      },
    },
    {
      key: 'aggregateAudit',
      label: 'aggregate-audit',
      logPath: path.join(fullRoot, 'aggregate-audit.log'),
      cmd: 'node',
      args: [
        './scripts/open-memory-production-audit.mjs',
        '--wave-root', fullRoot,
        '--docs-root', path.join(fullRoot, 'sources/docs'),
        '--mode', 'aggregate',
        '--seed', aggregateSeed,
        '--seed-count', String(aggregateSeedCount),
      ],
      after: () => {
        const audit = readJsonIfExists(path.join(fullRoot, 'expanded-audit.json'));
        state.phases.aggregateAudit.auditPath = path.join(fullRoot, 'expanded-audit.json');
        state.phases.aggregateAudit.highDriftFindings = audit?.highDriftFindings ?? null;
      },
    },
    {
      key: 'spotAudit',
      label: 'spot-audit',
      logPath: path.join(fullRoot, 'spot-audit.log'),
      cmd: 'node',
      args: [
        './scripts/open-memory-production-audit.mjs',
        '--wave-root', fullRoot,
        '--docs-root', path.join(fullRoot, 'sources/docs'),
        '--mode', 'spot',
        '--seed', aggregateSeed,
      ],
      after: () => {
        const audit = readJsonIfExists(path.join(fullRoot, 'spot-audit.json'));
        state.phases.spotAudit.auditPath = path.join(fullRoot, 'spot-audit.json');
        state.phases.spotAudit.findingCount = Array.isArray(audit?.findings) ? audit.findings.length : null;
      },
    },
    {
      key: 'micahBundle',
      label: 'micah-bundle',
      logPath: path.join(fullRoot, 'micah-bundle.log'),
      cmd: 'node',
      args: [
        './scripts/open-memory-micah-bundle.mjs',
        '--wave-root', fullRoot,
      ],
      after: () => {
        const report = readJsonIfExists(path.join(fullRoot, 'micah', 'micah-import-report.json'));
        state.phases.micahBundle.reportPath = path.join(fullRoot, 'micah', 'micah-import-report.json');
        state.phases.micahBundle.bundlePath = path.join(fullRoot, 'micah', 'micah-memory-bundle.json');
        state.phases.micahBundle.candidateCount = report?.candidateCounts?.totalCandidates ?? null;
      },
    },
    {
      key: 'micahImport',
      label: 'micah-import',
      logPath: path.join(fullRoot, 'micah-import.log'),
      cmd: 'node',
      args: [
        './scripts/open-memory-micah-import.mjs',
        '--wave-root', fullRoot,
      ],
      after: () => {
        const ledger = readJsonIfExists(path.join(fullRoot, 'micah', 'micah-import-ledger.json'));
        state.phases.micahImport.ledgerPath = path.join(fullRoot, 'micah', 'micah-import-ledger.json');
        state.phases.micahImport.imported = ledger?.imported ?? null;
        state.phases.micahImport.alreadyProposed = ledger?.alreadyProposed ?? null;
        state.phases.micahImport.alreadyAccepted = ledger?.alreadyAccepted ?? null;
      },
    },
  ];

  for (const phase of phaseConfig) {
    state.currentPhase = phase.label;
    state.phases[phase.key].status = 'running';
    state.phases[phase.key].startedAt = nowIso();
    save();
    event('phase_started', { phase: phase.label, logPath: phase.logPath });
    const result = await runChild({
      cmd: phase.cmd,
      args: phase.args,
      cwd: repoRoot,
      logPath: phase.logPath,
      onHeartbeat: ({ pid, elapsedMs, logPath }) => {
        state.currentPhase = phase.label;
        state.phases[phase.key].pid = pid;
        state.phases[phase.key].elapsedMs = elapsedMs;
        state.phases[phase.key].logPath = logPath;
        save();
        event('heartbeat', { phase: phase.label, pid, elapsedMs, logPath });
      },
    });
    state.phases[phase.key].finishedAt = nowIso();
    state.phases[phase.key].exitCode = result.code;
    state.phases[phase.key].signal = result.signal;
    state.phases[phase.key].logPath = phase.logPath;
    if (result.code !== 0) {
      state.phases[phase.key].status = 'failed';
      state.state = 'failed';
      save();
      event('phase_failed', { phase: phase.label, exitCode: result.code, signal: result.signal, logPath: phase.logPath });
      break;
    }
    state.phases[phase.key].status = 'completed';
    if (phase.after) phase.after();
    save();
    event('phase_completed', { phase: phase.label, logPath: phase.logPath });
  }

  if (state.state !== 'failed') {
    state.state = 'completed';
  }
  state.currentPhase = 'done';
  save();

  const docsReport = readJsonIfExists(docsOutputManifest.replace(/\.json$/i, '-expand-report.json'))
    || readJsonIfExists(path.join(path.dirname(docsOutputManifest), 'document-expand-report.json'))
    || null;
  const waveSummary = readJsonIfExists(path.join(fullRoot, 'wave-summary.json'));
  const crossSourceReview = readJsonIfExists(path.join(fullRoot, 'cross-source-review.json'));
  const expandedAudit = readJsonIfExists(path.join(fullRoot, 'expanded-audit.json'));
  const spotAudit = readJsonIfExists(path.join(fullRoot, 'spot-audit.json'));
  const micahBundle = readJsonIfExists(path.join(fullRoot, 'micah', 'micah-memory-bundle.json'));
  const micahReport = readJsonIfExists(path.join(fullRoot, 'micah', 'micah-import-report.json'));
  const micahLedger = readJsonIfExists(path.join(fullRoot, 'micah', 'micah-import-ledger.json'));

  const summary = {
    schema: 'open-memory-full-production-summary.v1',
    generatedAt: nowIso(),
    waveId,
    state: state.state,
    docsExpansion: {
      outputManifest: docsOutputManifest,
      count: docsReport?.count ?? docsReport?.outputCount ?? null,
      targetCount: docsTargetCount,
      minCount: docsMinCount,
    },
    productionWave: waveSummary,
    crossSourceReview: crossSourceReview ? {
      people: Array.isArray(crossSourceReview.people) ? crossSourceReview.people.length : null,
      organizations: Array.isArray(crossSourceReview.organizations) ? crossSourceReview.organizations.length : null,
      workstreams: Array.isArray(crossSourceReview.workstreams) ? crossSourceReview.workstreams.length : null,
      eras: Array.isArray(crossSourceReview.eras) ? crossSourceReview.eras.length : null,
    } : null,
    aggregateAudit: expandedAudit ? {
      highDriftFindings: expandedAudit.highDriftFindings ?? null,
      mailHighDriftFindings: expandedAudit.mailHighDriftFindings ?? null,
      twitterHighDriftFindings: expandedAudit.twitterHighDriftFindings ?? null,
      docsHighDriftFindings: expandedAudit.docsHighDriftFindings ?? null,
    } : null,
    spotAudit: spotAudit ? {
      findingCount: Array.isArray(spotAudit.findings) ? spotAudit.findings.length : null,
      highRiskCount: Array.isArray(spotAudit.findings) ? spotAudit.findings.filter((f) => f?.driftRisk === 'high').length : null,
    } : null,
    micahBundle: micahBundle ? {
      candidateCount: micahBundle?.summary?.totalCandidates ?? null,
      stableProfile: micahBundle?.summary?.stableProfile ?? null,
      relationshipChannels: micahBundle?.summary?.relationshipChannels ?? null,
      organizationWorkstreams: micahBundle?.summary?.organizationWorkstreams ?? null,
      eraAnchors: micahBundle?.summary?.eraAnchors ?? null,
      openLoops: micahBundle?.summary?.openLoops ?? null,
      bundlePath: path.join(fullRoot, 'micah', 'micah-memory-bundle.json'),
      reportPath: path.join(fullRoot, 'micah', 'micah-import-report.json'),
      warningCount: Array.isArray(micahReport?.warnings) ? micahReport.warnings.length : 0,
      imported: micahLedger?.imported ?? null,
      alreadyProposed: micahLedger?.alreadyProposed ?? null,
      alreadyAccepted: micahLedger?.alreadyAccepted ?? null,
    } : null,
    statusPath,
    eventsPath,
  };
  writeJson(summaryJsonPath, summary);

  const md = [
    `# Full Production Run Summary`,
    ``,
    `- Wave: \`${waveId}\``,
    `- State: \`${state.state}\``,
    ``,
    `## Docs expansion`,
    `- Output manifest: \`${docsOutputManifest}\``,
    `- Count: \`${summary.docsExpansion.count ?? 'unknown'}\` / target \`${docsTargetCount}\``,
    ``,
    `## Production wave`,
    `- Summary: \`${path.join(fullRoot, 'wave-summary.json')}\``,
    `- State: \`${waveSummary?.state ?? 'unknown'}\``,
    ``,
    `## Cross-source review`,
    `- People slice: \`${summary.crossSourceReview?.people ?? 'unknown'}\``,
    `- Organization slice: \`${summary.crossSourceReview?.organizations ?? 'unknown'}\``,
    `- Workstream slice: \`${summary.crossSourceReview?.workstreams ?? 'unknown'}\``,
    `- Era slice: \`${summary.crossSourceReview?.eras ?? 'unknown'}\``,
    ``,
    `## Aggregate audit`,
    `- High drift findings: \`${summary.aggregateAudit?.highDriftFindings ?? 'unknown'}\``,
    `- Mail: \`${summary.aggregateAudit?.mailHighDriftFindings ?? 'unknown'}\``,
    `- Twitter: \`${summary.aggregateAudit?.twitterHighDriftFindings ?? 'unknown'}\``,
    `- Docs: \`${summary.aggregateAudit?.docsHighDriftFindings ?? 'unknown'}\``,
    ``,
    `## Spot audit`,
    `- Finding count: \`${summary.spotAudit?.findingCount ?? 'unknown'}\``,
    `- High-risk findings: \`${summary.spotAudit?.highRiskCount ?? 'unknown'}\``,
    ``,
    `## Micah bundle`,
    `- Candidate count: \`${summary.micahBundle?.candidateCount ?? 'unknown'}\``,
    `- Stable profile: \`${summary.micahBundle?.stableProfile ?? 'unknown'}\``,
    `- Relationship channels: \`${summary.micahBundle?.relationshipChannels ?? 'unknown'}\``,
    `- Organizations/workstreams: \`${summary.micahBundle?.organizationWorkstreams ?? 'unknown'}\``,
    `- Era anchors: \`${summary.micahBundle?.eraAnchors ?? 'unknown'}\``,
    `- Open loops: \`${summary.micahBundle?.openLoops ?? 'unknown'}\``,
    `- Imported: \`${summary.micahBundle?.imported ?? 'unknown'}\``,
    `- Already proposed: \`${summary.micahBundle?.alreadyProposed ?? 'unknown'}\``,
    `- Already accepted: \`${summary.micahBundle?.alreadyAccepted ?? 'unknown'}\``,
  ].join('\n');
  fs.writeFileSync(summaryMdPath, `${md}\n`);

  event('full_run_completed', { state: state.state, summaryJsonPath, summaryMdPath });
  process.exit(state.state === 'failed' ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
