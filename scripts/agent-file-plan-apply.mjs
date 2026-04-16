#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function parseArgs(argv) {
  const parsed = {
    planPath: "",
    dryRun: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--plan" && argv[index + 1]) {
      parsed.planPath = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--plan=")) {
      parsed.planPath = clean(arg.slice("--plan=".length));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Agent file plan apply",
          "",
          "Usage:",
          "  node ./scripts/agent-file-plan-apply.mjs --plan <path> [--dry-run] [--json]",
          "",
          "Plan schema:",
          '  { "schema": "agent-file-plan.v1", "operations": [ ... ] }',
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.planPath) {
    throw new Error("--plan is required.");
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function ensureWorkspacePath(repoRoot, targetPath) {
  const absolutePath = resolve(repoRoot, targetPath);
  const relativePath = relative(repoRoot, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || resolve(repoRoot, relativePath) !== absolutePath) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return {
    absolutePath,
    relativePath: relativePath.replaceAll("\\", "/"),
  };
}

function applyOperation(repoRoot, operation, dryRun) {
  const type = clean(operation?.type);
  const target = ensureWorkspacePath(repoRoot, clean(operation?.path || ""));
  const exists = existsSync(target.absolutePath);
  const current = exists ? readFileSync(target.absolutePath, "utf8") : "";
  const expectedSha256 = clean(operation?.expectedSha256);
  if (expectedSha256 && sha256(current) !== expectedSha256) {
    return {
      path: target.relativePath,
      type,
      status: "conflict",
      reason: "expectedSha256_mismatch",
    };
  }

  let next = current;
  if (type === "write") {
    next = String(operation?.content ?? "");
  } else if (type === "append") {
    next = `${current}${String(operation?.content ?? "")}`;
  } else if (type === "replace") {
    const find = String(operation?.find ?? "");
    if (!find) {
      return {
        path: target.relativePath,
        type,
        status: "skipped",
        reason: "missing_find",
      };
    }
    if (!current.includes(find)) {
      return {
        path: target.relativePath,
        type,
        status: "skipped",
        reason: "find_not_present",
      };
    }
    next = current.replace(find, String(operation?.replace ?? ""));
  } else {
    return {
      path: target.relativePath,
      type,
      status: "skipped",
      reason: "unsupported_type",
    };
  }

  const changed = next !== current;
  if (!changed) {
    return {
      path: target.relativePath,
      type,
      status: "skipped",
      reason: "no_change",
    };
  }

  if (!dryRun) {
    mkdirSync(dirname(target.absolutePath), { recursive: true });
    writeFileSync(target.absolutePath, next, "utf8");
  }

  return {
    path: target.relativePath,
    type,
    status: dryRun ? "planned" : "applied",
    bytes: Buffer.byteLength(next, "utf8"),
    beforeSha256: sha256(current),
    afterSha256: sha256(next),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = readJson(resolve(REPO_ROOT, args.planPath));
  if (plan?.schema !== "agent-file-plan.v1" || !Array.isArray(plan.operations)) {
    throw new Error(`Invalid agent file plan at ${args.planPath}.`);
  }

  const results = [];
  for (const operation of plan.operations) {
    results.push(applyOperation(REPO_ROOT, operation, args.dryRun));
  }

  const report = {
    schema: "agent-file-plan-report.v1",
    planPath: args.planPath.replaceAll("\\", "/"),
    dryRun: args.dryRun,
    appliedCount: results.filter((result) => result.status === "applied").length,
    plannedCount: results.filter((result) => result.status === "planned").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    conflictCount: results.filter((result) => result.status === "conflict").length,
    results,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`agent-file-plan: ${report.planPath}\n`);
  process.stdout.write(`planned: ${report.plannedCount}\n`);
  process.stdout.write(`applied: ${report.appliedCount}\n`);
  process.stdout.write(`conflicts: ${report.conflictCount}\n`);
}

main();
