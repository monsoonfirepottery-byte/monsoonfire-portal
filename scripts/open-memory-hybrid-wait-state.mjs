#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mintStaffIdTokenFromPortalEnv } from "./lib/firebase-auth-token.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";
import {
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

const ACCEPTANCE_CHECKLIST = [
  "Capture final local artifact counts from canonical manifest and corpus SQLite report.",
  "Capture Studio Brain totals, by-source rollups, by-quality-tier rollups, and idle search/context p95 metrics.",
  "Run the source-collapse repair before any second full rebuild or replay.",
  "Verify replayed rows retain top-level source values like codex-resumable-session and repo-markdown.",
  "Verify repaired rows retain projectLane, corpusRecordId, and corpusManifestPath pointers.",
  "Run the fixed Monsoon retrieval query set only after activeImportRequests returns to 0.",
  "Accept performance only if search/context p95 stays within 25% of baseline or relevance improves materially.",
];

const RETRIEVAL_QUERY_SET = [
  "Firestore rejects undefined values",
  "Keep implementation scoped avoid opportunistic expansion",
  "Codex Agent Execution Contract",
  "batch-first kiln workflow",
];

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

function loadEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { attempted: Boolean(filePath), loaded: false, filePath, keysLoaded: 0 };
  }
  const raw = readFileSync(filePath, "utf8");
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
  return { attempted: true, loaded: keysLoaded > 0, filePath, keysLoaded };
}

function normalizeBearer(token) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  return /^bearer\s+/i.test(raw) ? raw : `Bearer ${raw}`;
}

async function fetchJson({ baseUrl, path, token, timeoutMs = 15_000 }) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: token } : {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      body: parsed,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function readProcessSnapshot(runId, runRoot) {
  const escapedRunId = runId.replace(/'/g, "''");
  const escapedRunRoot = runRoot.replace(/'/g, "''");
  const script = `
$runId = '${escapedRunId}'
$runRoot = '${escapedRunRoot}'
$parent = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -like '*open-memory-hybrid-refresh.mjs*' -and $_.CommandLine -like "*$runId*"
} | Select-Object ProcessId, CommandLine
$children = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -like '*open-memory.mjs*' -and $_.CommandLine -like '*hybrid-adapter.jsonl.part-*' -and $_.CommandLine -like "*$runRoot*"
} | Select-Object ProcessId, CommandLine
$parts = @()
foreach ($child in $children) {
  if ($child.CommandLine -match 'hybrid-adapter\\.jsonl\\.part-(\\d+)\\.jsonl') {
    $parts += [int]$matches[1]
  }
}
$payload = [ordered]@{
  parentAlive = @($parent).Count -gt 0
  parentPids = @($parent | ForEach-Object { $_.ProcessId })
  activeChildCount = @($children).Count
  activeChildParts = @($parts | Sort-Object -Unique)
  currentPart = if (@($parts).Count -gt 0) { (@($parts) | Measure-Object -Maximum).Maximum } else { $null }
}
$payload | ConvertTo-Json -Depth 4 -Compress
`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return {
      ok: false,
      error: String(result.stderr || result.stdout || "process lookup failed").trim(),
    };
  }
  try {
    return {
      ok: true,
      ...JSON.parse(String(result.stdout || "{}")),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  const runId = readStringFlag(flags, "run-id", "").trim();
  if (!runId) {
    throw new Error("--run-id is required");
  }

  const runRoot = readStringFlag(flags, "run-root", "").trim()
    ? resolveRepoPath(readStringFlag(flags, "run-root", "").trim())
    : resolve(REPO_ROOT, "output", "memory", runId);
  const expectedParts = readNumberFlag(flags, "expected-parts", 67, { min: 1, max: 10_000 });
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

  const envLoad = loadEnvFileFlag ? loadEnvFile(envFilePath) : { attempted: false, loaded: false, filePath: envFilePath, keysLoaded: 0 };
  const portalEnvLoad = loadPortalEnvFileFlag
    ? loadEnvFile(portalEnvFilePath)
    : { attempted: false, loaded: false, filePath: portalEnvFilePath, keysLoaded: 0 };

  let mintedToken = null;
  if (
    mintStaffTokenFlag &&
    !process.env.STUDIO_BRAIN_AUTH_TOKEN &&
    !process.env.STUDIO_BRAIN_ID_TOKEN &&
    !process.env.STUDIO_BRAIN_MCP_ID_TOKEN
  ) {
    try {
      const minted = await mintStaffIdTokenFromPortalEnv({ envFilePath: portalEnvFilePath });
      if (minted?.ok && minted.token) {
        mintedToken = minted.token;
        process.env.STUDIO_BRAIN_AUTH_TOKEN = minted.token;
        process.env.STUDIO_BRAIN_ID_TOKEN = minted.token;
        process.env.STUDIO_BRAIN_MCP_ID_TOKEN = minted.token;
      }
    } catch {
      mintedToken = null;
    }
  }

  const baseUrl = resolveStudioBrainBaseUrlFromEnv();
  const token = normalizeBearer(
    process.env.STUDIO_BRAIN_AUTH_TOKEN ||
      process.env.STUDIO_BRAIN_ID_TOKEN ||
      process.env.STUDIO_BRAIN_MCP_ID_TOKEN ||
      ""
  );
  const pressure = await fetchJson({
    baseUrl,
    path: "/api/memory/pressure",
    token,
  });
  const status = await fetchJson({
    baseUrl,
    path: "/api/status",
    token: "",
  });

  const manifestPath = resolve(runRoot, "canonical-corpus", "manifest.json");
  const sqliteReportPath = resolve(runRoot, "canonical-corpus", "corpus-sqlite-report.json");
  const refreshReportPath = resolve(runRoot, "open-memory-hybrid-refresh-report.json");

  const manifest = readJson(manifestPath, null);
  const sqliteReport = readJson(sqliteReportPath, null);
  const refreshReport = readJson(refreshReportPath, null);
  const processSnapshot = readProcessSnapshot(runId, runRoot);

  const report = {
    ok: true,
    observedAt: isoNow(),
    runId,
    runRoot,
    baseUrl,
    expectedParts,
    auth: {
      envLoad,
      portalEnvLoad,
      authTokenReady: Boolean(token),
      mintedToken: Boolean(mintedToken),
    },
    monitoring: {
      process: processSnapshot,
      pressure,
      status,
      currentPart:
        processSnapshot.ok && Number.isFinite(Number(processSnapshot.currentPart))
          ? `${String(processSnapshot.currentPart)} / ${String(expectedParts)}`
          : null,
    },
    artifacts: {
      manifestPath,
      manifestSummary: manifest
        ? {
            sourceUnits: Number(manifest.counts?.sourceUnits ?? 0),
            factEvents: Number(manifest.counts?.factEvents ?? 0),
            adapterRows: Number(manifest.counts?.adapterRows ?? 0),
          }
        : null,
      sqliteReportPath,
      sqliteSummary: sqliteReport
        ? {
            records: Number(sqliteReport.counts?.records ?? 0),
            edges: Number(sqliteReport.counts?.edges ?? 0),
            entities: Number(sqliteReport.counts?.entities ?? 0),
            entityEdges: Number(sqliteReport.counts?.entityEdges ?? 0),
          }
        : null,
      refreshReportPath,
      refreshImportSummary: refreshReport?.importResult ?? null,
      refreshWarnings: Array.isArray(refreshReport?.warnings) ? refreshReport.warnings.slice(0, 20) : [],
    },
    acceptanceChecklist: ACCEPTANCE_CHECKLIST,
    retrievalQuerySet: RETRIEVAL_QUERY_SET,
    notes: [
      "Use activeImportRequests and parent process liveness as the wait-state success signal, not search relevance while ingest pressure is elevated.",
      "Do not run the repair or the Monsoon retrieval audit until activeImportRequests returns to 0.",
      "Reuse the existing hybrid-adapter.jsonl artifact from this run for the repair/replay pass.",
    ],
  };

  const outputPath = resolve(runRoot, "wait-state-report.json");
  writeJson(outputPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify({ ...report, outputPath }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${outputPath}\n`);
}

run().catch((error) => {
  process.stderr.write(`open-memory-hybrid-wait-state failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
