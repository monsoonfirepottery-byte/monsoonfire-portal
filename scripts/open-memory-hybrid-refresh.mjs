#!/usr/bin/env node

import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { mintStaffIdTokenFromPortalEnv } from "./lib/firebase-auth-token.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";
import {
  parseCliArgs,
  readBoolFlag,
  readStringFlag,
  readNumberFlag,
  runCommand,
  readJson,
  writeJson,
  isoNow,
} from "./lib/pst-memory-utils.mjs";
import {
  codexPath,
  defaultRunRoot,
  joinRunPath,
  mergeJsonlArtifacts,
  buildCombinedManifest,
} from "./lib/hybrid-memory-pipeline-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

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

function usage() {
  process.stdout.write(
    [
      "Hybrid Codex + markdown memory refresh",
      "",
      "Usage:",
      "  node ./scripts/open-memory-hybrid-refresh.mjs --run-id hybrid-2026-03-19",
      "",
      "Options:",
      "  --run-id <id>                Stable run id",
      "  --run-root <path>            Artifact root (default: ./output/memory/<run-id>)",
      "  --sessions-root <path>       Codex session root (default: ~/.codex/sessions)",
      "  --history-input <path>       Conversations JSON (default: ~/.codex/memory/raw/conversations.json)",
      "  --history-shared-input <path> Optional shared conversations JSON",
      "  --repo-root <path>           Repo root for markdown scan (default: current repo)",
      "  --adapter-output <path>      Combined adapter JSONL output",
      "  --combined-manifest <path>   Combined corpus manifest output",
      "  --sqlite-path <path>         Combined SQLite output",
      "  --import <t/f>               Import curated adapter rows into Studio Brain (default: true)",
      "  --import-batch-size <n>      Batch size for adapter import (default: 300)",
      "  --skip-sqlite <t/f>          Skip combined SQLite materialization",
      "  --load-env-file <t/f>        Load Studio Brain env file (default: true)",
      "  --env-file <path>            Studio Brain env file",
      "  --load-portal-env-file <t/f> Load portal env file (default: true)",
      "  --portal-env-file <path>     Portal env file",
      "  --mint-staff-token <t/f>     Mint a staff token from portal creds (default: true)",
      "  --json                       Print final report JSON",
    ].join("\n")
  );
}

function loadEnvFile(filePath) {
  if (!filePath) return { loaded: false, keysLoaded: 0 };
  let raw = "";
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { loaded: false, keysLoaded: 0 };
  }
  let keysLoaded = 0;
  for (const line of raw.split(/\r?\n/)) {
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
    loaded: keysLoaded > 0,
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
      if (nested && typeof nested === "object") queue.push(nested);
    }
  }
  return null;
}

function splitJsonlIntoChunkFiles(filePath, chunkSize) {
  const lines = String(readFileSync(filePath, "utf8") || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { totalRows: 0, chunkPaths: [] };
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

function importJsonlInBatches({ inputPath, batchSize, warnings }) {
  if (!inputPath) {
    return { attempted: false, ok: true, imported: 0, failed: 0, rows: 0 };
  }
  try {
    if (statSync(inputPath).size <= 0) {
      return { attempted: true, ok: true, imported: 0, failed: 0, rows: 0 };
    }
  } catch {
    return { attempted: false, ok: false, imported: 0, failed: 0, rows: 0 };
  }

  const { totalRows, chunkPaths } = splitJsonlIntoChunkFiles(inputPath, batchSize);
  let imported = 0;
  let failed = 0;
  let ok = true;

  try {
    for (const chunkPath of chunkPaths) {
      const importRun = runCommand(
        process.execPath,
        [
          "./scripts/open-memory.mjs",
          "import",
          "--input",
          chunkPath,
          "--continue-on-error",
          "true",
          "--disable-run-burst-limit",
          "true",
        ],
        { cwd: REPO_ROOT, allowFailure: true }
      );
      const parsed = importRun.stdout ? JSON.parse(importRun.stdout) : {};
      const counts = extractImportCounts(parsed);
      if (counts) {
        imported += counts.imported;
        failed += counts.failed;
      } else {
        ok = false;
        warnings.push(`Could not parse import response for ${chunkPath}`);
      }
      if (!importRun.ok) {
        ok = false;
        warnings.push(`Import failed for ${chunkPath}: ${String(importRun.stderr || importRun.stdout || "unknown error").trim()}`);
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
    rows: totalRows,
  };
}

function runJsonScript(scriptPath, args) {
  const result = runCommand(process.execPath, [scriptPath, "--json", ...args], {
    cwd: REPO_ROOT,
    allowFailure: true,
    maxBuffer: 1024 * 1024 * 64,
  });
  if (!result.ok) {
    throw new Error(String(result.stderr || result.stdout || `${scriptPath} failed`).trim());
  }
  return JSON.parse(String(result.stdout || "{}"));
}

async function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const runId = readStringFlag(flags, "run-id", "").trim();
  if (!runId) throw new Error("--run-id is required");

  const runRoot = readStringFlag(flags, "run-root", "").trim()
    ? resolveRepoPath(readStringFlag(flags, "run-root", "").trim())
    : resolve(REPO_ROOT, "output", "memory", runId);
  const sessionsRoot = resolveRepoPath(readStringFlag(flags, "sessions-root", codexPath("sessions")));
  const historyInput = resolveRepoPath(readStringFlag(flags, "history-input", codexPath("memory", "raw", "conversations.json")));
  const historySharedInput = resolveRepoPath(readStringFlag(flags, "history-shared-input", codexPath("memory", "raw", "shared_conversations.json")));
  const repoRoot = resolve(REPO_ROOT, readStringFlag(flags, "repo-root", "."));
  const adapterOutputPath = readStringFlag(flags, "adapter-output", "").trim()
    ? resolve(REPO_ROOT, readStringFlag(flags, "adapter-output", "").trim())
    : joinRunPath(runRoot, "hybrid-adapter.jsonl");
  const combinedManifestPath = readStringFlag(flags, "combined-manifest", "").trim()
    ? resolve(REPO_ROOT, readStringFlag(flags, "combined-manifest", "").trim())
    : joinRunPath(runRoot, "canonical-corpus", "manifest.json");
  const sqlitePath = readStringFlag(flags, "sqlite-path", "").trim()
    ? resolve(REPO_ROOT, readStringFlag(flags, "sqlite-path", "").trim())
    : joinRunPath(runRoot, "canonical-corpus", "corpus.sqlite");
  const doImport = readBoolFlag(flags, "import", true);
  const importBatchSize = readNumberFlag(flags, "import-batch-size", 300, { min: 1, max: 500 });
  const skipSQLite = readBoolFlag(flags, "skip-sqlite", false);
  const printJson = readBoolFlag(flags, "json", false);

  const loadEnvFileFlag = readBoolFlag(flags, "load-env-file", true);
  const envFilePath = resolveRepoPath(
    readStringFlag(
      flags,
      "env-file",
      resolveHomeOrRepoDefault("secrets/studio-brain/studio-brain-automation.env", "secrets/studio-brain/studio-brain-mcp.env")
    )
  );
  const loadPortalEnvFileFlag = readBoolFlag(flags, "load-portal-env-file", true);
  const portalEnvFilePath = resolveRepoPath(
    readStringFlag(flags, "portal-env-file", resolveHomeOrRepoDefault("secrets/portal/portal-automation.env"))
  );
  const mintStaffTokenFlag = readBoolFlag(flags, "mint-staff-token", true);

  const warnings = [];
  const sessionRunRoot = joinRunPath(runRoot, "sources", "codex-sessions");
  const historyRunRoot = joinRunPath(runRoot, "sources", "codex-history");
  const markdownRunRoot = joinRunPath(runRoot, "sources", "repo-markdown");

  const sessionReport = runJsonScript("./scripts/codex-session-corpus-export.mjs", [
    "--run-id",
    `${runId}-sessions`,
    "--sessions-root",
    sessionsRoot,
    "--run-root",
    sessionRunRoot,
    "--skip-sqlite",
    "true",
  ]);
  const historyReport = runJsonScript("./scripts/codex-history-corpus-export.mjs", [
    "--run-id",
    `${runId}-history`,
    "--input",
    historyInput,
    "--shared-input",
    historySharedInput,
    "--run-root",
    historyRunRoot,
    "--skip-sqlite",
    "true",
  ]);
  const markdownReport = runJsonScript("./scripts/repo-markdown-corpus-export.mjs", [
    "--run-id",
    `${runId}-markdown`,
    "--repo-root",
    repoRoot,
    "--run-root",
    markdownRunRoot,
    "--skip-sqlite",
    "true",
  ]);

  const sourceReports = [sessionReport, historyReport, markdownReport];
  const sourceManifests = sourceReports.map((report) => report.manifestPath);
  const manifests = sourceManifests.map((manifestPath) => readJson(manifestPath, null)).filter(Boolean);

  const combinedSourceUnits = joinRunPath(runRoot, "canonical-corpus", "source-units.jsonl");
  const combinedFactEvents = joinRunPath(runRoot, "canonical-corpus", "fact-events.jsonl");
  const combinedHypotheses = joinRunPath(runRoot, "canonical-corpus", "hypotheses.jsonl");
  const combinedDossiers = joinRunPath(runRoot, "canonical-corpus", "dossiers.jsonl");
  mergeJsonlArtifacts(manifests.map((manifest) => manifest?.artifacts?.sourceUnits).filter(Boolean), combinedSourceUnits);
  mergeJsonlArtifacts(manifests.map((manifest) => manifest?.artifacts?.factEvents).filter(Boolean), combinedFactEvents);
  mergeJsonlArtifacts(manifests.map((manifest) => manifest?.artifacts?.hypotheses).filter(Boolean), combinedHypotheses);
  mergeJsonlArtifacts(manifests.map((manifest) => manifest?.artifacts?.dossiers).filter(Boolean), combinedDossiers);

  const combinedManifest = buildCombinedManifest({
    runId,
    manifestPath: combinedManifestPath,
    outputDir: joinRunPath(runRoot, "canonical-corpus"),
    sourceUnitsPath: combinedSourceUnits,
    factEventsPath: combinedFactEvents,
    hypothesesPath: combinedHypotheses,
    dossiersPath: combinedDossiers,
    sourceManifests,
    counts: {
      sourceUnits: sourceReports.reduce((sum, report) => sum + Number(report?.counts?.sourceUnits || 0), 0),
      factEvents: sourceReports.reduce((sum, report) => sum + Number(report?.counts?.promoted || 0), 0),
      adapterRows: sourceReports.reduce((sum, report) => sum + Number(report?.counts?.adapterRows || 0), 0),
    },
  });

  let sqliteStatus = "skipped";
  if (!skipSQLite) {
    const sqliteRun = runCommand(
      process.execPath,
      [
        "./scripts/canonical-memory-corpus-sqlite.mjs",
        "--manifest",
        combinedManifestPath,
        "--output",
        sqlitePath,
        "--json",
      ],
      { cwd: REPO_ROOT, allowFailure: true }
    );
    sqliteStatus = sqliteRun.ok ? "ok" : "failed";
    if (!sqliteRun.ok) {
      warnings.push(String(sqliteRun.stderr || sqliteRun.stdout || "combined sqlite materialization failed").trim());
    }
  }

  mergeJsonlArtifacts(sourceReports.map((report) => report.adapterOutputPath).filter(Boolean), adapterOutputPath);

  const envSummary = {
    envFileLoaded: false,
    envFileKeysLoaded: 0,
    portalEnvFileLoaded: false,
    portalEnvFileKeysLoaded: 0,
    baseUrlResolved: false,
    authTokenReady: false,
    authTokenSource: "",
    mintStaffTokenAttempted: false,
    mintStaffTokenOk: false,
    mintStaffTokenReason: "",
  };

  if (loadEnvFileFlag) {
    const envLoad = loadEnvFile(envFilePath);
    envSummary.envFileLoaded = envLoad.loaded;
    envSummary.envFileKeysLoaded = envLoad.keysLoaded;
  }
  if (loadPortalEnvFileFlag) {
    const portalLoad = loadEnvFile(portalEnvFilePath);
    envSummary.portalEnvFileLoaded = portalLoad.loaded;
    envSummary.portalEnvFileKeysLoaded = portalLoad.keysLoaded;
  }
  if (!process.env.STUDIO_BRAIN_BASE_URL) {
    const baseUrl = String(resolveStudioBrainBaseUrlFromEnv({ env: process.env })).trim();
    if (baseUrl) {
      process.env.STUDIO_BRAIN_BASE_URL = baseUrl.replace(/\/$/, "");
      envSummary.baseUrlResolved = true;
    }
  }
  const existingAuth = String(process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN || "").trim();
  if (!existingAuth && mintStaffTokenFlag) {
    envSummary.mintStaffTokenAttempted = true;
    const minted = await mintStaffIdTokenFromPortalEnv({
      env: process.env,
      defaultCredentialsPath: resolveHomeOrRepoDefault("secrets/portal/portal-agent-staff.json"),
      preferRefreshToken: true,
    });
    envSummary.mintStaffTokenOk = minted.ok;
    envSummary.mintStaffTokenReason = minted.reason;
    if (minted.ok && minted.token) {
      process.env.STUDIO_BRAIN_ID_TOKEN = minted.token;
      process.env.STUDIO_BRAIN_AUTH_TOKEN = normalizeBearer(minted.token);
      envSummary.authTokenSource = "minted-from-portal-credentials";
    }
  }
  if (!process.env.STUDIO_BRAIN_AUTH_TOKEN && process.env.STUDIO_BRAIN_ID_TOKEN) {
    process.env.STUDIO_BRAIN_AUTH_TOKEN = normalizeBearer(process.env.STUDIO_BRAIN_ID_TOKEN);
    if (!envSummary.authTokenSource) envSummary.authTokenSource = "derived-from-id-token";
  }
  if (!envSummary.authTokenSource && process.env.STUDIO_BRAIN_AUTH_TOKEN) {
    envSummary.authTokenSource = "preconfigured-auth-token";
  }
  envSummary.authTokenReady = Boolean(process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN);

  let importSummary = {
    attempted: false,
    ok: false,
    imported: 0,
    failed: 0,
    rows: 0,
    skippedReason: "",
  };
  if (doImport) {
    if (!process.env.STUDIO_BRAIN_BASE_URL || !envSummary.authTokenReady) {
      importSummary.skippedReason = "missing STUDIO_BRAIN_BASE_URL or auth token";
    } else {
      importSummary = importJsonlInBatches({
        inputPath: adapterOutputPath,
        batchSize: importBatchSize,
        warnings,
      });
    }
  }

  const report = {
    schema: "open-memory-hybrid-refresh-report.v1",
    generatedAt: isoNow(),
    runId,
    runRoot,
    sources: {
      sessions: sessionReport,
      history: historyReport,
      markdown: markdownReport,
    },
    combined: {
      manifestPath: combinedManifestPath,
      adapterOutputPath,
      sqlitePath,
      counts: combinedManifest.counts,
      sqliteStatus,
    },
    import: importSummary,
    env: envSummary,
    warnings,
  };
  writeJson(joinRunPath(runRoot, "open-memory-hybrid-refresh-report.json"), report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("open-memory-hybrid-refresh complete\n");
    process.stdout.write(`report: ${joinRunPath(runRoot, "open-memory-hybrid-refresh-report.json")}\n`);
  }
}

try {
  await run();
} catch (error) {
  process.stderr.write(`open-memory-hybrid-refresh failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
