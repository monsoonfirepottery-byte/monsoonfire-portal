#!/usr/bin/env node

import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mintStaffIdTokenFromPortalEnv } from "./lib/firebase-auth-token.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";
import {
  buildSourceCollapseRepairPlan,
  selectVerificationMappings,
} from "./lib/hybrid-import-repair-utils.mjs";
import {
  isoNow,
  parseCliArgs,
  readBoolFlag,
  readJson,
  readJsonl,
  readNumberFlag,
  readStringFlag,
  runCommand,
  writeJson,
  writeJsonl,
} from "./lib/pst-memory-utils.mjs";

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

async function fetchJson({ baseUrl, path, method = "GET", token, body, timeoutMs = 20_000 }) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { Authorization: token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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

function importJsonlInBatches({ inputPath, batchSize, timeoutMs }) {
  try {
    if (statSync(inputPath).size <= 0) {
      return { attempted: true, ok: true, imported: 0, failed: 0, rows: 0, batches: [] };
    }
  } catch {
    return { attempted: false, ok: false, imported: 0, failed: 0, rows: 0, batches: [] };
  }

  const { totalRows, chunkPaths } = splitJsonlIntoChunkFiles(inputPath, batchSize);
  let imported = 0;
  let failed = 0;
  let ok = true;
  const batches = [];

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
          "--timeout-ms",
          String(timeoutMs),
        ],
        { cwd: REPO_ROOT, allowFailure: true }
      );
      let parsed = {};
      try {
        parsed = importRun.stdout ? JSON.parse(importRun.stdout) : {};
      } catch {
        parsed = {};
      }
      const counts = extractImportCounts(parsed);
      if (counts) {
        imported += counts.imported;
        failed += counts.failed;
      } else {
        ok = false;
      }
      if (!importRun.ok) ok = false;
      batches.push({
        chunkPath,
        ok: importRun.ok,
        parsed,
        stderr: String(importRun.stderr || "").trim(),
        stdout: String(importRun.stdout || "").trim(),
      });
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
    batches,
  };
}

function chunkArray(values, chunkSize) {
  const out = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    out.push(values.slice(index, index + chunkSize));
  }
  return out;
}

async function fetchRowsByIds({ baseUrl, token, tenantId, ids, includeArchived }) {
  const rows = [];
  const chunks = chunkArray(ids, 200);
  for (const chunk of chunks) {
    const response = await fetchJson({
      baseUrl,
      path: "/api/memory/get-by-ids",
      method: "POST",
      token,
      body: {
        tenantId,
        ids: chunk,
        includeArchived,
      },
    });
    if (!response.ok) {
      throw new Error(
        `get-by-ids failed with status ${response.status}: ${JSON.stringify(response.body)}`
      );
    }
    rows.push(...(Array.isArray(response.body?.rows) ? response.body.rows : []));
  }
  return rows;
}

async function verifyRepair({
  baseUrl,
  token,
  tenantId,
  mappings,
  verifySampleSize,
  verifyFull,
}) {
  const targets = verifyFull ? mappings : selectVerificationMappings(mappings, verifySampleSize);
  const archivedIds = targets
    .filter((entry) => entry.currentImportedId !== entry.repairedId)
    .map((entry) => entry.currentImportedId);
  const repairedIds = targets.map((entry) => entry.repairedId);

  const [archivedRows, repairedRows] = await Promise.all([
    archivedIds.length > 0
      ? fetchRowsByIds({ baseUrl, token, tenantId, ids: archivedIds, includeArchived: true })
      : Promise.resolve([]),
    repairedIds.length > 0
      ? fetchRowsByIds({ baseUrl, token, tenantId, ids: repairedIds, includeArchived: true })
      : Promise.resolve([]),
  ]);

  const archivedById = new Map(archivedRows.map((row) => [row.id, row]));
  const repairedById = new Map(repairedRows.map((row) => [row.id, row]));
  const mismatches = [];
  let archivedVerified = 0;
  let repairedVerified = 0;

  for (const target of targets) {
    const repairedRow = repairedById.get(target.repairedId);
    if (!repairedRow) {
      mismatches.push({
        id: target.repairedId,
        issue: "missing-repaired-row",
      });
      continue;
    }
    const repairedMetadata =
      repairedRow.metadata && typeof repairedRow.metadata === "object" ? repairedRow.metadata : {};
    const repairedStatus = String(repairedRow.status ?? "");
    if (String(repairedRow.source ?? "") !== target.source) {
      mismatches.push({
        id: target.repairedId,
        issue: "wrong-source",
        expected: target.source,
        actual: repairedRow.source,
      });
    } else if (
      String(repairedMetadata.projectLane ?? "") !== String(target.projectLane ?? "") ||
      String(repairedMetadata.corpusRecordId ?? "") !== String(target.corpusRecordId ?? "") ||
      String(repairedMetadata.corpusManifestPath ?? "") !== String(target.corpusManifestPath ?? "")
    ) {
      mismatches.push({
        id: target.repairedId,
        issue: "pointer-mismatch",
        expected: {
          projectLane: target.projectLane,
          corpusRecordId: target.corpusRecordId,
          corpusManifestPath: target.corpusManifestPath,
        },
        actual: {
          projectLane: repairedMetadata.projectLane ?? null,
          corpusRecordId: repairedMetadata.corpusRecordId ?? null,
          corpusManifestPath: repairedMetadata.corpusManifestPath ?? null,
        },
      });
    } else if (repairedStatus === "archived") {
      mismatches.push({
        id: target.repairedId,
        issue: "repaired-row-archived",
      });
    } else {
      repairedVerified += 1;
    }

    if (target.currentImportedId === target.repairedId) continue;
    const archivedRow = archivedById.get(target.currentImportedId);
    if (!archivedRow) {
      mismatches.push({
        id: target.currentImportedId,
        issue: "missing-archived-row",
      });
      continue;
    }
    if (String(archivedRow.status ?? "") !== "archived") {
      mismatches.push({
        id: target.currentImportedId,
        issue: "archived-row-not-archived",
        actual: archivedRow.status ?? null,
      });
    } else {
      archivedVerified += 1;
    }
  }

  return {
    ok: mismatches.length === 0,
    verifyFull,
    sampledMappings: targets.length,
    archivedRowsChecked: archivedIds.length,
    repairedRowsChecked: repairedIds.length,
    archivedVerified,
    repairedVerified,
    mismatches: mismatches.slice(0, 50),
  };
}

async function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  const runId = readStringFlag(flags, "run-id", "").trim();
  const adapterPath = readStringFlag(flags, "adapter-path", "").trim();
  if (!runId && !adapterPath) {
    throw new Error("--run-id or --adapter-path is required");
  }

  const runRoot = readStringFlag(flags, "run-root", "").trim()
    ? resolveRepoPath(readStringFlag(flags, "run-root", "").trim())
    : resolve(REPO_ROOT, "output", "memory", runId);
  const resolvedAdapterPath = adapterPath
    ? resolveRepoPath(adapterPath)
    : resolve(runRoot, "hybrid-adapter.jsonl");
  const tenantId = readStringFlag(flags, "tenant-id", "monsoonfire-main").trim();
  const apply = readBoolFlag(flags, "apply", false);
  const force = readBoolFlag(flags, "force", false);
  const verifyFull = readBoolFlag(flags, "verify-full", false);
  const verifySampleSize = readNumberFlag(flags, "verify-sample-size", 120, { min: 1, max: 20_000 });
  const batchSize = readNumberFlag(flags, "batch-size", 120, { min: 1, max: 500 });
  const timeoutMs = readNumberFlag(flags, "timeout-ms", 90_000, { min: 1_000, max: 600_000 });
  const printJson = readBoolFlag(flags, "json", false);
  const repairRunId = readStringFlag(flags, "repair-run-id", `${runId || "hybrid-import"}-source-repair`).trim();
  const repairedAt = isoNow();

  const repairRoot = resolve(runRoot, "repair-source-collapse");
  const planPath = resolve(repairRoot, "repair-plan.json");
  const archivePath = resolve(repairRoot, "archive-wrong-source.jsonl");
  const replayPath = resolve(repairRoot, "replay-preserved-source.jsonl");
  const reportPath = resolve(repairRoot, "repair-report.json");
  const manifestPath = resolve(runRoot, "canonical-corpus", "manifest.json");
  const sqliteReportPath = resolve(runRoot, "canonical-corpus", "corpus-sqlite-report.json");

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
  const pressureBefore = token
    ? await fetchJson({ baseUrl, path: "/api/memory/pressure", token })
    : { ok: false, status: 0, body: { error: "missing-auth-token" } };
  const activeImportRequests = Number(pressureBefore.body?.pressure?.activeImportRequests ?? 0);
  if (apply && !force && activeImportRequests > 0) {
    throw new Error(
      `Repair is blocked while imports are still active (activeImportRequests=${String(activeImportRequests)}).`
    );
  }

  const adapterRows = readJsonl(resolvedAdapterPath);
  const plan = buildSourceCollapseRepairPlan({
    rows: adapterRows,
    tenantId,
    repairRunId,
    repairedAt,
  });

  writeJson(planPath, {
    runId,
    tenantId,
    repairRunId,
    repairedAt,
    totalRows: plan.totalRows,
    repairableRows: plan.repairableRows,
    skipped: plan.skipped,
    sameIdCount: plan.sameIdCount,
    mappingsSample: plan.mappings.slice(0, 50),
  });
  writeJsonl(archivePath, plan.archiveRows);
  writeJsonl(replayPath, plan.replayRows);

  let archiveImport = { attempted: false, ok: true, imported: 0, failed: 0, rows: 0, batches: [] };
  let replayImport = { attempted: false, ok: true, imported: 0, failed: 0, rows: 0, batches: [] };
  let verification = null;

  if (apply) {
    archiveImport = importJsonlInBatches({
      inputPath: archivePath,
      batchSize,
      timeoutMs,
    });
    replayImport = importJsonlInBatches({
      inputPath: replayPath,
      batchSize,
      timeoutMs,
    });
    if (token) {
      verification = await verifyRepair({
        baseUrl,
        token,
        tenantId,
        mappings: plan.mappings,
        verifySampleSize,
        verifyFull,
      });
    } else {
      verification = {
        ok: false,
        reason: "missing-auth-token",
      };
    }
  }

  const pressureAfter =
    apply && token ? await fetchJson({ baseUrl, path: "/api/memory/pressure", token }) : null;

  const report = {
    ok: apply
      ? archiveImport.ok && replayImport.ok && Boolean(verification?.ok ?? true)
      : true,
    observedAt: isoNow(),
    runId,
    runRoot,
    baseUrl,
    tenantId,
    apply,
    repairRunId,
    auth: {
      envLoad,
      portalEnvLoad,
      authTokenReady: Boolean(token),
      mintedToken: Boolean(mintedToken),
    },
    artifacts: {
      adapterPath: resolvedAdapterPath,
      planPath,
      archivePath,
      replayPath,
      manifestPath,
      manifestSummary: readJson(manifestPath, null)?.counts ?? null,
      sqliteReportPath,
      sqliteSummary: readJson(sqliteReportPath, null)?.counts ?? null,
    },
    plan: {
      totalRows: plan.totalRows,
      repairableRows: plan.repairableRows,
      skipped: plan.skipped.length,
      sameIdCount: plan.sameIdCount,
    },
    pressureBefore,
    pressureAfter,
    archiveImport,
    replayImport,
    verification,
  };

  writeJson(reportPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify({ ...report, reportPath }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${reportPath}\n`);
}

run().catch((error) => {
  process.stderr.write(
    `open-memory-hybrid-repair-source-collapse failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
