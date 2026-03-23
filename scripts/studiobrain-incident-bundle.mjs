#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildArtifactProvenance,
  DATA_CLASSIFICATIONS,
  hashIdentifier,
  POSTURE_MODES,
  redactSharedIdentifier,
  REDACTION_STATES,
} from "./lib/studiobrain-posture-policy.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));
const now = new Date();
const bundleTimestamp = now.toISOString();
const bundleId = bundleTimestamp.replace(/[:.]/g, "-");

const incidentsRoot = resolve(REPO_ROOT, args.outputDir);
const bundleDir = resolve(incidentsRoot, bundleId);
const bundlePath = resolve(bundleDir, "bundle.json");
const checksumPath = resolve(bundleDir, "bundle.sha256");
const archivePath = resolve(bundleDir, "bundle.tar.gz");
const latestPath = resolve(incidentsRoot, "latest.json");

mkdirSync(bundleDir, { recursive: true });

const heartbeatSummaryPath = resolve(REPO_ROOT, args.summaryPath);
const heartbeatEventsPath = resolve(REPO_ROOT, args.eventsPath);

const heartbeatSummary = readJsonIfExists(heartbeatSummaryPath);
const heartbeatEvents = readJsonLinesTail(heartbeatEventsPath, args.maxEvents);

const diagnostics = {
  networkCheck: runJsonCommand(
    "node",
    ["./scripts/studiobrain-network-check.mjs", "--json"],
    15_000,
  ),
  statusCard: runJsonCommand(
    "node",
    ["./scripts/studiobrain-status.mjs", "--json", "--no-evidence", "--no-host-scan"],
    20_000,
  ),
  integrity: runJsonCommand(
    "node",
    ["./scripts/integrity-check.mjs", "--strict", "--json"],
    20_000,
  ),
  authProbe: runJsonCommand(
    "node",
    ["./scripts/test-studio-brain-auth.mjs", "--json", "--mode", POSTURE_MODES.AUTHENTICATED_PRIVILEGED_CHECK],
    20_000,
  ),
};

const git = collectGitState(args.maxGitDiffChars);
const artifacts = collectArtifactReferences();

const rawBundle = {
  schemaVersion: "1",
  generatedAt: bundleTimestamp,
  bundleId,
  provenance: buildArtifactProvenance({
    mode: POSTURE_MODES.AUTHENTICATED_PRIVILEGED_CHECK,
    envSource: "bundle-runtime",
    envMode: "process-env-only",
    host: process.platform,
    generator: "scripts/studiobrain-incident-bundle.mjs",
    dataClassification: DATA_CLASSIFICATIONS.SENSITIVE_OPERATIONAL_EVIDENCE,
    redactionState: REDACTION_STATES.REQUIRES_REVIEW,
    legalHold: args.legalHold,
    sourceSystems: ["studio-brain-http", "integrity-check", "reliability-hub"],
  }),
  retention: {
    class: DATA_CLASSIFICATIONS.SENSITIVE_OPERATIONAL_EVIDENCE,
    retentionDays: 30,
    legalHold: args.legalHold,
    accessScope: ["platform-primary", "ops-primary", "trust-safety-primary"],
  },
  host: {
    platform: process.platform,
    node: process.version,
    cwd: REPO_ROOT,
  },
  heartbeat: {
    summaryPath: relativePath(heartbeatSummaryPath),
    summary: heartbeatSummary,
    eventsPath: relativePath(heartbeatEventsPath),
    recentEvents: heartbeatEvents,
  },
  diagnostics: Object.fromEntries(
    Object.entries(diagnostics).map(([key, value]) => [
      key,
      {
        ok: value.ok,
        exitCode: value.exitCode,
        command: value.command,
        parsed: value.parsed,
        error: value.error,
      },
    ]),
  ),
  git,
  artifacts,
};

const bundle = redactSensitive(rawBundle);
const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
const checksum = createHash("sha256").update(serialized).digest("hex");

writeFileSync(bundlePath, serialized, "utf8");
writeFileSync(checksumPath, `${checksum}  bundle.json\n`, "utf8");
const archive = createArchive({
  bundleDir,
  archivePath,
  files: ["bundle.json", "bundle.sha256"],
});
writeFileSync(
  latestPath,
  `${JSON.stringify(
    {
      generatedAt: bundleTimestamp,
      bundlePath: relativePath(bundlePath),
      checksumPath: relativePath(checksumPath),
      archivePath: archive.ok ? relativePath(archivePath) : "",
      checksumSha256: checksum,
      status: heartbeatSummary?.status || "unknown",
      archiveStatus: archive.ok ? "created" : "failed",
      archiveError: archive.ok ? "" : archive.error,
      provenance: rawBundle.provenance,
      retention: rawBundle.retention,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const output = {
  status: archive.ok ? "pass" : "warn",
  generatedAt: bundleTimestamp,
  bundlePath: relativePath(bundlePath),
  checksumPath: relativePath(checksumPath),
  archivePath: archive.ok ? relativePath(archivePath) : "",
  archiveError: archive.ok ? "" : archive.error,
  checksumSha256: checksum,
  heartbeatStatus: heartbeatSummary?.status || "unknown",
  diagnostics: {
    networkCheck: diagnostics.networkCheck.ok,
    statusCard: diagnostics.statusCard.ok,
    integrity: diagnostics.integrity.ok,
    authProbe: diagnostics.authProbe.ok,
  },
  retention: rawBundle.retention,
  provenance: rawBundle.provenance,
};

if (args.json) {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} else {
  process.stdout.write("incident bundle: PASS\n");
  process.stdout.write(`  bundle: ${output.bundlePath}\n`);
  process.stdout.write(`  checksum: ${output.checksumPath}\n`);
  if (output.archivePath) {
    process.stdout.write(`  archive: ${output.archivePath}\n`);
  } else if (output.archiveError) {
    process.stdout.write(`  archive: unavailable (${output.archiveError})\n`);
  }
  process.stdout.write(`  heartbeat status: ${output.heartbeatStatus}\n`);
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    outputDir: "output/incidents",
    summaryPath: "output/stability/heartbeat-summary.json",
    eventsPath: "output/stability/heartbeat-events.log",
    maxEvents: 200,
    maxGitDiffChars: 4000,
    legalHold: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--output-dir" && argv[i + 1]) {
      parsed.outputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--summary" && argv[i + 1]) {
      parsed.summaryPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--events" && argv[i + 1]) {
      parsed.eventsPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--max-events" && argv[i + 1]) {
      const parsedCount = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsedCount) && parsedCount > 0) {
        parsed.maxEvents = parsedCount;
      }
      i += 1;
      continue;
    }
    if (arg === "--max-git-diff-chars" && argv[i + 1]) {
      const parsedChars = Number.parseInt(argv[i + 1], 10);
      if (Number.isFinite(parsedChars) && parsedChars > 0) {
        parsed.maxGitDiffChars = parsedChars;
      }
      i += 1;
      continue;
    }
    if (arg === "--legal-hold") {
      parsed.legalHold = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node ./scripts/studiobrain-incident-bundle.mjs [flags]\n");
      process.stdout.write("  --json\n");
      process.stdout.write("  --output-dir <path>\n");
      process.stdout.write("  --summary <path>\n");
      process.stdout.write("  --events <path>\n");
      process.stdout.write("  --max-events <n>\n");
      process.stdout.write("  --max-git-diff-chars <n>\n");
      process.stdout.write("  --legal-hold\n");
      process.exit(0);
    }
  }

  return parsed;
}

function relativePath(absPath) {
  return absPath.startsWith(`${REPO_ROOT}/`)
    ? absPath.slice(REPO_ROOT.length + 1)
    : absPath;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return {
      _parseError: error instanceof Error ? error.message : String(error),
      _path: relativePath(path),
    };
  }
}

function readJsonLinesTail(path, maxEvents) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const selected = lines.slice(Math.max(0, lines.length - maxEvents));
  return selected.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line.slice(0, 400) };
    }
  });
}

function runJsonCommand(command, cmdArgs, timeoutMs) {
  const result = spawnSync(command, cmdArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: timeoutMs,
  });
  const combined = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const parsed = extractJsonObject(combined);
  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    command: `${command} ${cmdArgs.join(" ")}`.trim(),
    parsed,
    output: combined.slice(0, 4000),
    error: result.error ? result.error.message : "",
  };
}

function extractJsonObject(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function collectGitState(maxDiffChars) {
  const diff = runGit(["diff"]).slice(0, maxDiffChars);
  return {
    branch: runGit(["branch", "--show-current"]),
    commit: runGit(["rev-parse", "HEAD"]),
    shortCommit: runGit(["rev-parse", "--short", "HEAD"]),
    statusShort: runGit(["status", "--short"]),
    diffStat: runGit(["diff", "--stat"]),
    diffPreviewCaptured: diff.length > 0,
    diffPreviewHash: diff.length > 0 ? hashIdentifier(diff) : "",
  };
}

function runGit(args) {
  const out = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (out.error) {
    return `git error: ${out.error.message}`;
  }
  const body = `${out.stdout || ""}${out.stderr || ""}`.trim();
  return body.slice(0, 4000);
}

function createArchive({ bundleDir, archivePath, files }) {
  const archiveName = basename(archivePath);
  const result = spawnSync("tar", ["-czf", archiveName, ...files], {
    cwd: bundleDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    const combined = `${result.stdout || ""}${result.stderr || ""}`.trim();
    return { ok: false, error: combined || `tar exited with code ${result.status}` };
  }
  return { ok: true, error: "" };
}

function collectArtifactReferences() {
  const candidates = [
    "output/stability/heartbeat-summary.json",
    "output/stability/heartbeat-events.log",
    "output/studio-network-check/pr-gate.json",
    "output/studio-network-check/cutover-gate.json",
    "output/cutover-gate/summary.json",
    "artifacts/pr-gate.json",
    "output/studio-stack-profile/latest.json",
  ];
  return candidates
    .map((rel) => {
      const abs = resolve(REPO_ROOT, rel);
      return existsSync(abs) ? rel : null;
    })
    .filter(Boolean);
}

function redactSensitive(input, keyName = "") {
  if (Array.isArray(input)) {
    return input.map((entry) => redactSensitive(entry, keyName));
  }
  if (!input || typeof input !== "object") {
    if (typeof input === "string") {
      return redactString(redactSharedIdentifier(keyName, input));
    }
    return input;
  }

  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const sensitiveKey = /(token|secret|password|authorization|cookie|api[-_]?key)/i.test(key);
    const bodyKey = /(requestBody|body|payload|diffPreview)/i.test(key);
    if (sensitiveKey) {
      out[key] = "[REDACTED]";
      continue;
    }
    if (bodyKey) {
      out[key] = "[REDACTED_BODY]";
      continue;
    }
    out[key] = redactSensitive(value, key);
  }
  return out;
}

function redactString(value) {
  let next = value;
  next = next.replace(/Bearer\s+[A-Za-z0-9._~+\-/=]+/gi, "Bearer [REDACTED]");
  next = next.replace(/(sk_(?:live|test)_[A-Za-z0-9]+)/g, "[REDACTED_STRIPE_KEY]");
  next = next.replace(/(pk_(?:live|test)_[A-Za-z0-9]+)/g, "[REDACTED_STRIPE_PUBLISHABLE_KEY]");
  next = next.replace(/(whsec_[A-Za-z0-9]+)/g, "[REDACTED_STRIPE_WEBHOOK_SECRET]");
  next = next.replace(/"authorization"\s*:\s*"[^"]+"/gi, "\"authorization\":\"[REDACTED]\"");
  return next;
}
