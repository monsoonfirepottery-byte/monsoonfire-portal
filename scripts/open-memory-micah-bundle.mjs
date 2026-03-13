#!/usr/bin/env node

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clipText,
  ensureParentDir,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readJson,
  readStringFlag,
  writeJson,
} from './lib/pst-memory-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

function usage() {
  process.stdout.write([
    'Open Memory Micah bundle synthesis',
    '',
    'Usage:',
    '  node ./scripts/open-memory-micah-bundle.mjs --wave-root ./output/memory/production-wave-2026-03-06f',
    '',
    'Options:',
    '  --wave-root <path>      Production wave root',
    '  --output-root <path>    Output root (default: <wave-root>/micah)',
    '  --output-json <path>    Structured JSON bundle path',
    '  --output-md <path>      Markdown bundle path',
    '  --output-jsonl <path>   Import-ready JSONL path',
    '  --review-json <path>    Review JSON path',
    '  --review-md <path>      Review Markdown path',
    '  --report <path>         Import report path',
    '  --json                  Print JSON report',
  ].join('\n'));
}

function text(value) {
  return String(value ?? '').trim();
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!existsSync(filePath)) return fallback;
    return readJson(filePath, fallback);
  } catch {
    return fallback;
  }
}

function normalizeKey(value) {
  return text(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function slug(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}

function scoreFromSourceFamilies(sourceFamilies) {
  return sourceFamilies.length >= 3 ? 0.89 : sourceFamilies.length === 2 ? 0.82 : 0.72;
}

function buildSelfSet() {
  return new Set([
    'micah@micahwyenn.com',
    'mwyenn@gocmt.com',
    '@itsawuff',
    'itsawuff',
    'micah',
    'wuff',
    'micahwyenn',
  ]);
}

function refsFromItem(item) {
  const refs = Array.isArray(item?.refs) ? item.refs : [];
  return refs.slice(0, 6).map((ref) => ({
    sourceFamily: text(ref?.sourceFamily),
    runRoot: text(ref?.runRoot),
    recordId: text(ref?.recordId),
    analysisType: text(ref?.analysisType),
    snippet: clipText(text(ref?.snippet), 220),
  })).filter((ref) => (ref.recordId || ref.runRoot || ref.analysisType) && !isLowSignalRef(ref));
}

function rankItems(items, limit) {
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .sort((a, b) => (b.sourceFamilies?.length || 0) - (a.sourceFamilies?.length || 0) || (b.count || 0) - (a.count || 0) || text(a.label).localeCompare(text(b.label)))
    .slice(0, limit);
}

function latestEras(eras, count = 2) {
  return [...eras]
    .filter((item) => /^\d{4}$/.test(text(item.label)))
    .sort((a, b) => Number(b.label) - Number(a.label))
    .slice(0, count);
}

function isSelfLike(label, selfSet) {
  const normalized = normalizeKey(label);
  return selfSet.has(normalized)
    || normalized.includes('micahwyenn')
    || normalized.includes('@itsawuff')
    || normalized === 'micah';
}

function isSystemContact(label) {
  const normalized = normalizeKey(label);
  return /dailystatusreports|statusreports|noreply|no-reply|do-not-reply|donotreply|support|alerts|reports|admin|mailer-daemon|postmaster/.test(normalized);
}

function isArtifactNoise(label) {
  const normalized = normalizeKey(label);
  return !normalized
    || /@/.test(normalized)
    || /^att\d+/i.test(normalized)
    || /^invite(\.ics)?$/i.test(normalized)
    || /^winmail\.dat$/i.test(normalized)
    || /\b(image|img|logo|background|signature|header|footer|avatar)\b/.test(normalized)
    || /\.(jpg|jpeg|png|gif|htm|html|txt|xml)$/i.test(normalized)
    || /^[a-z0-9_-]{1,10}\.(jpg|jpeg|png|gif|htm|html)$/i.test(normalized);
}

function isWeakTokenLabel(label) {
  const normalized = normalizeKey(label);
  return ['digital', 'dspace', 'altuniv', 'misc', 'untitled'].includes(normalized);
}

function isActionableOrganization(label, selfSet) {
  const normalized = normalizeKey(label);
  if (!normalized) return false;
  if (isSelfLike(normalized, selfSet)) return false;
  if (isArtifactNoise(normalized)) return false;
  if (isWeakTokenLabel(normalized)) return false;
  if (/\s/.test(label)) return true;
  return /^[a-z][a-z0-9]+$/i.test(label) && label.length >= 5;
}

function isActionableWorkstream(label) {
  const raw = text(label);
  const normalized = normalizeKey(label);
  if (!normalized) return false;
  if (/@/.test(normalized)) return false;
  if (isArtifactNoise(normalized)) return false;
  if (isWeakTokenLabel(normalized)) return false;
  if (/\b(demo|requirements|runbook|roadmap|proposal|deck|notes|assumptions|memo|brief|training|partner|operations|call notes|certification|timeline|reference|intro)\b/i.test(raw)) return true;
  return /\s/.test(raw) && raw.length >= 10;
}

function isLowSignalRef(ref) {
  const snippet = normalizeKey(ref?.snippet);
  if (!snippet) return false;
  return /att\d+\.(htm|html)|invite\.ics|winmail\.dat|\bimage\d+\b|\blogo\b|\bbackground\b|\bavatar\b/.test(snippet)
    || /workstream artifact: @\b/.test(snippet)
    || /\b1jordanm\.jpg\b/.test(snippet);
}

function makeCandidate({ family, statement, confidence, tags = [], sourceFamilies = [], refs = [], temporalScope = null, ongoing = false, groundedness = 'high', driftRisk = 'low', rationale = '' }) {
  const id = `micah_${family}_${slug(statement).slice(0, 48)}`;
  return {
    id,
    family,
    statement,
    confidence: Math.max(0, Math.min(1, Number(confidence || 0.75))),
    tags,
    sourceFamilies,
    recordRefs: refs,
    runRoots: [...new Set(refs.map((ref) => text(ref.runRoot)).filter(Boolean))],
    temporalScope,
    ongoing,
    groundedness,
    driftRisk,
    rationale: text(rationale),
  };
}

function toImportRecord(candidate, waveId) {
  return {
    id: candidate.id,
    statement: candidate.statement,
    source: 'micah-bundle',
    confidence: candidate.confidence,
    tags: ['micah', 'micah-bundle', 'quarantine', candidate.family, ...candidate.tags, `wave:${waveId}`],
    provenance: {
      ingest: true,
      waveId,
      bundle: 'micah-memory-bundle',
    },
    metadata: {
      candidateFamily: candidate.family,
      quarantine: true,
      waveId,
      sourceFamilies: candidate.sourceFamilies,
      recordRefs: candidate.recordRefs,
      runRoots: candidate.runRoots,
      groundedness: candidate.groundedness,
      driftRisk: candidate.driftRisk,
      temporalScope: candidate.temporalScope,
      ongoing: candidate.ongoing,
      rationale: candidate.rationale,
    },
  };
}

function markdown(bundle) {
  const lines = [
    '# Micah Memory Bundle',
    '',
    `Generated: ${bundle.generatedAt}`,
    `Wave: ${bundle.waveId}`,
    `Version: ${bundle.bundleVersion}`,
    '',
    '## Summary',
    '',
    `- Stable profile signals: ${bundle.stableProfile.length}`,
    `- Relationship channels: ${bundle.relationshipChannels.length}`,
    `- Organizations/workstreams: ${bundle.organizationWorkstreams.length}`,
    `- Era anchors: ${bundle.eraAnchors.length}`,
    `- Open loops: ${bundle.openLoops.length}`,
    `- Import candidates: ${bundle.importCandidates.length}`,
    '',
  ];

  const sections = [
    ['Stable profile', bundle.stableProfile],
    ['Relationship channels', bundle.relationshipChannels],
    ['Organizations / workstreams', bundle.organizationWorkstreams],
    ['Era anchors', bundle.eraAnchors],
    ['Open loops', bundle.openLoops],
  ];

  for (const [title, items] of sections) {
    lines.push(`## ${title}`);
    lines.push('');
    for (const item of items) {
      lines.push(`- ${item.statement}`);
      lines.push(`  - confidence: ${item.confidence}`);
      lines.push(`  - source families: ${(item.sourceFamilies || []).join(', ') || 'unknown'}`);
      if (item.temporalScope) lines.push(`  - temporal scope: ${item.temporalScope}`);
      if (item.ongoing) lines.push('  - ongoing: true');
      if (item.rationale) lines.push(`  - rationale: ${item.rationale}`);
    }
    lines.push('');
  }

  lines.push('## Guarded background note');
  lines.push('');
  lines.push(`- ${bundle.guardedBackgroundNote.statement}`);
  lines.push(`  - caveat: ${bundle.guardedBackgroundNote.caveat}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function reviewMarkdown(review) {
  const lines = [
    '# Micah Bundle Review',
    '',
    `Generated: ${review.generatedAt}`,
    `Wave: ${review.waveId}`,
    `Bundle version: ${review.bundleVersion}`,
    '',
    '## Ready for proposed quarantine',
    '',
    `- Count: ${review.readyForProposed.count}`,
    `- Families: ${Object.entries(review.readyForProposed.byFamily).map(([key, value]) => `${key}=${value}`).join(', ')}`,
    '',
    '## Filtered classes',
    '',
    ...Object.entries(review.filteredOut).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Top open loops',
    '',
    ...(review.topOpenLoops || []).map((item) => `- ${item.statement}`),
  ];
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
  const outputRoot = resolve(waveRoot, readStringFlag(flags, 'output-root', './micah'));
  const outputJson = resolve(waveRoot, readStringFlag(flags, 'output-json', './micah/micah-memory-bundle.json'));
  const outputMd = resolve(waveRoot, readStringFlag(flags, 'output-md', './micah/micah-memory-bundle.md'));
  const outputJsonl = resolve(waveRoot, readStringFlag(flags, 'output-jsonl', './micah/micah-memory-candidates.jsonl'));
  const reviewJson = resolve(waveRoot, readStringFlag(flags, 'review-json', './micah/micah-review.json'));
  const reviewMd = resolve(waveRoot, readStringFlag(flags, 'review-md', './micah/micah-review.md'));
  const reportPath = resolve(waveRoot, readStringFlag(flags, 'report', './micah/micah-import-report.json'));
  const printJson = readBoolFlag(flags, 'json', false);

  const catalog = readJsonSafe(resolve(waveRoot, 'ingest-catalog.json'));
  const review = readJsonSafe(resolve(waveRoot, 'production-review.json'));
  const crossSource = readJsonSafe(resolve(waveRoot, 'cross-source-review.json'));
  const productionAudit = readJsonSafe(resolve(waveRoot, 'production-audit.json'));
  const expandedAudit = readJsonSafe(resolve(waveRoot, 'expanded-audit.json'));
  const analystContext = readJsonSafe(resolve(REPO_ROOT, 'config/analyst-context.assumptions.json'), {});

  if (!catalog || !Array.isArray(catalog.runs)) throw new Error('ingest-catalog.json missing or invalid');
  if (!review) throw new Error('production-review.json missing or invalid');
  if (!crossSource) throw new Error('cross-source-review.json missing or invalid');

  const waveId = text(catalog.waveId || review.waveId || crossSource.waveId || waveRoot.split('/').filter(Boolean).pop());
  const selfSet = buildSelfSet();
  const highDriftRunRoots = new Set(Object.entries(expandedAudit?.summary?.byRunRoot || {}).filter(([, count]) => Number(count) > 0).map(([runRoot]) => runRoot));
  const highDriftRecordIds = new Set((productionAudit?.findings || []).filter((finding) => text(finding.driftRisk) === 'high').map((finding) => text(finding.recordId)).filter(Boolean));

  const filteredOut = {
    selfLikePeople: 0,
    systemContacts: 0,
    lowSignalOrganizations: 0,
    lowSignalWorkstreams: 0,
    historicalOpenLoopsDropped: 0,
    lowSignalEvidenceRefs: 0,
  };

  const people = [];
  for (const item of rankItems(crossSource.people || [], 20)) {
    if (isSelfLike(item.label, selfSet)) {
      filteredOut.selfLikePeople += 1;
      continue;
    }
    if (isSystemContact(item.label)) {
      filteredOut.systemContacts += 1;
      continue;
    }
    people.push(item);
  }

  const organizations = [];
  for (const item of rankItems(crossSource.organizations || [], 20)) {
    if (!isActionableOrganization(item.label, selfSet)) {
      filteredOut.lowSignalOrganizations += 1;
      continue;
    }
    organizations.push(item);
  }

  const workstreams = [];
  for (const item of rankItems(crossSource.workstreams || [], 24)) {
    if (!isActionableWorkstream(item.label)) {
      filteredOut.lowSignalWorkstreams += 1;
      continue;
    }
    workstreams.push(item);
  }

  const eras = rankItems(crossSource.eras || [], 10);
  const docsSummary = (review.sourceSummaries || []).find((entry) => text(entry.sourceFamily) === 'docs') || {};

  const stableProfile = [];
  const relationshipChannels = [];
  const organizationWorkstreams = [];
  const eraAnchors = [];
  const openLoops = [];

  if ((docsSummary.runCount || 0) >= 1 && (workstreams.length >= 3 || organizations.length >= 3)) {
    stableProfile.push(makeCandidate({
      family: 'stable_profile',
      statement: 'Micah tends to externalize important thinking into durable artifacts such as decks, notes, runbooks, and reference documents.',
      confidence: 0.88,
      tags: ['workstyle', 'documents', 'externalized-thinking'],
      sourceFamilies: ['docs', 'mail', 'pst'],
      refs: [...refsFromItem(workstreams[0] || {}), ...refsFromItem(workstreams[1] || {})].slice(0, 6),
      rationale: 'Docs and cross-source workstream signals are dense and recurrent across the active wave.',
    }));
  }

  if (people.length >= 3) {
    stableProfile.push(makeCandidate({
      family: 'stable_profile',
      statement: 'Micah appears to sustain a smaller number of deep recurring channels rather than a very broad set of equally strong relationships.',
      confidence: 0.84,
      tags: ['relationships', 'recurrence'],
      sourceFamilies: ['mail', 'pst'],
      refs: people.flatMap((item) => refsFromItem(item)).slice(0, 6),
      rationale: 'Top people in cross-source review are concentrated into a few recurring channels with strong mail support.',
    }));
  }

  if (eras.length >= 4) {
    stableProfile.push(makeCandidate({
      family: 'stable_profile',
      statement: 'Micah’s history reads as phase-based, with recurring shifts in collaborators, context, and operating mode across distinct eras.',
      confidence: 0.81,
      tags: ['timeline', 'identity', 'era-shifts'],
      sourceFamilies: ['pst', 'mail', 'docs'],
      refs: eras.flatMap((item) => refsFromItem(item)).slice(0, 6),
      rationale: 'Cross-source era anchors are clustered and repeated rather than forming a smooth continuous curve.',
    }));
  }

  if (workstreams.length >= 4) {
    stableProfile.push(makeCandidate({
      family: 'stable_profile',
      statement: 'Micah often builds shared understanding through alignment artifacts meant to orient other people, not just private notes for himself.',
      confidence: 0.83,
      tags: ['collaboration', 'alignment', 'workstyle'],
      sourceFamilies: ['docs', 'mail'],
      refs: workstreams.flatMap((item) => refsFromItem(item)).slice(0, 6),
      rationale: 'Workstream and document-family signals skew toward partner decks, runbooks, memos, and reference packets.',
    }));
  }

  if ((catalog.runCount || 0) >= 90) {
    stableProfile.push(makeCandidate({
      family: 'stable_profile',
      statement: 'Micah leaves a comparatively strong paper trail around meaningful work and relationship transitions, which makes continuity unusually reconstructable from evidence.',
      confidence: 0.79,
      tags: ['continuity', 'history', 'provenance'],
      sourceFamilies: ['pst', 'mail', 'docs', 'twitter'],
      refs: [...people.flatMap((item) => refsFromItem(item)), ...workstreams.flatMap((item) => refsFromItem(item))].slice(0, 6),
      rationale: 'All four source families are populated and support continuity reconstruction.',
    }));
  }

  for (const item of people.slice(0, 10)) {
    const refs = refsFromItem(item).filter((ref) => !highDriftRunRoots.has(ref.runRoot) && !highDriftRecordIds.has(ref.recordId));
    if (refs.length === 0) {
      filteredOut.lowSignalEvidenceRefs += 1;
      continue;
    }
    relationshipChannels.push(makeCandidate({
      family: 'relationship_channel',
      statement: `Recurring relationship channel: ${item.label} appears as a persistent contact across ${item.sourceFamilies.join(', ')} evidence.`,
      confidence: scoreFromSourceFamilies(item.sourceFamilies || []),
      tags: ['relationship', 'channel'],
      sourceFamilies: item.sourceFamilies || [],
      refs,
      rationale: `Cross-source recurrence count ${item.count} with repeated supporting refs.`,
    }));
  }

  for (const item of organizations.slice(0, 5)) {
    const refs = refsFromItem(item).filter((ref) => !highDriftRunRoots.has(ref.runRoot) && !highDriftRecordIds.has(ref.recordId));
    if (refs.length === 0) {
      filteredOut.lowSignalEvidenceRefs += 1;
      continue;
    }
    organizationWorkstreams.push(makeCandidate({
      family: 'organization_or_workstream',
      statement: `${item.label} is a high-signal recurring organizational context in Micah’s corpus, spanning ${item.sourceFamilies.join(', ')} evidence.`,
      confidence: scoreFromSourceFamilies(item.sourceFamilies || []),
      tags: ['organization'],
      sourceFamilies: item.sourceFamilies || [],
      refs,
      rationale: `Cross-source count ${item.count}; useful as a durable memory anchor.`,
    }));
  }

  for (const item of workstreams.slice(0, 5)) {
    const refs = refsFromItem(item).filter((ref) => !highDriftRunRoots.has(ref.runRoot) && !highDriftRecordIds.has(ref.recordId));
    if (refs.length === 0) {
      filteredOut.lowSignalEvidenceRefs += 1;
      continue;
    }
    organizationWorkstreams.push(makeCandidate({
      family: 'organization_or_workstream',
      statement: `${item.label} is a high-signal recurring workstream in Micah’s corpus, spanning ${item.sourceFamilies.join(', ')} evidence.`,
      confidence: scoreFromSourceFamilies(item.sourceFamilies || []),
      tags: ['workstream'],
      sourceFamilies: item.sourceFamilies || [],
      refs,
      rationale: `Cross-source count ${item.count}; useful as a durable memory anchor.`,
    }));
  }

  for (const item of eras.slice(0, 8)) {
    const refs = refsFromItem(item).filter((ref) => !highDriftRunRoots.has(ref.runRoot) && !highDriftRecordIds.has(ref.recordId));
    if (refs.length === 0) {
      filteredOut.lowSignalEvidenceRefs += 1;
      continue;
    }
    eraAnchors.push(makeCandidate({
      family: 'era_anchor',
      statement: `Era anchor: ${item.label} is a dense evidence year for Micah across ${item.sourceFamilies.join(', ')} sources.`,
      confidence: scoreFromSourceFamilies(item.sourceFamilies || []),
      tags: ['era', 'timeline'],
      sourceFamilies: item.sourceFamilies || [],
      refs,
      temporalScope: item.label,
      rationale: `Year appears repeatedly in cross-source era synthesis with count ${item.count}.`,
    }));
  }

  for (const item of relationshipChannels.slice(0, 5)) {
    openLoops.push(makeCandidate({
      family: 'open_loop',
      statement: `Actionable relationship context to preserve: ${item.statement.replace(/^Recurring relationship channel:\s*/i, '')}`,
      confidence: item.confidence,
      tags: ['open-loop', 'relationship'],
      sourceFamilies: item.sourceFamilies,
      refs: item.recordRefs,
      ongoing: true,
      rationale: 'Chosen from the strongest recurring relationship channels for better future partner context.',
    }));
  }

  for (const item of organizationWorkstreams.filter((candidate) => candidate.tags.includes('organization') || candidate.tags.includes('workstream')).slice(0, 4)) {
    openLoops.push(makeCandidate({
      family: 'open_loop',
      statement: `Actionable working context to preserve: ${item.statement}`,
      confidence: item.confidence,
      tags: ['open-loop', ...item.tags],
      sourceFamilies: item.sourceFamilies,
      refs: item.recordRefs,
      ongoing: true,
      rationale: 'Chosen from the strongest actionable organization/workstream anchors rather than raw historical topics.',
    }));
  }

  const recentEras = latestEras(eras, 2);
  if (eras.length > recentEras.length) filteredOut.historicalOpenLoopsDropped = Math.max(0, eras.length - recentEras.length);
  for (const item of recentEras) {
    const refs = refsFromItem(item).filter((ref) => !highDriftRunRoots.has(ref.runRoot) && !highDriftRecordIds.has(ref.recordId));
    if (refs.length === 0) continue;
    openLoops.push(makeCandidate({
      family: 'open_loop',
      statement: `Recent phase worth keeping visible: ${item.label} is one of the most recent strong eras in the corpus and may still shape current context.`,
      confidence: scoreFromSourceFamilies(item.sourceFamilies || []),
      tags: ['open-loop', 'recent-era'],
      sourceFamilies: item.sourceFamilies || [],
      refs,
      temporalScope: item.label,
      ongoing: true,
      rationale: 'Limited recent-era carry-forward so chronology stays visible without dominating actionable context.',
    }));
  }

  const stableProfileFinal = stableProfile.slice(0, 10);
  const relationshipFinal = relationshipChannels.slice(0, 10);
  const orgWorkstreamFinal = organizationWorkstreams.slice(0, 10);
  const eraFinal = eraAnchors.slice(0, 8);
  const openLoopsFinal = openLoops.slice(0, 11);

  const importCandidates = [
    ...stableProfileFinal,
    ...relationshipFinal,
    ...orgWorkstreamFinal,
    ...eraFinal,
    ...openLoopsFinal,
  ].slice(0, 50);

  const guardedBackgroundNote = {
    statement: 'Background context: Micah self-reports generalized anxiety and treatment-resistant depression, currently well controlled with medication, but earlier eras may reflect periods where those conditions colored experience and interpretation.',
    caveat: 'Keep as guarded analyst context only; do not use as a sole explanation for conflict, urgency, silence, or reversal.',
    source: 'config/analyst-context.assumptions.json',
    tags: ['analyst-context', 'guarded-background', 'mental-health'],
  };

  const bundle = {
    schema: 'open-memory-micah-bundle.v3',
    bundleVersion: 'v3',
    generatedAt: isoNow(),
    waveId,
    waveRoot,
    sourceArtifacts: {
      catalogPath: resolve(waveRoot, 'ingest-catalog.json'),
      reviewPath: resolve(waveRoot, 'production-review.json'),
      crossSourcePath: resolve(waveRoot, 'cross-source-review.json'),
      productionAuditPath: resolve(waveRoot, 'production-audit.json'),
      expandedAuditPath: resolve(waveRoot, 'expanded-audit.json'),
    },
    summary: {
      totalCandidates: importCandidates.length,
      stableProfile: stableProfileFinal.length,
      relationshipChannels: relationshipFinal.length,
      organizationWorkstreams: orgWorkstreamFinal.length,
      eraAnchors: eraFinal.length,
      openLoops: openLoopsFinal.length,
      maxHighDriftFindings: Number(expandedAudit?.summary?.highDriftFindings || 0),
    },
    stableProfile: stableProfileFinal,
    relationshipChannels: relationshipFinal,
    organizationWorkstreams: orgWorkstreamFinal,
    eraAnchors: eraFinal,
    openLoops: openLoopsFinal,
    guardedBackgroundNote,
    importCandidates: importCandidates.map((candidate) => toImportRecord(candidate, waveId)),
    analystContextRef: analystContext ? {
      path: resolve(REPO_ROOT, 'config/analyst-context.assumptions.json'),
      present: true,
    } : {
      path: resolve(REPO_ROOT, 'config/analyst-context.assumptions.json'),
      present: false,
    },
  };

  const reviewArtifact = {
    schema: 'open-memory-micah-review.v2',
    generatedAt: isoNow(),
    waveId,
    bundleVersion: bundle.bundleVersion,
    readyForProposed: {
      count: bundle.importCandidates.length,
      byFamily: {
        stable_profile: stableProfileFinal.length,
        relationship_channel: relationshipFinal.length,
        organization_or_workstream: orgWorkstreamFinal.length,
        era_anchor: eraFinal.length,
        open_loop: openLoopsFinal.length,
      },
    },
    quarantinePolicy: 'proposed-only',
    filteredOut,
    topOpenLoops: openLoopsFinal.slice(0, 5),
  };

  const report = {
    schema: 'open-memory-micah-import-report.v2',
    generatedAt: isoNow(),
    waveId,
    waveRoot,
    outputRoot,
    outputJson,
    outputMd,
    outputJsonl,
    reviewJson,
    reviewMd,
    candidateCounts: bundle.summary,
    posture: 'balanced-profile-plus-open-loops',
    analystContextHandling: 'guarded-background-note',
    importCompatibility: 'codex-memory-pipeline.ingest',
    warnings: [
      bundle.summary.totalCandidates < 20 ? 'Micah bundle generated fewer than 20 candidates.' : null,
      bundle.summary.maxHighDriftFindings > 0 ? 'Expanded audit reports non-zero high drift findings; review before import.' : null,
    ].filter(Boolean),
  };

  ensureParentDir(outputJson);
  writeJson(outputJson, bundle);
  ensureParentDir(outputMd);
  writeFileSync(outputMd, markdown(bundle), 'utf8');
  ensureParentDir(outputJsonl);
  writeFileSync(outputJsonl, `${bundle.importCandidates.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  ensureParentDir(resolve(outputRoot, 'micah-analyst-context.json'));
  writeJson(resolve(outputRoot, 'micah-analyst-context.json'), guardedBackgroundNote);
  ensureParentDir(reviewJson);
  writeJson(reviewJson, reviewArtifact);
  ensureParentDir(reviewMd);
  writeFileSync(reviewMd, reviewMarkdown(reviewArtifact), 'utf8');
  ensureParentDir(reportPath);
  writeJson(reportPath, report);

  if (printJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write('open-memory-micah-bundle complete\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`open-memory-micah-bundle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
