#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_TARGET_FILES = [
  "studio-brain/.env.network.profile",
  "studio-brain/.env.contract.schema.json",
  "studio-brain/docker-compose.yml",
  "studio-brain/docker/otel-collector.yaml",
  "studio-brain/scripts/preflight.mjs",
  "studio-brain/scripts/env-contract-validator.mjs",
  "studio-brain/scripts/validateCompose.mjs",
  "studio-brain/scripts/validate-env-contract.mjs",
  "studio-brain/host-drift-allowlist.json",
  "scripts/studio-network-profile.mjs",
  "scripts/studio-brain-url-resolution.mjs",
  "scripts/install-studiobrain-healthcheck.sh",
  "scripts/install-studiobrain-monitoring.sh",
  "scripts/install-studiobrain-memory-ops.sh",
  "scripts/lib/codex-automation-env.mjs",
  "scripts/lib/codex-startup-reliability.mjs",
  "scripts/lib/codex-worktree-utils.mjs",
  "scripts/lib/firebase-auth-token.mjs",
  "scripts/lib/studio-brain-startup-auth.mjs",
  "scripts/lib/studio-brain-memory-write.mjs",
  "scripts/lib/codex-session-memory-utils.mjs",
  "scripts/lib/hybrid-memory-utils.mjs",
  "scripts/lib/pst-memory-utils.mjs",
  "scripts/lib/studiobrain-posture-policy.mjs",
  "scripts/start-emulators.mjs",
  "scripts/studiobrain-network-check.mjs",
  "scripts/studiobrain-status.mjs",
  "scripts/studiobrain-backup-drill.mjs",
  "scripts/studiobrain-incident-bundle.mjs",
  "scripts/test-studio-brain-auth.mjs",
  "scripts/ops-cockpit.mjs",
  "scripts/scan-studiobrain-host-contract.mjs",
  "scripts/integrity-check.mjs",
  "scripts/deploy-studio-brain-host.py",
  "scripts/pr-gate.mjs",
  "scripts/portal-playwright-smoke.mjs",
  "scripts/website-playwright-smoke.mjs",
  "scripts/functions-cors-smoke.mjs",
  "scripts/generate-runtime-docs.mjs",
  "scripts/stability-guardrails.mjs",
  "config/studiobrain/monitoring/Caddyfile",
  "config/studiobrain/monitoring/docker-compose.yml",
  "config/studiobrain/monitoring/netdata-overrides/docker.conf",
  "config/studiobrain/monitoring/netdata-overrides/netdata.conf",
  "config/studiobrain/monitoring/netdata-overrides/systemdunits.conf",
  "config/studiobrain/monitoring/scripts/bootstrap-kuma-monitors.js",
  "config/studiobrain/systemd/studio-brain-backup.service",
  "config/studiobrain/systemd/studio-brain-backup.timer",
  "config/studiobrain/systemd/studio-brain-backup.sh",
  "config/studiobrain/systemd/studio-brain-disk-alert.service",
  "config/studiobrain/systemd/studio-brain-disk-alert.timer",
  "config/studiobrain/systemd/studio-brain-disk-alert.sh",
  "config/studiobrain/systemd/studio-brain-discord-relay.service",
  "config/studiobrain/systemd/studio-brain-discord-relay.timer",
  "config/studiobrain/systemd/studio-brain-discord-relay.sh",
  "config/studiobrain/systemd/user/studio-brain-memory-ops-supervisor.service",
  "config/studiobrain/systemd/user/studio-brain-memory-ops-supervisor.timer",
  "docs/generated/studiobrain-runtime-contract.generated.md",
  "docs/policies/STUDIO_OS_V3_RETENTION.md",
  "docs/runbooks/STUDIO_BRAIN_HOST_DEPLOY.md",
  "website/scripts/deploy.mjs",
  "website/scripts/serve.mjs",
];

const DEFAULT_OVERRIDE_ENV_VAR = "STUDIO_BRAIN_INTEGRITY_OVERRIDE";
const OVERRIDE_REQUIRED_KEYS = ["owner", "reason", "expiresAt"];
const TEXT_FILE_EXTENSIONS = new Set([
  ".conf",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".profile",
  ".ps1",
  ".py",
  ".schema",
  ".sh",
  ".service",
  ".timer",
  ".yml",
  ".yaml",
]);

function parseArgs(rawArgs = []) {
  const parsed = {
    manifest: null,
    json: false,
    strict: false,
    failOnWarnings: false,
    update: false,
    init: false,
    paths: [],
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--manifest" && rawArgs[index + 1]) {
      parsed.manifest = rawArgs[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--manifest=")) {
      parsed.manifest = arg.slice("--manifest=".length);
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--fail-on-warnings") {
      parsed.failOnWarnings = true;
      continue;
    }
    if (arg === "--update") {
      parsed.update = true;
      continue;
    }
    if (arg === "--init") {
      parsed.init = true;
      continue;
    }
    if (arg === "--path" && rawArgs[index + 1]) {
      parsed.paths.push(rawArgs[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--path=")) {
      parsed.paths.push(arg.slice("--path=".length));
      continue;
    }
  }

  return parsed;
}

function resolveTargets(rawPaths = []) {
  const targets = rawPaths
    .map((path) => String(path || "").trim())
    .filter(Boolean);

  return targets.length > 0 ? [...new Set(targets)] : [...DEFAULT_TARGET_FILES];
}

function parseOverride(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (typeof parsed !== "object" || parsed === null) {
      return { error: "Integrity override payload must be JSON object." };
    }

    const missing = OVERRIDE_REQUIRED_KEYS.filter((key) => {
      const value = parsed[key];
      return typeof value !== "string" || value.trim().length === 0;
    });
    if (missing.length > 0) {
      return {
        error: `Integrity override missing required key(s): ${missing.join(", ")}.`,
      };
    }

    const expiresAt = new Date(parsed.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return {
        error: "Integrity override `expiresAt` must be an ISO timestamp.",
      };
    }

    return {
      owner: parsed.owner.trim(),
      reason: parsed.reason.trim(),
      expiresAt,
      allowedPaths: Array.isArray(parsed.allowedPaths)
        ? parsed.allowedPaths.map((path) => String(path).trim()).filter(Boolean)
        : null,
      source: parsed.source || "environment",
    };
  } catch (error) {
    return {
      error: `Integrity override is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function sha256File(filePath) {
  const data = readCanonicalFile(filePath);
  const hash = createHash("sha256").update(data).digest("hex");
  return hash;
}

function canonicalSize(filePath) {
  return readCanonicalFile(filePath).length;
}

function readCanonicalFile(filePath) {
  if (!shouldNormalizeText(filePath)) {
    return readFileSync(filePath);
  }
  const text = readFileSync(filePath, "utf8").replace(/\r\n?/g, "\n");
  return Buffer.from(text, "utf8");
}

function shouldNormalizeText(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  if (/\/\.env(?:\.|$)/.test(normalized)) {
    return true;
  }
  if (/(^|\/)Caddyfile$/.test(normalized)) {
    return true;
  }
  const ext = normalized.includes(".") ? `.${normalized.split(".").pop()}` : "";
  return TEXT_FILE_EXTENSIONS.has(ext);
}

function toRelative(filePath) {
  return filePath.replace(`${REPO_ROOT}/`, "");
}

function hashTarget(pathOrFile) {
  const absolute = resolve(REPO_ROOT, pathOrFile);
  return {
    path: toRelative(absolute),
    sha256: sha256File(absolute),
    size: canonicalSize(absolute),
  };
}

function normalizeManifest(rawManifest) {
  return {
    schema: rawManifest?.schema || "studiobrain-infra-integrity-v1",
    generatedAt: rawManifest?.generatedAt || null,
    generatedBy: rawManifest?.generatedBy || null,
    files: Array.isArray(rawManifest?.files) ? rawManifest.files : [],
    metadata: rawManifest?.metadata || {},
    allowUnknown: Boolean(rawManifest?.allowUnknown),
  };
}

function normalizeManifestPath(manifestPath) {
  const target = manifestPath || "studio-brain/.env.integrity.json";
  return resolve(REPO_ROOT, target);
}

function loadManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    return {
      schema: "studiobrain-infra-integrity-v1",
      generatedAt: null,
      generatedBy: null,
      files: DEFAULT_TARGET_FILES.map((path) => ({ path, sha256: null, size: 0 })),
      metadata: {
        fallback: true,
      },
      allowUnknown: false,
    };
  }

  const raw = readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  return normalizeManifest(parsed);
}

function writeManifest(payload, manifestPath) {
  const directory = dirname(manifestPath);
  mkdirSync(directory, { recursive: true });

  const output = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(manifestPath, output, "utf8");
}

function buildUpdatePayload(targets, existingManifest = null) {
  const targetSet = new Set(targets);
  const updatedRecords = targets
    .map((path) => {
      const absolute = resolve(REPO_ROOT, path);
      if (!existsSync(absolute)) {
        return null;
      }

      return {
        path,
        sha256: sha256File(absolute),
        size: canonicalSize(absolute),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.path.localeCompare(right.path));

  const preservedRecords = Array.isArray(existingManifest?.files)
    ? existingManifest.files
        .filter((entry) => entry && typeof entry.path === "string" && !targetSet.has(entry.path))
        .map((entry) => ({
          path: entry.path,
          sha256: entry.sha256,
          size: entry.size,
        }))
    : [];

  const fileRecords = [...preservedRecords, ...updatedRecords]
    .sort((left, right) => left.path.localeCompare(right.path));

  const missing = targets.filter((path) => !existsSync(resolve(REPO_ROOT, path)));
  return {
    schema: "studiobrain-infra-integrity-v1",
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/integrity-check.mjs",
    allowUnknown: false,
    metadata: {
      totalFiles: fileRecords.length,
      missingOnUpdate: missing,
      partialUpdate: targets.length !== DEFAULT_TARGET_FILES.length,
      updatedPaths: [...targets],
    },
    files: fileRecords,
  };
}

function isPathAllowed(path, allowedPaths) {
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    return true;
  }
  return allowedPaths.includes(path);
}

function compareAgainstManifest(manifest, targets, override, options) {
  const report = {
    ok: true,
    status: "pass",
    strictMode: Boolean(options?.strict || options?.failOnWarnings),
    manifestPath: options?.manifestPath,
    checked: 0,
    issues: [],
    warnings: [],
    appliedBy: null,
  };

  const expected = manifest.files
    .filter((entry) => typeof entry.path === "string" && entry.path.length > 0)
    .reduce((acc, entry) => {
      acc[entry.path] = entry;
      return acc;
    }, /** @type {Record<string, {path:string,sha256:string,size:number}>} */ ({}));

  const targetSet = new Set(targets);
  for (const target of targetSet) {
    report.checked += 1;
    const absolute = resolve(REPO_ROOT, target);
    const existing = expected[target];

    if (!existsSync(absolute)) {
      const issue = {
        file: target,
        kind: "missing",
        expected: existing?.sha256 ? existing.sha256 : "<missing from manifest>",
        actual: "missing",
        message: `Required file ${target} is missing from repository checkout.`,
      };
      if (!isBypassAllowed(override, issue)) {
        report.issues.push(issue);
        report.ok = false;
      } else {
        report.warnings.push({ ...issue, bypassed: true });
      }
      continue;
    }

    if (!existing) {
      const warning = {
        file: target,
        kind: "untracked",
        expected: "<untracked>",
        actual: "present",
        message: `${target} is not listed in integrity manifest.`,
      };
      if (!manifest.allowUnknown) {
        report.issues.push({
          ...warning,
          message: `${warning.message} Add it to ${toRelative(options?.manifestPath || "")} or remove local overrides.`,
        });
        report.ok = false;
      } else {
        report.warnings.push(warning);
      }
      continue;
    }

    const actualSha = sha256File(absolute);
    const actualSize = canonicalSize(absolute);
    if (actualSha !== existing.sha256 || actualSize !== existing.size) {
      const issue = {
        file: target,
        kind: "changed",
        expected: existing.sha256,
        actual: actualSha,
        message: `Integrity hash mismatch for ${target}.`,
      };

      if (!isBypassAllowed(override, issue)) {
        report.issues.push(issue);
        report.ok = false;
      } else {
        report.warnings.push({ ...issue, bypassed: true });
      }
    }
  }

  if (options?.strict || options?.failOnWarnings) {
    report.ok = report.ok && report.warnings.length === 0;
  }

  report.status = report.ok ? "pass" : "fail";
  report.appliedBy = override && override.active ? {
    owner: override.owner,
    reason: override.reason,
    expiresAt: override.expiresAt.toISOString(),
  } : null;

  return report;
}

function isBypassAllowed(override, issue) {
  if (!override || !override.active) {
    return false;
  }
  if (override.expiresAt.getTime() <= Date.now()) {
    return false;
  }
  return isPathAllowed(issue.file, override.allowedPaths);
}

function parseOverrideToken() {
  const rawOverride = process.env[DEFAULT_OVERRIDE_ENV_VAR];
  const parsed = parseOverride(rawOverride);
  if (!parsed) {
    return null;
  }
  if (parsed.error) {
    return { active: false, error: parsed.error };
  }

  return {
    active: true,
    owner: parsed.owner,
    reason: parsed.reason,
    expiresAt: parsed.expiresAt,
    allowedPaths: parsed.allowedPaths,
    source: parsed.source,
  };
}

function printHuman(report, override) {
  process.stdout.write(`Integrity check (${toRelative(report.manifestPath)}): ${report.status.toUpperCase()}\n`);
  process.stdout.write(`  checked: ${report.checked}\n`);

  if (report.issues.length === 0 && report.warnings.length === 0) {
    process.stdout.write("  no drift detected.\n");
  }

  if (override?.active) {
    process.stdout.write(
      `  override: active (${override.owner}) expires ${override.expiresAt.toISOString()} reason="${override.reason}"\n`,
    );
  }

  if (report.issues.length > 0) {
    process.stdout.write("  issues:\n");
    for (const issue of report.issues) {
      process.stdout.write(`    - ${issue.file}: ${issue.message}\n`);
      if (issue.expected) {
        process.stdout.write(`      expected: ${issue.expected}\n`);
      }
      if (issue.actual) {
        process.stdout.write(`      actual: ${issue.actual}\n`);
      }
    }
  }

  if (report.warnings.length > 0) {
    process.stdout.write("  bypassed issues:\n");
    for (const issue of report.warnings) {
      const suffix = issue.bypassed ? " [bypassed]" : "";
      process.stdout.write(`    - ${issue.file}: ${issue.message}${suffix}\n`);
    }
  }

  if (!report.ok) {
    process.stdout.write(`  remediation: run node ./scripts/integrity-check.mjs --update --manifest studio-brain/.env.integrity.json\n`);
    process.stdout.write("  override format:\n");
    process.stdout.write(
      '    STUDIO_BRAIN_INTEGRITY_OVERRIDE=\'{"owner":"you@you","reason":"short reason","expiresAt":"2026-02-18T18:00:00Z","allowedPaths":["studio-brain/docker-compose.yml"]}\'\n',
    );
  }
}

function runIntegrityCheck(options = {}) {
  const manifestPath = normalizeManifestPath(options.manifest);
  const outputJson = Boolean(options.json);
  const strict = Boolean(options.strict);
  const failOnWarnings = Boolean(options.failOnWarnings);
  const update = Boolean(options.update);
  const selectedTargets = resolveTargets(options.targets);

  const manifest = loadManifest(manifestPath);
  if (update) {
    const payload = buildUpdatePayload(selectedTargets, manifest);
    writeManifest(payload, manifestPath);
    const missing = payload.metadata?.missingOnUpdate ?? [];
    if (missing.length > 0) {
      process.stderr.write(`warning: manifest update skipped missing files: ${missing.join(", ")}\n`);
    }
  }

  const override = parseOverrideToken();
  if (override?.error) {
    const issueReport = {
      ok: false,
      status: "fail",
      manifestPath,
      checked: 0,
      issues: [
        {
          file: "override",
          kind: "override",
          message: override.error,
        },
      ],
      warnings: [],
    };
    if (!outputJson) {
      printHuman(issueReport, null);
    } else {
      process.stdout.write(`${JSON.stringify(issueReport, null, 2)}\n`);
    }
    return issueReport;
  }

  const resolvedManifest = loadManifest(manifestPath);
  const report = compareAgainstManifest(resolvedManifest, selectedTargets, override, {
    strict,
    failOnWarnings,
    manifestPath,
  });
  report.selectedTargets = selectedTargets;

  if (options.verbose !== false) {
    if (!outputJson) {
      printHuman(report, override);
    } else {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
  }

  if (update) {
    report.autoUpdated = true;
  }

  return report;
}

function run(argv) {
  const args = parseArgs(argv.slice(2));
  const report = runIntegrityCheck({
    manifest: args.manifest || "studio-brain/.env.integrity.json",
    strict: args.strict,
    failOnWarnings: args.failOnWarnings,
    update: args.update || args.init,
    targets: args.paths,
    json: args.json,
    verbose: true,
  });
  process.exitCode = report.ok ? 0 : 1;
}

export { runIntegrityCheck };

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const currentModulePath = fileURLToPath(import.meta.url);
if (invokedPath && invokedPath === currentModulePath) {
  run(process.argv);
}
