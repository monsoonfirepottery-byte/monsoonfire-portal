#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mintStaffIdTokenFromPortalEnv } from "./lib/firebase-auth-token.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const args = process.argv.slice(2);

function resolveRepoPath(target) {
  return resolve(REPO_ROOT, String(target || "").trim());
}

function resolveHomeOrRepoDefault(...relativeCandidates) {
  for (const relativePath of relativeCandidates) {
    const homePath = resolve(homedir(), relativePath);
    if (existsSync(homePath)) return homePath;
    const repoPath = resolve(REPO_ROOT, relativePath);
    if (existsSync(repoPath)) return repoPath;
  }
  return resolve(homedir(), relativeCandidates[0]);
}

function readFlag(name, fallback = undefined) {
  const key = `--${name}`;
  const index = args.indexOf(key);
  if (index === -1) return fallback;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) return "true";
  return next;
}

function readBool(name, fallback = false) {
  const value = readFlag(name, undefined);
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseJson(raw) {
  try {
    return JSON.parse(String(raw ?? "").trim());
  } catch {
    return null;
  }
}

function fileHasContent(path) {
  if (!existsSync(path)) return false;
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
}

function runNode(scriptPath, scriptArgs, options = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 32,
    env: process.env,
  });
  const ok = result.status === 0;
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  if (!ok && !options.allowFailure) {
    throw new Error(
      `Command failed: node ${scriptPath} ${scriptArgs.join(" ")}\n` +
        `${stderr || stdout || `exit code ${String(result.status ?? "unknown")}`}`
    );
  }
  return {
    ok,
    status: typeof result.status === "number" ? result.status : null,
    stdout,
    stderr,
    parsed: parseJson(stdout),
  };
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {
      attempted: false,
      loaded: false,
      filePath,
      keysLoaded: 0,
    };
  }
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  let keysLoaded = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key || process.env[key]) continue;
    process.env[key] = value;
    keysLoaded += 1;
  }
  return {
    attempted: true,
    loaded: keysLoaded > 0,
    filePath,
    keysLoaded,
  };
}

function normalizeBearer(token) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  return /^bearer\s+/i.test(raw) ? raw : `Bearer ${raw}`;
}

function extractImportCounts(value) {
  const queue = [value];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || typeof next !== "object") continue;
    const imported = Number(next.imported);
    const failed = Number(next.failed);
    const total = Number(next.total);
    if (Number.isFinite(imported) && Number.isFinite(failed)) {
      return {
        imported,
        failed,
        total: Number.isFinite(total) ? total : imported + failed,
      };
    }
    for (const nested of Object.values(next)) {
      if (nested && typeof nested === "object") {
        queue.push(nested);
      }
    }
  }
  return null;
}

function extractStatsTotal(value) {
  if (!value || typeof value !== "object") return null;
  const direct = Number(value.total);
  if (Number.isFinite(direct)) return direct;
  const nested = Number(value.stats?.total);
  if (Number.isFinite(nested)) return nested;
  return null;
}

function splitJsonlIntoChunkFiles(filePath, chunkSize) {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return {
      totalRows: 0,
      chunkPaths: [],
    };
  }
  const chunkPaths = [];
  for (let index = 0; index < lines.length; index += chunkSize) {
    const part = lines.slice(index, index + chunkSize);
    const chunkPath = `${filePath}.part-${Math.floor(index / chunkSize) + 1}.jsonl`;
    writeFileSync(chunkPath, `${part.join("\n")}\n`, "utf8");
    chunkPaths.push(chunkPath);
  }
  return {
    totalRows: lines.length,
    chunkPaths,
  };
}

function importJsonlInBatches({
  inputPath,
  source,
  continueOnError,
  strictImport,
  batchSize,
  warnings,
  disableRunBurstLimit,
}) {
  if (!fileHasContent(inputPath)) {
    return {
      attempted: true,
      ok: true,
      imported: 0,
      failed: 0,
      batches: 0,
      rows: 0,
      nonJsonFailures: 0,
    };
  }

  const { totalRows, chunkPaths } = splitJsonlIntoChunkFiles(inputPath, batchSize);
  let imported = 0;
  let failed = 0;
  let nonJsonFailures = 0;
  let ok = true;

  try {
    for (const chunkPath of chunkPaths) {
      const importArgs = [
        "import",
        "--input",
        chunkPath,
        "--source",
        source,
        "--continue-on-error",
        continueOnError ? "true" : "false",
      ];
      if (disableRunBurstLimit) {
        importArgs.push("--disable-run-burst-limit", "true");
      }
      const importRun = runNode("scripts/open-memory.mjs", importArgs, { allowFailure: !strictImport });
      const counts = extractImportCounts(importRun.parsed);
      if (counts) {
        imported += counts.imported;
        failed += counts.failed;
      } else {
        nonJsonFailures += 1;
        ok = false;
        warnings.push(`Could not parse import response for chunk ${chunkPath}.`);
      }
      if (!importRun.ok) {
        ok = false;
        const details = importRun.stderr || importRun.stdout || `status=${String(importRun.status ?? "unknown")}`;
        warnings.push(`Import chunk failed for ${chunkPath}: ${details}`);
        if (strictImport) {
          break;
        }
      }
    }
  } finally {
    for (const chunkPath of chunkPaths) {
      try {
        unlinkSync(chunkPath);
      } catch {
        // best-effort cleanup
      }
    }
  }

  return {
    attempted: true,
    ok,
    imported,
    failed,
    batches: chunkPaths.length,
    rows: totalRows,
    nonJsonFailures,
  };
}

function maybeForward(flagName, target) {
  const value = readFlag(flagName, undefined);
  if (value === undefined) return;
  target.push(`--${flagName}`, String(value));
}

const today = new Date().toISOString().slice(0, 10);
const source = String(readFlag("source", `context-slice:${today}`));
const runScope = String(readFlag("run-scope", new Date().toISOString().replace(/[:.]/g, "-"))).trim();
const outputPath = resolveRepoPath(readFlag("output", "./imports/memory-context-slice.jsonl"));
const summaryOutputPath = resolveRepoPath(readFlag("summary-output", "./output/open-memory/context-sync-latest.json"));
const importBatchSizeRaw = Number(readFlag("import-batch-size", "400"));
const importBatchSize =
  Number.isFinite(importBatchSizeRaw) && importBatchSizeRaw > 0
    ? Math.max(1, Math.min(500, Math.trunc(importBatchSizeRaw)))
    : 400;
const continueOnError = readBool("continue-on-error", true);
const doImport = readBool("import", true);
const strictImport = readBool("strict-import", false);
const disableRunBurstLimit = readBool("disable-run-burst-limit", false);
const loadEnvFileFlag = readBool("load-env-file", true);
const envFilePath = resolveRepoPath(
  readFlag(
    "env-file",
    resolveHomeOrRepoDefault("secrets/studio-brain/studio-brain-automation.env", "secrets/studio-brain/studio-brain-mcp.env")
  )
);
const loadPortalEnvFileFlag = readBool("load-portal-env-file", true);
const portalEnvFilePath = resolveRepoPath(
  readFlag("portal-env-file", resolveHomeOrRepoDefault("secrets/portal/portal-automation.env"))
);
const mintStaffTokenFlag = readBool("mint-staff-token", true);
const includeResumable = readBool("include-resumable", false);
const resumableSource = String(readFlag("resumable-source", "codex-resumable-session"));
const resumableOutputPath = resolveRepoPath(readFlag("resumable-output", "./imports/codex-resumable-memory.latest.jsonl"));
const resumableSessionsRoot = resolveRepoPath(readFlag("sessions-root", resolve(homedir(), ".codex", "sessions")));
const resumableMaxItems = String(readFlag("resumable-max-items", "1200"));
const resumableExcludeRecentMinutes = String(readFlag("resumable-exclude-recent-minutes", "30"));
const includeRepoMarkdown = readBool("include-repo-markdown", false);
const repoMarkdownSource = String(readFlag("repo-markdown-source", "repo-markdown"));
const repoMarkdownOutputPath = resolveRepoPath(readFlag("repo-markdown-output", "./imports/repo-markdown-memory.latest.jsonl"));
const repoMarkdownRepoRoot = resolveRepoPath(readFlag("repo-root", REPO_ROOT));
const includeHistoryExport = readBool("include-history-export", false);
const historySource = String(readFlag("history-source", "codex-history-export"));
const historyOutputPath = resolveRepoPath(readFlag("history-output", "./imports/codex-history-memory.latest.jsonl"));
const historyInputPath = resolveRepoPath(readFlag("history-input", resolve(homedir(), ".codex", "memory", "raw", "conversations.json")));
const historySharedInputPath = resolveRepoPath(
  readFlag("history-shared-input", resolve(homedir(), ".codex", "memory", "raw", "shared_conversations.json"))
);
const runStats = readBool("stats", true);

const summary = {
  startedAt: new Date().toISOString(),
  source,
  runScope,
  outputs: {
    contextSlice: outputPath,
    summary: summaryOutputPath,
    resumableSlice: includeResumable ? resumableOutputPath : null,
    repoMarkdownSlice: includeRepoMarkdown ? repoMarkdownOutputPath : null,
    historySlice: includeHistoryExport ? historyOutputPath : null,
  },
  env: {
    loadEnvFile: loadEnvFileFlag,
    envFilePath,
    envFileLoaded: false,
    envFileKeysLoaded: 0,
    loadPortalEnvFile: loadPortalEnvFileFlag,
    portalEnvFilePath,
    portalEnvFileLoaded: false,
    portalEnvFileKeysLoaded: 0,
    baseUrlResolved: false,
    authTokenReady: false,
    authTokenSource: "",
    mintStaffTokenAttempted: false,
    mintStaffTokenOk: false,
    mintStaffTokenReason: "",
  },
  build: {
    ok: false,
    total: 0,
    byCategory: {},
  },
  resumable: {
    enabled: includeResumable,
    ok: false,
    extracted: 0,
  },
  repoMarkdown: {
    enabled: includeRepoMarkdown,
    ok: false,
    extracted: 0,
  },
  history: {
    enabled: includeHistoryExport,
    ok: false,
    extracted: 0,
  },
  import: {
    enabled: doImport,
    attempted: false,
    batchSize: importBatchSize,
    disableRunBurstLimit,
    skippedReason: "",
    contextSlice: {
      attempted: false,
      ok: false,
      imported: 0,
      failed: 0,
    },
    resumable: {
      attempted: false,
      ok: false,
      imported: 0,
      failed: 0,
    },
    repoMarkdown: {
      attempted: false,
      ok: false,
      imported: 0,
      failed: 0,
    },
    history: {
      attempted: false,
      ok: false,
      imported: 0,
      failed: 0,
    },
    totalImported: 0,
    totalFailed: 0,
  },
  stats: {
    attempted: false,
    ok: false,
    total: null,
  },
  warnings: [],
  finishedAt: null,
};

const buildArgs = ["--output", outputPath, "--source", source];
buildArgs.push("--run-scope", runScope);
[
  "max-items",
  "max-chars",
  "limit-intent",
  "limit-ticket",
  "limit-doc",
  "limit-intent-output",
  "limit-memory-ledger",
  "limit-git",
  "limit-github",
  "limit-mcp",
  "limit-artifact",
].forEach((flag) => maybeForward(flag, buildArgs));

const buildResult = runNode("scripts/build-memory-context-slice.mjs", buildArgs);
summary.build.ok = buildResult.ok;
summary.build.total = Number(buildResult.parsed?.total ?? 0);
summary.build.byCategory = buildResult.parsed?.byCategory ?? {};
if (!summary.build.ok || !fileHasContent(outputPath)) {
  throw new Error("Context slice build did not produce a usable output file.");
}

if (includeResumable) {
  const resumableArgs = [
    "--sessions-root",
    resumableSessionsRoot,
    "--output",
    resumableOutputPath,
    "--source",
    resumableSource,
    "--max-items",
    resumableMaxItems,
    "--exclude-recent-minutes",
    resumableExcludeRecentMinutes,
  ];
  const resumableResult = runNode("scripts/extract-codex-resumable-memory.mjs", resumableArgs, { allowFailure: true });
  summary.resumable.ok = resumableResult.ok && fileHasContent(resumableOutputPath);
  summary.resumable.extracted = Number(resumableResult.parsed?.extracted ?? 0);
  if (!summary.resumable.ok) {
    summary.warnings.push(
      "Resumable-session extraction did not produce content. Continuing with context slice import only."
    );
  }
}

if (includeRepoMarkdown) {
  const repoMarkdownResult = runNode(
    "scripts/repo-markdown-corpus-export.mjs",
    [
      "--run-id",
      `context-sync-repo-markdown-${runScope}`.slice(0, 120),
      "--repo-root",
      repoMarkdownRepoRoot,
      "--run-root",
      resolve(`./output/open-memory/context-sync/${runScope}/repo-markdown`),
      "--adapter-output",
      repoMarkdownOutputPath,
      "--skip-sqlite",
      "true",
      "--json",
    ],
    { allowFailure: true }
  );
  summary.repoMarkdown.ok = repoMarkdownResult.ok && fileHasContent(repoMarkdownOutputPath);
  summary.repoMarkdown.extracted = Number(repoMarkdownResult.parsed?.counts?.adapterRows ?? 0);
  if (!summary.repoMarkdown.ok) {
    summary.warnings.push("Repo markdown export did not produce adapter rows. Continuing without repo markdown import.");
  }
}

if (includeHistoryExport) {
  const historyResult = runNode(
    "scripts/codex-history-corpus-export.mjs",
    [
      "--run-id",
      `context-sync-history-${runScope}`.slice(0, 120),
      "--input",
      historyInputPath,
      "--shared-input",
      historySharedInputPath,
      "--run-root",
      resolve(`./output/open-memory/context-sync/${runScope}/codex-history`),
      "--adapter-output",
      historyOutputPath,
      "--skip-sqlite",
      "true",
      "--json",
    ],
    { allowFailure: true }
  );
  summary.history.ok = historyResult.ok && fileHasContent(historyOutputPath);
  summary.history.extracted = Number(historyResult.parsed?.counts?.adapterRows ?? 0);
  if (!summary.history.ok) {
    summary.warnings.push("Historical conversation export did not produce adapter rows. Continuing without history import.");
  }
}

if (loadEnvFileFlag) {
  const envLoad = loadEnvFile(envFilePath);
  summary.env.envFileLoaded = envLoad.loaded;
  summary.env.envFileKeysLoaded = envLoad.keysLoaded;
}

if (loadPortalEnvFileFlag) {
  const portalLoad = loadEnvFile(portalEnvFilePath);
  summary.env.portalEnvFileLoaded = portalLoad.loaded;
  summary.env.portalEnvFileKeysLoaded = portalLoad.keysLoaded;
}

if (!process.env.STUDIO_BRAIN_BASE_URL) {
  const resolved = String(resolveStudioBrainBaseUrlFromEnv({ env: process.env })).trim();
  if (resolved) {
    process.env.STUDIO_BRAIN_BASE_URL = resolved.replace(/\/$/, "");
    summary.env.baseUrlResolved = true;
  }
}

const existingAuth = String(process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN || "").trim();
if (!existingAuth && mintStaffTokenFlag) {
  summary.env.mintStaffTokenAttempted = true;
  const minted = await mintStaffIdTokenFromPortalEnv({
    env: process.env,
    defaultCredentialsPath: resolveHomeOrRepoDefault("secrets/portal/portal-agent-staff.json"),
    preferRefreshToken: true,
  });
  summary.env.mintStaffTokenOk = minted.ok;
  summary.env.mintStaffTokenReason = minted.reason;
  if (minted.ok && minted.token) {
    process.env.STUDIO_BRAIN_ID_TOKEN = minted.token;
    process.env.STUDIO_BRAIN_AUTH_TOKEN = normalizeBearer(minted.token);
    summary.env.authTokenSource = "minted-from-portal-credentials";
  }
}

if (!process.env.STUDIO_BRAIN_AUTH_TOKEN && process.env.STUDIO_BRAIN_ID_TOKEN) {
  process.env.STUDIO_BRAIN_AUTH_TOKEN = normalizeBearer(process.env.STUDIO_BRAIN_ID_TOKEN);
  if (!summary.env.authTokenSource) {
    summary.env.authTokenSource = "derived-from-id-token";
  }
}
if (!summary.env.authTokenSource && process.env.STUDIO_BRAIN_AUTH_TOKEN) {
  summary.env.authTokenSource = "preconfigured-auth-token";
}
summary.env.authTokenReady = Boolean(process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN);

if (doImport) {
  const hasAuthToken = Boolean(process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN);
  const hasBaseUrl = Boolean(process.env.STUDIO_BRAIN_BASE_URL);
  if (!hasAuthToken || !hasBaseUrl) {
    summary.import.skippedReason = "missing STUDIO_BRAIN_BASE_URL or auth token env";
  } else {
    summary.import.attempted = true;
    summary.import.contextSlice.attempted = true;
    const contextImport = importJsonlInBatches({
      inputPath: outputPath,
      source,
      continueOnError,
      strictImport,
      batchSize: importBatchSize,
      disableRunBurstLimit,
      warnings: summary.warnings,
    });
    summary.import.contextSlice.ok = contextImport.ok;
    summary.import.contextSlice.imported = contextImport.imported;
    summary.import.contextSlice.failed = contextImport.failed;
    summary.import.totalImported += contextImport.imported;
    summary.import.totalFailed += contextImport.failed;

    if (includeResumable && summary.resumable.ok && fileHasContent(resumableOutputPath)) {
      summary.import.resumable.attempted = true;
      const resumableImport = importJsonlInBatches({
        inputPath: resumableOutputPath,
        source: resumableSource,
        continueOnError,
        strictImport,
        batchSize: importBatchSize,
        disableRunBurstLimit,
        warnings: summary.warnings,
      });
      summary.import.resumable.ok = resumableImport.ok;
      summary.import.resumable.imported = resumableImport.imported;
      summary.import.resumable.failed = resumableImport.failed;
      summary.import.totalImported += resumableImport.imported;
      summary.import.totalFailed += resumableImport.failed;
    }

    if (includeRepoMarkdown && summary.repoMarkdown.ok && fileHasContent(repoMarkdownOutputPath)) {
      summary.import.repoMarkdown.attempted = true;
      const repoMarkdownImport = importJsonlInBatches({
        inputPath: repoMarkdownOutputPath,
        source: repoMarkdownSource,
        continueOnError,
        strictImport,
        batchSize: importBatchSize,
        disableRunBurstLimit,
        warnings: summary.warnings,
      });
      summary.import.repoMarkdown.ok = repoMarkdownImport.ok;
      summary.import.repoMarkdown.imported = repoMarkdownImport.imported;
      summary.import.repoMarkdown.failed = repoMarkdownImport.failed;
      summary.import.totalImported += repoMarkdownImport.imported;
      summary.import.totalFailed += repoMarkdownImport.failed;
    }

    if (includeHistoryExport && summary.history.ok && fileHasContent(historyOutputPath)) {
      summary.import.history.attempted = true;
      const historyImport = importJsonlInBatches({
        inputPath: historyOutputPath,
        source: historySource,
        continueOnError,
        strictImport,
        batchSize: importBatchSize,
        disableRunBurstLimit,
        warnings: summary.warnings,
      });
      summary.import.history.ok = historyImport.ok;
      summary.import.history.imported = historyImport.imported;
      summary.import.history.failed = historyImport.failed;
      summary.import.totalImported += historyImport.imported;
      summary.import.totalFailed += historyImport.failed;
    }

    if (runStats) {
      const statsResult = runNode("scripts/open-memory.mjs", ["stats"], { allowFailure: true });
      summary.stats.attempted = true;
      summary.stats.ok = statsResult.ok;
      summary.stats.total = extractStatsTotal(statsResult.parsed);
      if (!statsResult.ok) {
        summary.warnings.push("Open Memory stats probe failed after import.");
      }
    }
  }
}

summary.finishedAt = new Date().toISOString();
mkdirSync(dirname(summaryOutputPath), { recursive: true });
writeFileSync(summaryOutputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

if (
  strictImport &&
  doImport &&
  summary.import.attempted &&
  (!summary.import.contextSlice.ok ||
    (summary.import.resumable.attempted && !summary.import.resumable.ok) ||
    (summary.import.repoMarkdown.attempted && !summary.import.repoMarkdown.ok) ||
    (summary.import.history.attempted && !summary.import.history.ok))
) {
  process.exit(1);
}
