#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const DEFAULT_RUN_ROOT = resolve(REPO_ROOT, "output", "studio-brain", "agent-harness");
const DEFAULT_IDLE_RUN_ROOT = resolve(REPO_ROOT, "output", "studio-brain", "idle-worker");
const VALID_OUTCOMES = new Set([
  "used",
  "helpful",
  "resolved",
  "not_used",
  "stale",
  "misleading",
  "blocked",
  "superseded",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function stableHash(value, length = 12) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function toRepoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round(Number(value || 0) * scale) / scale;
}

function parseNonNegativeNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return parsed;
}

function readJsonFileIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readJsonlFileIfExists(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runGit(args, runner = spawnSync) {
  const result = runner("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr),
  };
}

function parseStatusLine(line) {
  const text = String(line || "");
  if (!text || text.startsWith("##")) return null;
  const code = text.slice(0, 2);
  const path = clean(text.slice(3));
  return {
    code,
    path,
    untracked: code === "??",
    trackedDirty: code !== "??",
  };
}

function captureGitState(runner = spawnSync) {
  const branch = runGit(["branch", "--show-current"], runner);
  const head = runGit(["rev-parse", "HEAD"], runner);
  const status = runGit(["status", "--short", "--branch"], runner);
  const dirtyFiles = status.stdout
    .split(/\r?\n/)
    .map(parseStatusLine)
    .filter(Boolean);
  return {
    ok: branch.ok && head.ok && status.ok,
    branch: branch.stdout,
    head: head.stdout,
    statusShortBranch: status.stdout,
    dirtyTrackedCount: dirtyFiles.filter((entry) => entry.trackedDirty).length,
    untrackedCount: dirtyFiles.filter((entry) => entry.untracked).length,
    dirtyFiles: dirtyFiles.slice(0, 40),
    errors: [branch, head, status].filter((entry) => !entry.ok).map((entry) => entry.stderr),
  };
}

function artifactRef(label, path, thresholdMinutes = 24 * 60) {
  const exists = existsSync(path);
  const parsed = readJsonFileIfExists(path);
  let mtimeIso = "";
  let ageMinutes = null;
  if (exists) {
    const stat = statSync(path);
    mtimeIso = stat.mtime.toISOString();
    ageMinutes = Math.max(0, Math.round((Date.now() - stat.mtimeMs) / 60000));
  }
  const generatedAt = clean(
    parsed?.generatedAt || parsed?.finishedAt || parsed?.completedAt || parsed?.startedAt || mtimeIso,
  );
  const generatedAgeMinutes = Number.isFinite(Date.parse(generatedAt))
    ? Math.max(0, Math.round((Date.now() - Date.parse(generatedAt)) / 60000))
    : ageMinutes;
  return {
    label,
    path: toRepoRelative(path),
    exists,
    status: clean(parsed?.status || parsed?.overallStatus || ""),
    generatedAt,
    ageMinutes: generatedAgeMinutes,
    stale: !exists || !Number.isFinite(generatedAgeMinutes) || generatedAgeMinutes > thresholdMinutes,
  };
}

function firstExistingJson(paths) {
  for (const path of paths) {
    const parsed = readJsonFileIfExists(path);
    if (parsed) return { path, parsed };
  }
  return { path: paths[0], parsed: null };
}

function captureSnapshot(options, deps = {}) {
  const runner = deps.runner || spawnSync;
  const idleRunRoot = options.idleRunRoot || DEFAULT_IDLE_RUN_ROOT;
  const currentRepoInventory = resolve(idleRunRoot, "repo-agentic-health-inventory.json");
  const fallbackRepoInventory = resolve(REPO_ROOT, "output", "qa", "repo-agentic-health-inventory.json");
  const repoInventory = firstExistingJson([currentRepoInventory, fallbackRepoInventory]);
  const idleWorkerPath = resolve(idleRunRoot, "latest.json");
  const memoryPath = resolve(REPO_ROOT, "output", "studio-brain", "memory-consolidation", "latest.json");
  const ephemeralPath = resolve(idleRunRoot, "ephemeral-artifact-tracking-guard.json");
  const wikiSourceIndexPath = resolve(idleRunRoot, "wiki-source-index.json");
  const wikiClaimExtractionPath = resolve(idleRunRoot, "wiki-claim-extraction.json");
  const wikiContradictionsPath = resolve(idleRunRoot, "wiki-contradictions.json");
  const wikiContextPackPath = resolve(idleRunRoot, "wiki-context-pack.json");
  const wikiDbProbePath = resolve(idleRunRoot, "wiki-db-probe.json");
  const currentDestructiveSurfaceAudit = resolve(idleRunRoot, "destructive-command-surfaces.json");
  const fallbackDestructiveSurfaceAudit = resolve(REPO_ROOT, "output", "qa", "destructive-command-surfaces.json");
  const destructiveSurfaceAudit = firstExistingJson([
    currentDestructiveSurfaceAudit,
    fallbackDestructiveSurfaceAudit,
  ]);

  return {
    generatedAt: nowIso(),
    runId: options.runId,
    repoRoot: REPO_ROOT,
    gitState: captureGitState(runner),
    artifacts: {
      idleWorker: artifactRef("idle-worker", idleWorkerPath, 24 * 60),
      repoInventory: artifactRef("repo-agentic-health-inventory", repoInventory.path, 24 * 60),
      memoryConsolidation: artifactRef("memory-consolidation", memoryPath, 24 * 60),
      ephemeralArtifactGuard: artifactRef("ephemeral-artifact-guard", ephemeralPath, 24 * 60),
      wikiSourceIndex: artifactRef("wiki-source-index", wikiSourceIndexPath, 24 * 60),
      wikiClaimExtraction: artifactRef("wiki-claim-extraction", wikiClaimExtractionPath, 24 * 60),
      wikiContradictions: artifactRef("wiki-contradictions", wikiContradictionsPath, 24 * 60),
      wikiContextPack: artifactRef("wiki-context-pack", wikiContextPackPath, 24 * 60),
      wikiDbProbe: artifactRef("wiki-db-probe", wikiDbProbePath, 24 * 60),
      destructiveSurfaceAudit: artifactRef("destructive-surface-audit", destructiveSurfaceAudit.path, 24 * 60),
    },
    idleWorker: readJsonFileIfExists(idleWorkerPath),
    repoInventory: repoInventory.parsed,
    memoryConsolidation: readJsonFileIfExists(memoryPath),
    ephemeralArtifactGuard: readJsonFileIfExists(ephemeralPath),
    wikiSourceIndex: readJsonFileIfExists(wikiSourceIndexPath),
    wikiClaimExtraction: readJsonFileIfExists(wikiClaimExtractionPath),
    wikiContradictions: readJsonFileIfExists(wikiContradictionsPath),
    wikiContextPack: readJsonFileIfExists(wikiContextPackPath),
    wikiDbProbe: readJsonFileIfExists(wikiDbProbePath),
    destructiveSurfaceAudit: destructiveSurfaceAudit.parsed,
  };
}

function makePacket(priority, packet) {
  const key = [
    packet.title,
    packet.why,
    ...(Array.isArray(packet.files) ? packet.files : []),
    packet.nextCommand || "",
  ].join("|");
  return {
    packetId: `wp-${stableHash(key)}`,
    priority,
    status: packet.status || "ready",
    risk: packet.risk || "low",
    title: packet.title,
    why: packet.why,
    sourceSignals: Array.isArray(packet.sourceSignals) ? packet.sourceSignals : [],
    memoryQueries: Array.isArray(packet.memoryQueries) ? packet.memoryQueries : [],
    files: Array.isArray(packet.files) ? packet.files : [],
    nextCommand: packet.nextCommand || "",
    verification: Array.isArray(packet.verification) ? packet.verification : [],
    humanGate: packet.humanGate || "",
  };
}

function hasDirtyPath(gitState, matcher) {
  return (gitState?.dirtyFiles || []).some((entry) => matcher(entry.path));
}

function addPacketUnique(packets, packet) {
  if (packets.some((entry) => entry.title === packet.title)) return;
  packets.push(packet);
}

function buildSourceFreshness(artifacts) {
  const sources = Object.values(artifacts || {});
  const relevant = sources.filter((source) => source.label !== "ephemeral-artifact-guard" || source.exists);
  const freshCount = relevant.filter((source) => source.exists && !source.stale).length;
  return {
    sources,
    freshCount,
    staleCount: relevant.filter((source) => source.exists && source.stale).length,
    missingCount: relevant.filter((source) => !source.exists).length,
    score: relevant.length === 0 ? 0 : round(freshCount / relevant.length),
  };
}

function collectFailedIdleJobs(idleWorker) {
  return (Array.isArray(idleWorker?.jobs) ? idleWorker.jobs : [])
    .filter((job) => ["failed", "fail", "error"].includes(clean(job.status).toLowerCase()))
    .map((job) => ({
      id: clean(job.id || job.label),
      label: clean(job.label || job.id),
      artifacts: Array.isArray(job.artifacts) ? job.artifacts.filter(Boolean) : [],
      error: clean(job.error),
    }))
    .filter((job) => job.id);
}

function buildFreshFailurePacket(snapshot, failedIdleJobs) {
  const destructiveJob = failedIdleJobs.find((job) => job.id === "repo-destructive-surface-audit");
  const destructiveAudit = snapshot.destructiveSurfaceAudit || {};
  let unresolvedFailedJobs = failedIdleJobs;
  const failedSurfaces = (Array.isArray(destructiveAudit.surfaces) ? destructiveAudit.surfaces : [])
    .filter((surface) => clean(surface.status).toLowerCase() !== "pass")
    .map((surface) => ({
      id: clean(surface.id),
      file: clean(surface.file),
      missingEvidence: Array.isArray(surface.missingEvidence) ? surface.missingEvidence : [],
      missingGuards: Array.isArray(surface.missingGuards) ? surface.missingGuards : [],
    }))
    .filter((surface) => surface.id);

  if (destructiveJob && failedSurfaces.length > 0) {
    const files = [...new Set([
      "scripts/destructive-command-surface-audit.mjs",
      ...failedSurfaces.map((surface) => surface.file).filter(Boolean),
    ])];
    return makePacket(0, {
      title: "Fix the fresh destructive-surface audit failure",
      why: `The latest idle-worker run failed repo-destructive-surface-audit for ${failedSurfaces.length} surface(s): ${failedSurfaces.map((surface) => surface.id).join(", ")}.`,
      status: "ready",
      risk: "medium",
      sourceSignals: [
        {
          source: "idle-worker",
          failedJob: destructiveJob.id,
          surfaces: failedSurfaces,
        },
      ],
      memoryQueries: ["Studio Brain destructive surface audit failed surfaces"],
      files,
      nextCommand: "npm run audit:destructive-surfaces -- --json",
      verification: [
        "Run npm run audit:destructive-surfaces -- --json and confirm failedCount is 0.",
        "Run npm run studio:ops:idle-worker:dry:json and confirm repo-destructive-surface-audit is not failed.",
      ],
    });
  }

  if (destructiveJob && ["pass", "passed"].includes(clean(destructiveAudit.status).toLowerCase())) {
    unresolvedFailedJobs = failedIdleJobs.filter((job) => job.id !== destructiveJob.id);
    if (unresolvedFailedJobs.length === 0) return null;
  }

  return makePacket(0, {
    title: "Fix the fresh idle-worker failed job",
    why: `The latest idle-worker run failed ${unresolvedFailedJobs.length} job(s): ${unresolvedFailedJobs.map((job) => job.id).join(", ")}.`,
    status: "ready",
    risk: "medium",
    sourceSignals: [
      {
        source: "idle-worker",
        failedJobs: unresolvedFailedJobs,
      },
    ],
    memoryQueries: ["Studio Brain idle-worker failed job latest artifact"],
    files: ["scripts/studiobrain-idle-worker.mjs", "docs/runbooks/STUDIO_BRAIN_IDLE_WORKER.md"],
    nextCommand: "npm run studio:ops:idle-worker:dry:json",
    verification: ["Inspect output/studio-brain/idle-worker/latest.json and confirm the failed job is resolved or converted to a bounded warning."],
  });
}

function collectOpenWikiContradictions(scan) {
  return (Array.isArray(scan?.contradictions) ? scan.contradictions : [])
    .filter((entry) => ["open", "in-review"].includes(clean(entry.status).toLowerCase()))
    .map((entry) => ({
      contradictionId: clean(entry.contradictionId),
      conflictKey: clean(entry.conflictKey),
      severity: clean(entry.severity).toLowerCase() || "unknown",
      owner: clean(entry.owner),
      claimAId: clean(entry.claimAId),
      claimBId: clean(entry.claimBId),
      recommendedAction: clean(entry.recommendedAction),
      markdownPath: clean(entry.markdownPath),
      sourceRefs: Array.isArray(entry.sourceRefs) ? entry.sourceRefs.slice(0, 6) : [],
      evidencePathCounts: entry.metadata?.evidencePathCounts || null,
      evidenceSurfaceCounts: entry.metadata?.evidenceSurfaceCounts || null,
    }))
    .filter((entry) => entry.contradictionId || entry.conflictKey);
}

function buildWikiContradictionPacket(snapshot) {
  const contradictions = collectOpenWikiContradictions(snapshot.wikiContradictions);
  const hardContradictions = contradictions.filter((entry) => ["critical", "hard"].includes(entry.severity));
  if (contradictions.length === 0 || hardContradictions.length === 0) return null;

  const conflictKeys = hardContradictions.map((entry) => entry.conflictKey || entry.contradictionId).filter(Boolean);
  const blockedByPausedCustomerSurfaces = hardContradictions.every(isBlockedByPausedCustomerSurfaces);
  const files = [
    "scripts/wiki-postgres.mjs",
    "scripts/lib/wiki-postgres-utils.mjs",
    "wiki/50_contradictions",
    ...hardContradictions.map((entry) => entry.markdownPath).filter(Boolean),
  ];

  return makePacket(0, {
    title: blockedByPausedCustomerSurfaces
      ? "Track redesign-blocked wiki source drift"
      : "Review hard wiki source drift before customer-facing use",
    why: blockedByPausedCustomerSurfaces
      ? `The latest wiki contradiction scan found ${hardContradictions.length} hard conflict(s): ${conflictKeys.join(", ")}. The winning OPERATIONAL_TRUTH claim is usable for agent context, and the remaining stale evidence is isolated to paused website/portal redesign surfaces.`
      : `The latest wiki contradiction scan found ${hardContradictions.length} hard conflict(s): ${conflictKeys.join(", ")}. Use any source-grounded OPERATIONAL_TRUTH claims for agent context, but review stale or conflicting source refs before customer-facing edits or policy automation.`,
    status: blockedByPausedCustomerSurfaces ? "blocked" : "needs_human",
    risk: "medium",
    sourceSignals: [
      {
        source: "wiki-contradictions",
        status: snapshot.wikiContradictions?.status || "",
        summary: snapshot.wikiContradictions?.summary || {},
        contradictions: hardContradictions,
      },
    ],
    memoryQueries: ["Studio Brain wiki contradictions membership pricing operational truth"],
    files: [...new Set(files)],
    nextCommand: "npm run wiki:contradictions:scan -- --artifact output/wiki/contradictions-review.json",
    verification: [
      "Confirm every hard conflict has a reviewable markdown record under wiki/50_contradictions.",
      "If a winning OPERATIONAL_TRUTH claim exists, use it for agent context and treat losing sources as stale until updated.",
      "Do not promote unresolved pricing, membership, or access claims to OPERATIONAL_TRUTH without human approval.",
      "After review, rerun npm run studio:ops:idle-worker:wiki:json and confirm the warning is expected or resolved.",
    ],
    humanGate: blockedByPausedCustomerSurfaces
      ? "Blocked until the website/portal redesign owner updates customer-facing surfaces or the user explicitly reopens that edit surface."
      : "Human approval is required before changing customer-facing pricing, membership, payment, refund, or access policy truth.",
  });
}

function isBlockedByPausedCustomerSurfaces(entry) {
  const surfaces = Array.isArray(entry.evidenceSurfaceCounts?.a) ? entry.evidenceSurfaceCounts.a : [];
  if (surfaces.length === 0 || !entry.claimBId) return false;
  const paused = new Set(["website-redesign-paused", "portal-redesign-paused"]);
  return surfaces.every((surface) => paused.has(clean(surface.surface)));
}

export function buildNextWorkFromSnapshot(snapshot, options = {}) {
  const packets = [];
  const gitState = snapshot.gitState || {};
  const repoInventory = snapshot.repoInventory || {};
  const memory = snapshot.memoryConsolidation || {};
  const idleWorker = snapshot.idleWorker || {};
  const sourceFreshness = buildSourceFreshness(snapshot.artifacts);
  const dirtyTrackedCount = Number(gitState.dirtyTrackedCount || 0);
  const untrackedCount = Number(gitState.untrackedCount || 0);
  const unknownOwnerCount = Number(repoInventory?.summary?.surfaces?.["unknown-owner"] || 0);
  const highRiskRootScripts = Number(repoInventory?.summary?.highRiskRootScripts || 0);
  const packageScripts = Number(repoInventory?.summary?.rootPackageScripts || repoInventory?.summary?.packageScripts || 0);
  const memoryStatus = clean(memory.status).toLowerCase();
  const actionabilityStatus = clean(memory.actionabilityStatus).toLowerCase();
  const associationAvailable = memory.associationScoutStatus?.available;
  const memoryAssociationErrors = Array.isArray(memory.associationErrors) ? memory.associationErrors.length : 0;
  const idleStatus = clean(idleWorker.status).toLowerCase();
  const failedIdleJobs = collectFailedIdleJobs(idleWorker);
  const freshIdleFailure =
    failedIdleJobs.length > 0 &&
    snapshot.artifacts?.idleWorker?.exists &&
    !snapshot.artifacts?.idleWorker?.stale;

  if (freshIdleFailure) {
    const freshFailurePacket = buildFreshFailurePacket(snapshot, failedIdleJobs);
    if (freshFailurePacket) addPacketUnique(packets, freshFailurePacket);
  }

  const wikiContradictionPacket = buildWikiContradictionPacket(snapshot);
  if (wikiContradictionPacket) addPacketUnique(packets, wikiContradictionPacket);

  if (dirtyTrackedCount > 20 || untrackedCount > 20) {
    addPacketUnique(
      packets,
      makePacket(1, {
        title: "Classify the dirty worktree before risky agent work",
        why: `git status currently shows ${dirtyTrackedCount} tracked dirty file(s) and ${untrackedCount} untracked file(s); risky edits need a clean ownership map first.`,
        status: "needs_human",
        risk: "medium",
        sourceSignals: [{ source: "git", detail: "large dirty worktree", dirtyTrackedCount, untrackedCount }],
        files: ["AGENTS.md", "docs/audits/repo-wide-agentic-health-audit-2026-04-27.md"],
        nextCommand: "git status --short --branch",
        verification: ["Confirm which dirty paths are user work, generated output, deployment-managed, or safe to ignore."],
        humanGate: "Do not run broad refactors until ownership of dirty tracked files is clear.",
      }),
    );
  }

  if (hasDirtyPath(gitState, (path) => path === "docs/generated/studiobrain-runtime-contract.generated.md")) {
    addPacketUnique(
      packets,
      makePacket(1, {
        title: "Reconcile the Studio Brain runtime contract docs",
        why: "The generated runtime contract doc is dirty, which can make ops/status claims disagree with the checked-in source-of-truth snapshot.",
        status: "ready",
        risk: "low",
        sourceSignals: [{ source: "git", detail: "runtime contract generated doc is modified" }],
        files: ["docs/generated/studiobrain-runtime-contract.generated.md", "scripts/generate-runtime-docs.mjs"],
        nextCommand: "npm run docs:contract:check",
        verification: ["npm run docs:contract:check", "Review whether the generated diff is intentional before committing."],
      }),
    );
  }

  if (!["success", "passed", ""].includes(memoryStatus) || !["passed", "pass", "success", ""].includes(actionabilityStatus) || associationAvailable === false || memoryAssociationErrors > 0) {
    addPacketUnique(
      packets,
      makePacket(2, {
        title: "Repair memory consolidation actionability warnings",
        why: "The harness is only useful if startup memory and consolidation are reliable enough to ground the next Codex session.",
        status: "ready",
        risk: "low",
        sourceSignals: [
          {
            source: "memory-consolidation",
            status: memory.status || "",
            actionabilityStatus: memory.actionabilityStatus || "",
            associationAvailable,
            associationErrorCount: memoryAssociationErrors,
          },
        ],
        memoryQueries: ["Studio Brain memory consolidation warning actionability association scout"],
        files: ["scripts/open-memory-consolidate.mjs", "scripts/studiobrain-idle-worker.mjs"],
        nextCommand: "npm run studio:ops:idle-worker:json",
        verification: ["Check output/studio-brain/memory-consolidation/latest.json for status success and actionabilityStatus passed."],
      }),
    );
  }

  if (unknownOwnerCount > 0 || highRiskRootScripts > 100 || packageScripts > 450) {
    addPacketUnique(
      packets,
      makePacket(2, {
        title: "Reduce agentic command-surface ambiguity",
        why: `The latest inventory reports ${unknownOwnerCount} unknown-owner surface(s), ${highRiskRootScripts} high-risk root script(s), and ${packageScripts} root/package script(s).`,
        status: "ready",
        risk: "low",
        sourceSignals: [
          {
            source: "repo-agentic-health-inventory",
            unknownOwnerCount,
            highRiskRootScripts,
            packageScripts,
          },
        ],
        files: ["scripts/repo-agentic-health-inventory.mjs", "docs/runbooks/AGENTIC_AUDIT_RUNBOOK.md"],
        nextCommand: "npm run audit:agentic:inventory -- --artifact output/qa/repo-agentic-health-inventory.json --markdown output/qa/repo-agentic-health-inventory.md",
        verification: ["Confirm the refreshed inventory keeps status pass and lowers unknown-owner or high-risk ambiguity."],
      }),
    );
  }

  if (!idleStatus || !["passed", "passed_with_warnings", "planned"].includes(idleStatus) || snapshot.artifacts?.idleWorker?.stale) {
    addPacketUnique(
      packets,
      makePacket(3, {
        title: "Refresh idle-worker loop evidence",
        why: "The next Codex session should trust fresh loop artifacts, not stale or missing timer output.",
        status: "ready",
        risk: "low",
        sourceSignals: [
          {
            source: "idle-worker",
            status: idleWorker.status || "",
            stale: Boolean(snapshot.artifacts?.idleWorker?.stale),
          },
        ],
        files: ["scripts/studiobrain-idle-worker.mjs", "docs/runbooks/STUDIO_BRAIN_IDLE_WORKER.md"],
        nextCommand: "npm run studio:ops:idle-worker:dry:json",
        verification: ["Inspect output/studio-brain/idle-worker/latest.json and confirm planned/passed status plus expected jobs."],
      }),
    );
  }

  if (packets.length === 0) {
    addPacketUnique(
      packets,
      makePacket(3, {
        title: "Use this harness packet in the next Codex session and record the outcome",
        why: "No urgent maintenance signal was found, so the highest-value slice is proving whether the harness saves orientation time.",
        status: "ready",
        risk: "low",
        sourceSignals: [{ source: "agent-harness", detail: "no urgent source signal" }],
        files: ["scripts/studiobrain-agent-harness-work-packet.mjs", "docs/runbooks/STUDIO_BRAIN_IDLE_WORKER.md"],
        nextCommand: "npm run studio:ops:agent-harness:json",
        verification: [
          "After using a packet, record an outcome with node ./scripts/studiobrain-agent-harness-work-packet.mjs --record-outcome <packetId> --outcome helpful --minutes-saved 5",
        ],
      }),
    );
  }

  const topWork = packets
    .sort((left, right) => left.priority - right.priority || left.title.localeCompare(right.title))
    .slice(0, 3);

  return {
    schema: "studiobrain-agent-harness-next-work.v1",
    generatedAt: snapshot.generatedAt || nowIso(),
    runId: snapshot.runId || "",
    repoRoot: REPO_ROOT,
    purpose: "Leave one bounded, measurable next-work packet set for the next Codex session.",
    constraints: {
      maxPackets: 3,
      readOnly: true,
      noNewDaemon: true,
      noNewDatabase: true,
      writeScope: ["output/studio-brain/agent-harness"],
    },
    repoState: {
      branch: gitState.branch || "",
      head: gitState.head || "",
      dirtyTrackedCount,
      untrackedCount,
      dirtySamples: (gitState.dirtyFiles || []).slice(0, 12),
    },
    sourceFreshness,
    topWork,
    metrics: {
      readinessScore: 0,
      candidateStatus: "not_evaluated",
      successMetricsPath: options.metricsPath || "output/studio-brain/agent-harness/success-metrics.json",
      recordOutcomeCommand:
        topWork.length > 0
          ? `node ./scripts/studiobrain-agent-harness-work-packet.mjs --record-outcome ${topWork[0].packetId} --outcome helpful --minutes-saved 5`
          : "",
    },
  };
}

export function summarizeOutcomeLedger(outcomes) {
  const valid = (Array.isArray(outcomes) ? outcomes : []).filter((entry) => VALID_OUTCOMES.has(clean(entry.outcome)));
  const helpful = valid.filter((entry) => ["used", "helpful", "resolved"].includes(entry.outcome));
  const staleOrMisleading = valid.filter((entry) => ["stale", "misleading"].includes(entry.outcome));
  const totalMinutesSaved = valid.reduce((sum, entry) => sum + (Number(entry.minutesSaved) || 0), 0);
  return {
    total: valid.length,
    helpful: helpful.length,
    staleOrMisleading: staleOrMisleading.length,
    blocked: valid.filter((entry) => entry.outcome === "blocked").length,
    notUsed: valid.filter((entry) => entry.outcome === "not_used").length,
    superseded: valid.filter((entry) => entry.outcome === "superseded").length,
    helpfulRate: valid.length === 0 ? 0 : round(helpful.length / valid.length),
    staleOrMisleadingRate: valid.length === 0 ? 0 : round(staleOrMisleading.length / valid.length),
    totalMinutesSaved,
    recent: valid.slice(-10),
  };
}

export function buildSuccessMetrics(nextWork, outcomes, generatedAt = nowIso()) {
  const outcomeSummary = summarizeOutcomeLedger(outcomes);
  const topWork = Array.isArray(nextWork?.topWork) ? nextWork.topWork : [];
  const readyPacketCount = topWork.filter((packet) => packet.status === "ready").length;
  const needsHumanCount = topWork.filter((packet) => packet.status === "needs_human").length;
  const blockedPacketCount = topWork.filter((packet) => packet.status === "blocked").length;
  const actionableCommandCount = topWork.filter((packet) => clean(packet.nextCommand)).length;
  const sourceFreshnessScore = Number(nextWork?.sourceFreshness?.score || 0);
  const actionabilityScore =
    topWork.length === 0 ? 0 : round((readyPacketCount + needsHumanCount * 0.5) / topWork.length);
  const boundedScore =
    topWork.length > 0 &&
    topWork.length <= 3 &&
    nextWork?.constraints?.readOnly === true &&
    nextWork?.constraints?.noNewDaemon === true &&
    nextWork?.constraints?.noNewDatabase === true
      ? 1
      : 0;
  const readinessScore = round(sourceFreshnessScore * 0.35 + actionabilityScore * 0.45 + boundedScore * 0.2);
  const candidateStatus = readinessScore >= 0.6 && topWork.length > 0 ? "candidate_success" : "candidate_failure";
  let realUsageVerdict = "insufficient_real_usage";
  if (outcomeSummary.total >= 3) {
    realUsageVerdict =
      (outcomeSummary.helpfulRate >= 0.5 || outcomeSummary.totalMinutesSaved >= 15) &&
      outcomeSummary.staleOrMisleadingRate <= 0.25
        ? "success"
        : "failure";
  }

  return {
    schema: "studiobrain-agent-harness-success-metrics.v1",
    generatedAt,
    candidateStatus,
    realUsageVerdict,
    readiness: {
      readinessScore,
      sourceFreshnessScore,
      actionabilityScore,
      boundedScore,
      packetCount: topWork.length,
      readyPacketCount,
      needsHumanCount,
      blockedPacketCount,
      actionableCommandCount,
      staleSourceCount: Number(nextWork?.sourceFreshness?.staleCount || 0),
      missingSourceCount: Number(nextWork?.sourceFreshness?.missingCount || 0),
    },
    ratholeBudget: {
      maxPackets: 3,
      artifactCount: 2,
      newDaemon: false,
      newDatabase: false,
      autonomousCodeEdits: false,
      writeScope: ["output/studio-brain/agent-harness"],
    },
    outcomeLedger: outcomeSummary,
    successCriteria: [
      "After at least 3 recorded outcomes, helpfulRate >= 0.50 or totalMinutesSaved >= 15.",
      "After at least 3 recorded outcomes, staleOrMisleadingRate <= 0.25.",
      "Every generated next-work artifact keeps packetCount <= 3 and noNewDaemon/noNewDatabase true.",
    ],
    failureCriteria: [
      "After at least 3 recorded outcomes, helpfulRate < 0.50 and totalMinutesSaved < 15.",
      "After at least 3 recorded outcomes, staleOrMisleadingRate > 0.25.",
      "Any generated packet asks for autonomous writes, new persistent services, or a new database.",
    ],
  };
}

function printUsage() {
  process.stdout.write(
    [
      "Studio Brain agent harness work-packet generator",
      "",
      "Usage:",
      "  node ./scripts/studiobrain-agent-harness-work-packet.mjs --write [--json]",
      "  node ./scripts/studiobrain-agent-harness-work-packet.mjs --record-outcome <packetId> --outcome helpful --minutes-saved 5",
      "",
      "Options:",
      "  --write                    Persist next-work and metrics artifacts",
      "  --json                     Print JSON report",
      "  --run-id <id>              Run identifier",
      "  --run-root <path>          Agent harness artifact root",
      "  --idle-run-root <path>     Idle-worker artifact root to inspect",
      "  --artifact <path>          next-work artifact path",
      "  --metrics <path>           success metrics artifact path",
      "  --outcomes <path>          outcome JSONL path",
      "  --record-outcome <id>      Append an outcome for a packet",
      "  --outcome <value>          used | helpful | resolved | not_used | stale | misleading | blocked | superseded",
      "  --minutes-saved <n>        Estimated orientation minutes saved",
      "  --used-by <name>           Optional actor label",
      "  --notes <text>             Optional short note",
      "  --note <text>              Alias for --notes",
      "  -h, --help                 Show this help",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const parsed = {
    write: false,
    json: false,
    runId: "",
    runRoot: DEFAULT_RUN_ROOT,
    idleRunRoot: DEFAULT_IDLE_RUN_ROOT,
    artifact: "",
    metrics: "",
    outcomes: "",
    recordOutcome: "",
    outcome: "",
    minutesSaved: 0,
    usedBy: "codex",
    notes: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--write") {
      parsed.write = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    const next = clean(argv[index + 1]);
    if (arg === "--run-id") {
      if (!next) throw new Error("--run-id requires a value.");
      parsed.runId = next;
      index += 1;
      continue;
    }
    if (arg === "--run-root") {
      if (!next) throw new Error("--run-root requires a value.");
      parsed.runRoot = resolve(REPO_ROOT, next);
      index += 1;
      continue;
    }
    if (arg === "--idle-run-root") {
      if (!next) throw new Error("--idle-run-root requires a value.");
      parsed.idleRunRoot = resolve(REPO_ROOT, next);
      index += 1;
      continue;
    }
    if (arg === "--artifact") {
      if (!next) throw new Error("--artifact requires a value.");
      parsed.artifact = resolve(REPO_ROOT, next);
      index += 1;
      continue;
    }
    if (arg === "--metrics") {
      if (!next) throw new Error("--metrics requires a value.");
      parsed.metrics = resolve(REPO_ROOT, next);
      index += 1;
      continue;
    }
    if (arg === "--outcomes") {
      if (!next) throw new Error("--outcomes requires a value.");
      parsed.outcomes = resolve(REPO_ROOT, next);
      index += 1;
      continue;
    }
    if (arg === "--record-outcome") {
      if (!next) throw new Error("--record-outcome requires a packet id.");
      parsed.recordOutcome = next;
      index += 1;
      continue;
    }
    if (arg === "--outcome") {
      if (!VALID_OUTCOMES.has(next)) {
        throw new Error(`--outcome must be one of: ${Array.from(VALID_OUTCOMES).join(", ")}`);
      }
      parsed.outcome = next;
      index += 1;
      continue;
    }
    if (arg === "--minutes-saved") {
      parsed.minutesSaved = parseNonNegativeNumber(next, "--minutes-saved");
      index += 1;
      continue;
    }
    if (arg === "--used-by") {
      if (!next) throw new Error("--used-by requires a value.");
      parsed.usedBy = next;
      index += 1;
      continue;
    }
    if (arg === "--notes" || arg === "--note") {
      parsed.notes = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  parsed.runId ||= `agent-harness-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  parsed.artifact ||= resolve(parsed.runRoot, "next-work.json");
  parsed.metrics ||= resolve(parsed.runRoot, "success-metrics.json");
  parsed.outcomes ||= resolve(parsed.runRoot, "outcomes.jsonl");
  return parsed;
}

function recordOutcome(options) {
  if (!options.recordOutcome) throw new Error("--record-outcome requires a packet id.");
  if (!options.outcome) throw new Error("--outcome is required when recording an outcome.");
  const entry = {
    schema: "studiobrain-agent-harness-outcome.v1",
    recordedAt: nowIso(),
    packetId: options.recordOutcome,
    outcome: options.outcome,
    minutesSaved: options.minutesSaved,
    usedBy: options.usedBy,
    notes: options.notes,
  };
  mkdirSync(dirname(options.outcomes), { recursive: true });
  appendFileSync(options.outcomes, `${JSON.stringify(entry)}\n`, "utf8");
  const nextWork = readJsonFileIfExists(options.artifact) || {
    schema: "studiobrain-agent-harness-next-work.v1",
    topWork: [],
    sourceFreshness: { score: 0, staleCount: 0, missingCount: 0 },
    constraints: { readOnly: true, noNewDaemon: true, noNewDatabase: true },
  };
  const outcomes = readJsonlFileIfExists(options.outcomes);
  const successMetrics = buildSuccessMetrics(nextWork, outcomes, nowIso());
  writeJson(options.metrics, successMetrics);
  return { entry, successMetrics };
}

export function runAgentHarnessWorkPacket(rawArgs = process.argv.slice(2), deps = {}) {
  const options = parseArgs(rawArgs);
  if (options.recordOutcome) {
    const result = recordOutcome(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`agent harness outcome recorded: ${result.entry.packetId} ${result.entry.outcome}\n`);
      process.stdout.write(`real usage verdict: ${result.successMetrics.realUsageVerdict}\n`);
    }
    return result;
  }

  const snapshot = captureSnapshot(options, deps);
  const nextWork = buildNextWorkFromSnapshot(snapshot, {
    metricsPath: toRepoRelative(options.metrics),
  });
  const outcomes = readJsonlFileIfExists(options.outcomes);
  const successMetrics = buildSuccessMetrics(nextWork, outcomes, nextWork.generatedAt);
  nextWork.metrics.readinessScore = successMetrics.readiness.readinessScore;
  nextWork.metrics.candidateStatus = successMetrics.candidateStatus;

  if (options.write) {
    writeJson(options.artifact, nextWork);
    writeJson(options.metrics, successMetrics);
  }

  const report = {
    schema: "studiobrain-agent-harness-work-packet-report.v1",
    generatedAt: nextWork.generatedAt,
    runId: options.runId,
    status: successMetrics.candidateStatus === "candidate_success" ? "pass" : "warn",
    written: options.write
      ? {
          nextWorkPath: toRepoRelative(options.artifact),
          metricsPath: toRepoRelative(options.metrics),
          outcomesPath: toRepoRelative(options.outcomes),
        }
      : null,
    nextWork,
    successMetrics,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`agent harness work packet: ${report.status}\n`);
    process.stdout.write(`packets: ${nextWork.topWork.length}\n`);
    process.stdout.write(`readiness: ${successMetrics.readiness.readinessScore}\n`);
    if (options.write) process.stdout.write(`artifact: ${toRepoRelative(options.artifact)}\n`);
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    runAgentHarnessWorkPacket();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
