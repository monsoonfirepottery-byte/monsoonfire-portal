#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureParentDir,
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readJson,
  readNumberFlag,
  readStringFlag,
  writeJson,
} from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_PST_BASELINE_ROOT = resolve(
  REPO_ROOT,
  "./output/memory/pst-signal-quality-run-2026-03-06-finalcandidate"
);

function usage() {
  process.stdout.write(
    [
      "Open Memory production wave runner",
      "",
      "Usage:",
      "  node ./scripts/open-memory-production-wave.mjs \\",
      "    --wave-id production-wave-2026-03-06 \\",
      "    --docs-input ./imports/documents/runs/docs-production-wave-2026-03-06/docs-metadata.json",
      "",
      "Options:",
      "  --wave-id <id>                Stable wave id",
      "  --output-root <path>          Wave artifact root (default: ./output/memory/<wave-id>)",
      "  --resume true|false           Resume an existing wave (default: true)",
      "  --clean-output-root true|false Remove output root before starting",
      "  --heartbeat-seconds <n>       CLI heartbeat cadence (default: 15)",
      "  --mail-folder-queue <path>    Mail queue JSON path",
      "  --mail-snapshot-root <path>   Existing mail source root containing folder snapshots to rerun",
      "  --twitter-input-dir <path>    Twitter archive input directory",
      "  --docs-input <path>           Required docs seed manifest",
      "  --pst-baseline-root <path>    PST baseline root override",
      "  --reuse-pst-manifest <path>   Reuse an existing PST manifest instead of resolving from baseline root",
      "  --reuse-twitter-root <path>   Reuse an existing twitter run root instead of rerunning twitter",
      "  --reuse-docs-root <path>      Reuse an existing docs run root instead of rerunning docs",
      "  --status-path <path>          Override wave-status.json path",
      "  --events-path <path>          Override wave-events.jsonl path",
      "  --post-run-review true|false  Run review/audit after vector completion (default: true)",
      "  --audit-seed <value>          Deterministic audit seed (default: 20260306)",
      "  --review-mail-sample <n>      Mail sample size for review generation (default: 8)",
      "  --docs-audit-root <path>      Optional docs run root for audit sampling",
      "  --json                        Print final summary JSON",
    ].join("\n")
  );
}

function appendText(path, value) {
  ensureParentDir(path);
  appendFileSync(path, value, "utf8");
}

function appendJsonl(path, value) {
  appendText(path, `${JSON.stringify(value)}\n`);
}

function safeReadJson(path, fallback = null) {
  try {
    return readJson(path, fallback);
  } catch {
    return fallback;
  }
}

function fileExists(path) {
  return Boolean(path) && existsSync(path);
}

function sourceRootFromManifest(manifestPath) {
  return String(manifestPath || "").replace(/\/canonical-corpus\/manifest\.json$/, "");
}

function slugify(value) {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

function countJsonlRows(path) {
  if (!fileExists(path)) return 0;
  const raw = readFileSync(path, "utf8").trim();
  return raw ? raw.split(/\r?\n/).filter(Boolean).length : 0;
}

function makeVector(status, key) {
  if (!status.vectors[key]) {
    status.vectors[key] = {
      status: "pending",
      startedAt: null,
      finishedAt: null,
      currentStage: null,
      currentArtifact: null,
      currentLogPath: null,
      counts: {},
      warnings: [],
      errors: [],
      runId: null,
      manifestPath: null,
      sqlitePath: null,
    };
  }
  return status.vectors[key];
}

function summarizeCounts(counts) {
  return Object.entries(counts || {})
    .filter(([, value]) => Number.isFinite(value))
    .slice(0, 4)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function refreshSummary(status) {
  const vectors = Object.values(status.vectors || {});
  status.summary.vectorsCompleted = vectors.filter((entry) =>
    ["completed", "validated-baseline"].includes(String(entry.status || ""))
  ).length;
  status.summary.vectorsFailed = vectors.filter((entry) => String(entry.status || "") === "failed").length;
  const mailCounts = status.vectors?.mail?.counts || {};
  status.summary.mailFoldersQueued = Math.max(Number(status.summary.mailFoldersQueued || 0), Number(mailCounts.queuedFolders || 0));
  status.summary.mailFoldersCompleted = Math.max(Number(status.summary.mailFoldersCompleted || 0), Number(mailCounts.completedFolders || 0));
  status.summary.mailFoldersFailed = Math.max(Number(status.summary.mailFoldersFailed || 0), Number(mailCounts.failedFolders || 0));
  status.summary.postRunReviewStatus = String(status.postRunReview?.status || "pending");
  status.summary.postRunReviewWarnings = Array.isArray(status.postRunReview?.warnings) ? status.postRunReview.warnings.length : 0;
}

function persistStatus(status, statusPath) {
  status.updatedAt = isoNow();
  refreshSummary(status);
  writeJson(statusPath, status);
}

function emitHeartbeat(status) {
  const elapsedMs = Math.max(0, Date.now() - new Date(status.startedAt).getTime());
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const label = `${Math.floor(elapsedSeconds / 60)}m${String(elapsedSeconds % 60).padStart(2, "0")}s`;
  const vector = status.currentVector || "idle";
  const stage = status.currentStage || "idle";
  const counts = summarizeCounts(status.vectors?.[vector]?.counts || {});
  return `${isoNow()} [wave:${status.waveId}] vector=${vector} stage=${stage} elapsed=${label}${counts ? ` ${counts}` : ""}`;
}

async function runChild({
  status,
  statusPath,
  eventsPath,
  vectorName,
  stageName,
  label,
  command,
  args,
  logPath,
  heartbeatSeconds,
  onHeartbeat,
}) {
  const vector = makeVector(status, vectorName);
  vector.status = "running";
  vector.currentStage = stageName;
  vector.currentLogPath = logPath;
  status.currentVector = vectorName;
  status.currentStage = stageName;
  persistStatus(status, statusPath);
  appendJsonl(eventsPath, {
    type: "stage_started",
    generatedAt: isoNow(),
    vector: vectorName,
    stage: stageName,
    label,
    command: [command, ...args].join(" "),
    logPath,
  });
  process.stdout.write(`${isoNow()} [${vectorName}] ${stageName} started\n`);

  await new Promise((resolvePromise, rejectPromise) => {
    ensureParentDir(logPath);
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    status.currentChildPid = child.pid;
    persistStatus(status, statusPath);

    const interval = setInterval(() => {
      if (typeof onHeartbeat === "function") onHeartbeat();
      persistStatus(status, statusPath);
      const line = emitHeartbeat(status);
      process.stdout.write(`${line}\n`);
      appendJsonl(eventsPath, {
        type: "heartbeat",
        generatedAt: isoNow(),
        vector: vectorName,
        stage: stageName,
        line,
      });
    }, heartbeatSeconds * 1000);

    child.stdout.on("data", (chunk) => appendText(logPath, String(chunk)));
    child.stderr.on("data", (chunk) => appendText(logPath, String(chunk)));
    child.on("error", (error) => {
      clearInterval(interval);
      status.currentChildPid = null;
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearInterval(interval);
      status.currentChildPid = null;
      if (code === 0) {
        appendJsonl(eventsPath, {
          type: "stage_completed",
          generatedAt: isoNow(),
          vector: vectorName,
          stage: stageName,
          code,
          logPath,
        });
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function runPostRunChild({
  status,
  statusPath,
  eventsPath,
  stageName,
  label,
  command,
  args,
  logPath,
  heartbeatSeconds,
}) {
  status.currentVector = "post-run-review";
  status.currentStage = stageName;
  status.postRunReview.status = "running";
  persistStatus(status, statusPath);
  appendJsonl(eventsPath, {
    type: "post_run_review_started",
    generatedAt: isoNow(),
    stage: stageName,
    label,
    command: [command, ...args].join(" "),
    logPath,
  });
  process.stdout.write(`${isoNow()} [post-run-review] ${stageName} started\n`);

  await new Promise((resolvePromise, rejectPromise) => {
    ensureParentDir(logPath);
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    status.currentChildPid = child.pid;
    persistStatus(status, statusPath);

    const interval = setInterval(() => {
      persistStatus(status, statusPath);
      const line = emitHeartbeat(status);
      process.stdout.write(`${line}\n`);
      appendJsonl(eventsPath, {
        type: "heartbeat",
        generatedAt: isoNow(),
        vector: "post-run-review",
        stage: stageName,
        line,
      });
    }, heartbeatSeconds * 1000);

    child.stdout.on("data", (chunk) => appendText(logPath, String(chunk)));
    child.stderr.on("data", (chunk) => appendText(logPath, String(chunk)));
    child.on("error", (error) => {
      clearInterval(interval);
      status.currentChildPid = null;
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearInterval(interval);
      status.currentChildPid = null;
      if (code === 0) {
        appendJsonl(eventsPath, {
          type: "post_run_review_completed",
          generatedAt: isoNow(),
          stage: stageName,
          code,
          logPath,
        });
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

function buildCatalog({ waveId, outputRoot, status, pstBaseline }) {
  const runs = [];
  runs.push({
    runId: pstBaseline.runId,
    sourceFamily: "pst",
    manifestPath: pstBaseline.manifestPath,
    sqlitePath: pstBaseline.sqlitePath,
    status: "validated-baseline",
    generatedAt: isoNow(),
  });

  for (const item of status.mailRuns || []) {
    runs.push({
      runId: item.runId,
      sourceFamily: "mail",
      manifestPath: item.manifestPath,
      sqlitePath: item.sqlitePath,
      status: item.status,
      generatedAt: item.generatedAt || isoNow(),
    });
  }

  for (const key of ["twitter", "docs"]) {
    const vector = status.vectors[key];
    if (!vector?.manifestPath) continue;
    runs.push({
      runId: vector.runId,
      sourceFamily: key,
      manifestPath: vector.manifestPath,
      sqlitePath: vector.sqlitePath,
      status: vector.status,
      generatedAt: vector.finishedAt || isoNow(),
    });
  }

  return {
    schema: "canonical-memory-corpus-catalog.v2",
    generatedAt: isoNow(),
    waveId,
    rootPath: outputRoot,
    runCount: runs.length,
    runs,
  };
}

function writeWaveSummary({ waveId, outputRoot, statusPath, eventsPath, catalogPath, status }) {
  const summary = {
    schema: "open-memory-production-wave-summary.v1",
    generatedAt: isoNow(),
    waveId,
    outputRoot,
    statusPath,
    eventsPath,
    catalogPath,
    state: status.state,
    summary: status.summary,
    vectors: status.vectors,
    postRunReview: status.postRunReview,
  };
  writeJson(resolve(outputRoot, "wave-summary.json"), summary);
  writeFileSync(
    resolve(outputRoot, "wave-summary.md"),
    [
      `# Production Wave ${waveId}`,
      "",
      `State: ${status.state}`,
      "",
      `- PST: ${status.vectors.pst?.status || "unknown"}`,
      `- Mail: ${status.vectors.mail?.status || "unknown"} (${status.summary.mailFoldersCompleted}/${status.summary.mailFoldersQueued})`,
      `- Twitter: ${status.vectors.twitter?.status || "unknown"}`,
      `- Docs: ${status.vectors.docs?.status || "unknown"}`,
      `- Post-run review: ${status.postRunReview?.status || "pending"}${status.postRunReview?.flaggedFindings ? ` (${status.postRunReview.flaggedFindings} flagged)` : ""}`,
      "",
      `Catalog: ${catalogPath}`,
    ].join("\n"),
    "utf8"
  );
  return summary;
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const waveId = readStringFlag(flags, "wave-id", "").trim() || `production-wave-${isoNow().replace(/[:.]/g, "-")}`;
  const outputRoot = resolve(REPO_ROOT, readStringFlag(flags, "output-root", `./output/memory/${waveId}`));
  const resume = readBoolFlag(flags, "resume", true);
  const cleanOutputRoot = readBoolFlag(flags, "clean-output-root", false);
  const heartbeatSeconds = readNumberFlag(flags, "heartbeat-seconds", 15, { min: 5, max: 300 });
  const postRunReviewEnabled = readBoolFlag(flags, "post-run-review", true);
  const auditSeed = readStringFlag(flags, "audit-seed", "20260306").trim() || "20260306";
  const reviewMailSample = readNumberFlag(flags, "review-mail-sample", 8, { min: 1, max: 50 });
  const mailQueuePath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "mail-folder-queue", "./imports/mail/runs/mail-office365-folder-index-remaining-live.json")
  );
  const mailSnapshotRootFlag = readStringFlag(flags, "mail-snapshot-root", "").trim();
  const mailSnapshotRoot = mailSnapshotRootFlag ? resolve(REPO_ROOT, mailSnapshotRootFlag) : null;
  const twitterInputDir = resolve(
    REPO_ROOT,
    readStringFlag(
      flags,
      "twitter-input-dir",
      "./imports/zips-extracted/twitter-2022-11-05-ae20eb107636a73b2c164f5a827dd5896fc313b88cc28cdce7581ce5eb8ba2bb/data"
    )
  );
  const reusePstManifestFlag = readStringFlag(flags, "reuse-pst-manifest", "").trim();
  const reusePstManifest = reusePstManifestFlag ? resolve(REPO_ROOT, reusePstManifestFlag) : null;
  const reuseTwitterRootFlag = readStringFlag(flags, "reuse-twitter-root", "").trim();
  const reuseTwitterRoot = reuseTwitterRootFlag ? resolve(REPO_ROOT, reuseTwitterRootFlag) : null;
  const reuseDocsRootFlag = readStringFlag(flags, "reuse-docs-root", "").trim();
  const reuseDocsRoot = reuseDocsRootFlag ? resolve(REPO_ROOT, reuseDocsRootFlag) : null;
  const docsInputFlag = readStringFlag(flags, "docs-input", "").trim();
  if (!docsInputFlag && !reuseDocsRoot) throw new Error("--docs-input is required unless --reuse-docs-root is provided");
  const docsInputPath = docsInputFlag ? resolve(REPO_ROOT, docsInputFlag) : null;
  const docsAuditRootFlag = readStringFlag(flags, "docs-audit-root", "").trim();
  const pstBaselineRoot = resolve(REPO_ROOT, readStringFlag(flags, "pst-baseline-root", DEFAULT_PST_BASELINE_ROOT));
  const statusPath = resolve(outputRoot, readStringFlag(flags, "status-path", "./wave-status.json"));
  const eventsPath = resolve(outputRoot, readStringFlag(flags, "events-path", "./wave-events.jsonl"));
  const printJson = readBoolFlag(flags, "json", false);

  if (cleanOutputRoot) {
    rmSync(outputRoot, { recursive: true, force: true });
  }
  mkdirSync(outputRoot, { recursive: true });

  const existingStatus = resume && fileExists(statusPath) ? safeReadJson(statusPath, null) : null;
  const status =
    existingStatus && typeof existingStatus === "object"
      ? existingStatus
      : {
          schema: "open-memory-production-wave-status.v1",
          waveId,
          state: "pending",
          startedAt: isoNow(),
          updatedAt: isoNow(),
          currentVector: null,
          currentStage: null,
          currentChildPid: null,
          vectors: {},
          summary: {
            vectorsCompleted: 0,
            vectorsFailed: 0,
            mailFoldersQueued: 0,
            mailFoldersCompleted: 0,
            mailFoldersFailed: 0,
            postRunReviewStatus: "pending",
            postRunReviewWarnings: 0,
          },
          mailRuns: [],
          postRunReview: {
            status: "pending",
            startedAt: null,
            finishedAt: null,
            reviewJsonPath: null,
            reviewMdPath: null,
            auditJsonPath: null,
            auditMdPath: null,
            flaggedFindings: 0,
            warnings: [],
            errors: [],
          },
        };

  status.postRunReview = status.postRunReview || {
    status: "pending",
    startedAt: null,
    finishedAt: null,
    reviewJsonPath: null,
    reviewMdPath: null,
    auditJsonPath: null,
    auditMdPath: null,
    flaggedFindings: 0,
    warnings: [],
    errors: [],
  };
  status.summary.postRunReviewStatus = status.summary.postRunReviewStatus || status.postRunReview.status || "pending";
  status.summary.postRunReviewWarnings = Number(status.summary.postRunReviewWarnings || 0);

  const interrupt = (signal) => {
    status.state = "interrupted";
    status.currentStage = `${status.currentStage || "unknown"}:${signal}`;
    persistStatus(status, statusPath);
    appendJsonl(eventsPath, {
      type: "wave_interrupted",
      generatedAt: isoNow(),
      waveId,
      signal,
      currentVector: status.currentVector,
      currentStage: status.currentStage,
      currentChildPid: status.currentChildPid,
    });
    process.exit(130);
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);

  status.state = "running";
  persistStatus(status, statusPath);
  appendJsonl(eventsPath, { type: "wave_started", generatedAt: isoNow(), waveId, outputRoot });

  if (!fileExists(mailQueuePath)) throw new Error(`Mail queue not found at ${mailQueuePath}`);
  if (!reuseTwitterRoot && !fileExists(twitterInputDir)) throw new Error(`Twitter archive not found at ${twitterInputDir}`);
  if (reuseTwitterRoot && !fileExists(resolve(reuseTwitterRoot, "canonical-corpus/manifest.json"))) {
    throw new Error(`Reused twitter root missing manifest: ${reuseTwitterRoot}`);
  }
  if (!reuseDocsRoot && !fileExists(docsInputPath)) throw new Error(`Docs seed manifest not found at ${docsInputPath}`);
  if (reuseDocsRoot && !fileExists(resolve(reuseDocsRoot, "canonical-corpus/manifest.json"))) {
    throw new Error(`Reused docs root missing manifest: ${reuseDocsRoot}`);
  }
  if (mailSnapshotRoot && !fileExists(mailSnapshotRoot)) throw new Error(`Mail snapshot root not found at ${mailSnapshotRoot}`);

  const pstBaseline = {
    runId: basename(pstBaselineRoot),
    gatePath: resolve(pstBaselineRoot, "signal-quality/production-readiness.json"),
    manifestPath: reusePstManifest || resolve(pstBaselineRoot, "canonical-corpus/manifest.json"),
    sqlitePath: resolve(pstBaselineRoot, "canonical-corpus/corpus.sqlite"),
  };

  const pstVector = makeVector(status, "pst");
  status.currentVector = "pst";
  status.currentStage = "validate-baseline";
  pstVector.status = "running";
  pstVector.startedAt = pstVector.startedAt || isoNow();
  persistStatus(status, statusPath);
  const pstGate = safeReadJson(pstBaseline.gatePath, {});
  const pstPassed = Boolean(
    pstGate?.passed === true || pstGate?.pass === true || pstGate?.status === "PASS" || pstGate?.result === "PASS"
  );
  if (!fileExists(pstBaseline.gatePath) || !fileExists(pstBaseline.manifestPath) || !fileExists(pstBaseline.sqlitePath) || !pstPassed) {
    throw new Error("PST baseline validation failed.");
  }
  pstVector.status = "validated-baseline";
  pstVector.finishedAt = isoNow();
  pstVector.currentArtifact = pstBaseline.manifestPath;
  pstVector.manifestPath = pstBaseline.manifestPath;
  pstVector.sqlitePath = pstBaseline.sqlitePath;
  appendJsonl(eventsPath, { type: "vector_completed", generatedAt: isoNow(), vector: "pst", status: pstVector.status });
  persistStatus(status, statusPath);
  process.stdout.write(`${isoNow()} [pst] baseline validated\n`);

  const queueDocument = safeReadJson(mailQueuePath, {});
  const queueRows = Array.isArray(queueDocument?.rows) ? queueDocument.rows : [];
  const mailRows = queueRows.filter((row) => Number(row?.totalItemCount || 0) > 0);
  status.summary.mailFoldersQueued = Math.max(Number(status.summary.mailFoldersQueued || 0), mailRows.length);
  persistStatus(status, statusPath);

  const mailVector = makeVector(status, "mail");
  const mailAlreadyComplete =
    resume &&
    mailVector.status === "completed" &&
    Number(status.summary.mailFoldersCompleted || 0) >= mailRows.length;
  if (!mailAlreadyComplete) {
    mailVector.startedAt = mailVector.startedAt || isoNow();
    mailVector.status = "running";
    appendJsonl(eventsPath, { type: "vector_started", generatedAt: isoNow(), vector: "mail", queued: mailRows.length });

    for (let index = 0; index < mailRows.length; index += 1) {
    const row = mailRows[index];
    const folderKey = `${String(index + 1).padStart(4, "0")}-${slugify(row.path || row.displayName || row.id)}`;
    const folderRoot = resolve(outputRoot, "sources", "mail", folderKey);
    const runId = `mail-${waveId}-${folderKey}`;
    const sourceSnapshotRoot = mailSnapshotRoot ? resolve(mailSnapshotRoot, folderKey) : folderRoot;
    const snapshotPath = mailSnapshotRoot
      ? resolve(sourceSnapshotRoot, "mail-memory-outlook-snapshot.jsonl")
      : resolve(folderRoot, "mail-memory-outlook-snapshot.jsonl");
    const importReportPath = resolve(folderRoot, "mail-import-report.json");
    const corpusReportPath = resolve(folderRoot, "mail-corpus-export-report.json");

      if (safeReadJson(corpusReportPath, null) && fileExists(resolve(folderRoot, "canonical-corpus/manifest.json"))) {
        status.summary.mailFoldersCompleted += 1;
        const existingIndex = status.mailRuns.findIndex((item) => item.runId === runId);
        const nextRun = {
          runId,
          status: "completed",
          manifestPath: resolve(folderRoot, "canonical-corpus/manifest.json"),
          sqlitePath: resolve(folderRoot, "canonical-corpus/corpus.sqlite"),
          generatedAt: isoNow(),
        };
        if (existingIndex >= 0) status.mailRuns[existingIndex] = nextRun;
        else status.mailRuns.push(nextRun);
        persistStatus(status, statusPath);
        continue;
      }

    mailVector.currentStage = `folder ${index + 1}/${mailRows.length}`;
    mailVector.currentArtifact = folderRoot;
    mailVector.counts = {
      queuedFolders: mailRows.length,
      completedFolders: status.summary.mailFoldersCompleted,
      failedFolders: status.summary.mailFoldersFailed,
      currentFolderIndex: index + 1,
    };
    persistStatus(status, statusPath);

    try {
      if (mailSnapshotRoot) {
        if (!fileExists(snapshotPath)) {
          throw new Error(`Stored mail snapshot missing: ${snapshotPath}`);
        }
        mailVector.currentStage = `snapshot:${folderKey}`;
        mailVector.counts.lastExtractedRows = countJsonlRows(snapshotPath);
        persistStatus(status, statusPath);
      } else {
        await runChild({
          status,
          statusPath,
          eventsPath,
          vectorName: "mail",
          stageName: `extract:${folderKey}`,
          label: `mail import ${row.path || row.displayName || row.id}`,
          command: process.execPath,
          args: [
            "./scripts/open-memory-mail-import.mjs",
            "--mode",
            "outlook",
            "--run-id",
            runId,
            "--run-root",
            folderRoot,
            "--stage-mode",
            "extract-only",
            "--outlook-folder-id",
            String(row.id || ""),
            "--outlook-folder",
            String(row.displayName || row.path || "Inbox"),
            "--outlook-attachment-mode",
            "text",
            "--snapshot",
            snapshotPath,
            "--report",
            importReportPath,
            "--json",
          ],
          logPath: resolve(folderRoot, "mail-import.log"),
          heartbeatSeconds,
          onHeartbeat: () => {
            const report = safeReadJson(importReportPath, null);
            if (report?.sourceSummary) {
              mailVector.counts.lastExtractedRows = Number(report.sourceSummary.sourceCount || 0);
            } else if (fileExists(snapshotPath)) {
              mailVector.counts.lastExtractedRows = countJsonlRows(snapshotPath);
            }
          },
        });
      }

      await runChild({
        status,
        statusPath,
        eventsPath,
        vectorName: "mail",
        stageName: `corpus:${folderKey}`,
        label: `mail corpus ${row.path || row.displayName || row.id}`,
        command: process.execPath,
        args: [
          "./scripts/mail-memory-corpus-export.mjs",
          "--run-id",
          runId,
          "--snapshot",
          snapshotPath,
          "--run-root",
          folderRoot,
          "--sqlite-path",
          resolve(folderRoot, "canonical-corpus/corpus.sqlite"),
          "--ground-message-insights",
          "true",
          "--strict-message-insights",
          "true",
          "--ground-contact-facts",
          "true",
          "--ground-relationship-rhythms",
          "true",
          "--strict-relationship-rhythms",
          "true",
          "--json",
        ],
        logPath: resolve(folderRoot, "mail-corpus.log"),
        heartbeatSeconds,
        onHeartbeat: () => {
          const report = safeReadJson(corpusReportPath, null);
          if (report) {
            mailVector.counts.lastSqliteOk = report.sqliteStatus === "ok" ? 1 : 0;
          }
        },
      });

        status.summary.mailFoldersCompleted += 1;
        const existingIndex = status.mailRuns.findIndex((item) => item.runId === runId);
        const nextRun = {
          runId,
          status: "completed",
          manifestPath: resolve(folderRoot, "canonical-corpus/manifest.json"),
          sqlitePath: resolve(folderRoot, "canonical-corpus/corpus.sqlite"),
          generatedAt: isoNow(),
        };
        if (existingIndex >= 0) status.mailRuns[existingIndex] = nextRun;
        else status.mailRuns.push(nextRun);
        persistStatus(status, statusPath);
      } catch (error) {
        status.summary.mailFoldersFailed += 1;
        mailVector.errors.push(`${row.path || row.displayName || row.id}: ${error instanceof Error ? error.message : String(error)}`);
        appendJsonl(eventsPath, {
          type: "vector_failed",
          generatedAt: isoNow(),
          vector: "mail",
          folder: row.path || row.displayName || row.id,
          error: error instanceof Error ? error.message : String(error),
        });
        persistStatus(status, statusPath);
      }
    }

    if (mailRows.length > 0 && status.summary.mailFoldersFailed / mailRows.length > 0.05) {
      mailVector.warnings.push("Mail vector exceeded the 5% folder failure budget.");
      appendJsonl(eventsPath, {
        type: "vector_warning",
        generatedAt: isoNow(),
        vector: "mail",
        warning: "Mail vector exceeded the 5% folder failure budget.",
        failedFolders: status.summary.mailFoldersFailed,
        queuedFolders: mailRows.length,
      });
      persistStatus(status, statusPath);
    }
    mailVector.status = "completed";
    mailVector.finishedAt = isoNow();
    mailVector.counts.completedFolders = status.summary.mailFoldersCompleted;
    mailVector.counts.failedFolders = status.summary.mailFoldersFailed;
    appendJsonl(eventsPath, { type: "vector_completed", generatedAt: isoNow(), vector: "mail", status: "completed" });
    persistStatus(status, statusPath);
  } else {
    process.stdout.write(`${isoNow()} [mail] resume detected, skipping completed vector\n`);
  }

  const twitterVector = makeVector(status, "twitter");
  const twitterRunRoot = reuseTwitterRoot || resolve(outputRoot, "sources", "twitter");
  const twitterManifestPath = resolve(twitterRunRoot, "canonical-corpus/manifest.json");
  const twitterSqlitePath = resolve(twitterRunRoot, "canonical-corpus/corpus.sqlite");
  const twitterAlreadyComplete = resume && twitterVector.status === "completed" && fileExists(twitterManifestPath) && fileExists(twitterSqlitePath);
  if (reuseTwitterRoot) {
    twitterVector.startedAt = twitterVector.startedAt || isoNow();
    twitterVector.status = "completed";
    twitterVector.finishedAt = isoNow();
    twitterVector.currentArtifact = twitterManifestPath;
    twitterVector.manifestPath = twitterManifestPath;
    twitterVector.sqlitePath = twitterSqlitePath;
    twitterVector.runId = twitterVector.runId || basename(twitterRunRoot);
    appendJsonl(eventsPath, { type: "vector_completed", generatedAt: isoNow(), vector: "twitter", status: "completed", reused: true });
    persistStatus(status, statusPath);
  } else if (!twitterAlreadyComplete) {
    twitterVector.startedAt = twitterVector.startedAt || isoNow();
    twitterVector.runId = twitterVector.runId || `twitter-${waveId}`;
    appendJsonl(eventsPath, { type: "vector_started", generatedAt: isoNow(), vector: "twitter" });
    await runChild({
      status,
      statusPath,
      eventsPath,
      vectorName: "twitter",
      stageName: "run",
      label: "twitter corpus",
      command: process.execPath,
      args: [
        "./scripts/twitter-memory-corpus-export.mjs",
        "--run-id",
        twitterVector.runId,
        "--input-dir",
        twitterInputDir,
        "--run-root",
        twitterRunRoot,
        "--sqlite-path",
        twitterSqlitePath,
        "--json",
      ],
      logPath: resolve(twitterRunRoot, "twitter-corpus.log"),
      heartbeatSeconds,
      onHeartbeat: () => {
        const report = safeReadJson(resolve(twitterRunRoot, "twitter-promote-report.json"), null);
        if (report?.counts) {
          twitterVector.counts.analyzedRows = Number(report.counts.inputRows || 0);
          twitterVector.counts.promotedRows = Number(report.counts.promotedRows || 0);
        }
      },
    });
    twitterVector.status = "completed";
    twitterVector.finishedAt = isoNow();
    twitterVector.currentArtifact = twitterManifestPath;
    twitterVector.manifestPath = twitterManifestPath;
    twitterVector.sqlitePath = twitterSqlitePath;
    appendJsonl(eventsPath, { type: "vector_completed", generatedAt: isoNow(), vector: "twitter", status: "completed" });
    persistStatus(status, statusPath);
  } else {
    process.stdout.write(`${isoNow()} [twitter] resume detected, skipping completed vector\n`);
  }

  const docsVector = makeVector(status, "docs");
  const docsRunRoot = reuseDocsRoot || resolve(outputRoot, "sources", "docs");
  const docsManifestPath = resolve(docsRunRoot, "canonical-corpus/manifest.json");
  const docsSqlitePath = resolve(docsRunRoot, "canonical-corpus/corpus.sqlite");
  const docsAlreadyComplete = resume && docsVector.status === "completed" && fileExists(docsManifestPath) && fileExists(docsSqlitePath);
  if (reuseDocsRoot) {
    docsVector.startedAt = docsVector.startedAt || isoNow();
    docsVector.status = "completed";
    docsVector.finishedAt = isoNow();
    docsVector.currentArtifact = docsManifestPath;
    docsVector.manifestPath = docsManifestPath;
    docsVector.sqlitePath = docsSqlitePath;
    docsVector.runId = docsVector.runId || basename(docsRunRoot);
    appendJsonl(eventsPath, { type: "vector_completed", generatedAt: isoNow(), vector: "docs", status: "completed", reused: true });
    persistStatus(status, statusPath);
  } else if (!docsAlreadyComplete) {
    docsVector.startedAt = docsVector.startedAt || isoNow();
    docsVector.runId = docsVector.runId || `docs-${waveId}`;
    appendJsonl(eventsPath, { type: "vector_started", generatedAt: isoNow(), vector: "docs" });
    await runChild({
      status,
      statusPath,
      eventsPath,
      vectorName: "docs",
      stageName: "run",
      label: "docs corpus",
      command: process.execPath,
      args: [
        "./scripts/document-metadata-corpus-export.mjs",
          "--run-id",
          docsVector.runId,
          "--input",
          docsInputPath,
        "--run-root",
        docsRunRoot,
        "--sqlite-path",
        docsSqlitePath,
        "--json",
      ],
      logPath: resolve(docsRunRoot, "docs-corpus.log"),
      heartbeatSeconds,
      onHeartbeat: () => {
        const report = safeReadJson(resolve(docsRunRoot, "document-promote-report.json"), null);
        if (report?.counts) {
          docsVector.counts.analyzedRows = Number(report.counts.inputRows || 0);
          docsVector.counts.promotedRows = Number(report.counts.promotedRows || 0);
        }
      },
    });
    docsVector.status = "completed";
    docsVector.finishedAt = isoNow();
    docsVector.currentArtifact = docsManifestPath;
    docsVector.manifestPath = docsManifestPath;
    docsVector.sqlitePath = docsSqlitePath;
    appendJsonl(eventsPath, { type: "vector_completed", generatedAt: isoNow(), vector: "docs", status: "completed" });
    persistStatus(status, statusPath);
  } else {
    process.stdout.write(`${isoNow()} [docs] resume detected, skipping completed vector\n`);
  }

  const catalog = buildCatalog({ waveId, outputRoot, status, pstBaseline });
  const catalogPath = resolve(outputRoot, "ingest-catalog.json");
  writeJson(catalogPath, catalog);
  writeWaveSummary({ waveId, outputRoot, statusPath, eventsPath, catalogPath, status });

  const reviewJsonPath = resolve(outputRoot, "production-review.json");
  const reviewMdPath = resolve(outputRoot, "production-review.md");
  const auditJsonPath = resolve(outputRoot, "production-audit.json");
  const auditMdPath = resolve(outputRoot, "production-audit.md");
  status.postRunReview.reviewJsonPath = reviewJsonPath;
  status.postRunReview.reviewMdPath = reviewMdPath;
  status.postRunReview.auditJsonPath = auditJsonPath;
  status.postRunReview.auditMdPath = auditMdPath;

  if (postRunReviewEnabled) {
    status.postRunReview.startedAt = isoNow();
    status.postRunReview.finishedAt = null;
    status.postRunReview.warnings = [];
    status.postRunReview.errors = [];
    status.postRunReview.flaggedFindings = 0;
    try {
      await runPostRunChild({
        status,
        statusPath,
        eventsPath,
        stageName: "review",
        label: "production review",
        command: process.execPath,
        args: [
          "./scripts/open-memory-production-review.mjs",
          "--wave-root",
          outputRoot,
          "--mail-sample",
          String(reviewMailSample),
          "--json",
        ],
        logPath: resolve(outputRoot, "post-run-review.log"),
        heartbeatSeconds,
      });

      await runPostRunChild({
        status,
        statusPath,
        eventsPath,
        stageName: "audit",
        label: "production audit",
        command: process.execPath,
        args: [
          "./scripts/open-memory-production-audit.mjs",
          "--wave-root",
          outputRoot,
          "--docs-root",
          docsAuditRootFlag ? resolve(REPO_ROOT, docsAuditRootFlag) : sourceRootFromManifest(status.vectors.docs?.manifestPath || docsManifestPath),
          "--seed",
          auditSeed,
          "--json",
        ],
        logPath: resolve(outputRoot, "post-run-audit.log"),
        heartbeatSeconds,
      });

      const review = safeReadJson(reviewJsonPath, {});
      const audit = safeReadJson(auditJsonPath, {});
      const findings = Array.isArray(audit?.findings) ? audit.findings : [];
      const coverageFamilies = new Set((Array.isArray(review?.sourceSummaries) ? review.sourceSummaries : []).map((item) => item?.sourceFamily));
      const warnings = [];
      const highRiskFindings = findings.filter((item) => String(item?.driftRisk || "") === "high");
      if (findings.length !== 2) warnings.push(`Expected 2 audit findings, got ${findings.length}.`);
      for (const family of ["pst", "mail", "twitter", "docs"]) {
        if (!coverageFamilies.has(family)) warnings.push(`Review coverage missing ${family}.`);
      }
      if (highRiskFindings.length > 0) warnings.push(`${highRiskFindings.length} randomized findings flagged high drift risk.`);
      status.postRunReview.flaggedFindings = highRiskFindings.length;
      status.postRunReview.warnings = warnings;
      status.postRunReview.status = warnings.length > 0 ? "warn" : "pass";
      status.postRunReview.finishedAt = isoNow();
      appendJsonl(eventsPath, {
        type: warnings.length > 0 ? "post_run_review_warning" : "post_run_review_completed",
        generatedAt: isoNow(),
        status: status.postRunReview.status,
        flaggedFindings: status.postRunReview.flaggedFindings,
        warnings,
      });
      persistStatus(status, statusPath);
    } catch (error) {
      status.postRunReview.status = "failed";
      status.postRunReview.finishedAt = isoNow();
      status.postRunReview.errors = [error instanceof Error ? error.message : String(error)];
      status.postRunReview.warnings = ["Post-run review failed; core vector outputs remain valid."];
      appendJsonl(eventsPath, {
        type: "post_run_review_failed",
        generatedAt: isoNow(),
        error: error instanceof Error ? error.message : String(error),
      });
      persistStatus(status, statusPath);
    }
  } else {
    status.postRunReview.status = "disabled";
    status.postRunReview.finishedAt = isoNow();
    persistStatus(status, statusPath);
  }

  status.state = "completed";
  status.currentVector = null;
  status.currentStage = null;
  persistStatus(status, statusPath);
  const summary = writeWaveSummary({ waveId, outputRoot, statusPath, eventsPath, catalogPath, status });
  appendJsonl(eventsPath, { type: "wave_completed", generatedAt: isoNow(), waveId, catalogPath });

  if (printJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  process.stdout.write(`production wave complete\noutput-root: ${outputRoot}\nstatus: ${statusPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`open-memory-production-wave failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
