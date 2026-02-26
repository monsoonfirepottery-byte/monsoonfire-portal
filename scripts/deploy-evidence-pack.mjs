#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_JSON_PATH = resolve(repoRoot, "artifacts", "deploy-evidence-latest.json");
const DEFAULT_MD_PATH = resolve(repoRoot, "artifacts", "deploy-evidence-latest.md");
const DEFAULT_BASE_URL = "https://portal.monsoonfire.com";

const TARGETS = new Set(["namecheap-portal", "firebase-hosting", "generic"]);

function parseArgs(argv) {
  const options = {
    target: "namecheap-portal",
    baseUrl: process.env.PORTAL_DEPLOY_URL || DEFAULT_BASE_URL,
    outputJsonPath: DEFAULT_JSON_PATH,
    outputMarkdownPath: DEFAULT_MD_PATH,
    asJson: false,
    strict: true,
    expectPromotionGate: true,
    expectCutoverVerify: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--no-strict") {
      options.strict = false;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--skip-promotion-gate") {
      options.expectPromotionGate = false;
      continue;
    }
    if (arg === "--skip-cutover-verify") {
      options.expectCutoverVerify = false;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--target") {
      options.target = String(next).trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg === "--base-url") {
      options.baseUrl = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--output-json") {
      options.outputJsonPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--output-md") {
      options.outputMarkdownPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
  }

  if (!TARGETS.has(options.target)) {
    throw new Error(`Unsupported --target value: ${options.target}`);
  }

  return options;
}

function runGit(args, allowFailure = false) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || "").trim(),
  };
}

async function readJsonSafe(path) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeStatus(payload) {
  if (!payload || typeof payload !== "object") return "missing";

  const rawStatus = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
  const okFlag = typeof payload.ok === "boolean" ? payload.ok : null;

  if (rawStatus === "passed" || rawStatus === "success" || rawStatus === "in_sync" || rawStatus === "updated") {
    return "passed";
  }
  if (rawStatus === "warning") return "warning";
  if (rawStatus === "failed" || rawStatus === "error" || rawStatus === "drift_detected") {
    return "failed";
  }

  if (okFlag === true) return "passed";
  if (okFlag === false) return "failed";

  return "unknown";
}

function deriveArtifacts(options) {
  const artifacts = [
    {
      id: "deployPreflight",
      label: "Deploy preflight",
      path: resolve(repoRoot, "output", "qa", "deploy-preflight.json"),
      required: false,
    },
    {
      id: "cutoverVerify",
      label: "Cutover verify",
      path: resolve(repoRoot, "output", "qa", "post-deploy-cutover-verify.json"),
      required: options.target === "namecheap-portal" && options.expectCutoverVerify,
    },
    {
      id: "promotionGate",
      label: "Post-deploy promotion gate",
      path: resolve(repoRoot, "output", "qa", "post-deploy-promotion-gate.json"),
      required: options.target === "namecheap-portal" && options.expectPromotionGate,
    },
    {
      id: "postDeployCanary",
      label: "Post-deploy authenticated canary",
      path: resolve(repoRoot, "output", "qa", "post-deploy-authenticated-canary.json"),
      required: false,
    },
    {
      id: "postDeployVirtualStaff",
      label: "Post-deploy virtual staff regression",
      path: resolve(repoRoot, "output", "qa", "post-deploy-virtual-staff-regression.json"),
      required: false,
    },
    {
      id: "postDeployIndexGuard",
      label: "Post-deploy Firestore index guard",
      path: resolve(repoRoot, "output", "qa", "post-deploy-index-guard.json"),
      required: false,
    },
    {
      id: "rollback",
      label: "Auto rollback report",
      path: resolve(repoRoot, "output", "qa", "post-deploy-rollback.json"),
      required: false,
    },
    {
      id: "rollbackVerify",
      label: "Post-rollback verify",
      path: resolve(repoRoot, "output", "qa", "post-deploy-rollback-verify.json"),
      required: false,
    },
  ];

  return artifacts;
}

function statusToEmoji(status) {
  if (status === "passed") return "pass";
  if (status === "warning") return "warn";
  if (status === "failed") return "fail";
  if (status === "missing") return "miss";
  return "unk";
}

function buildMarkdown(summary) {
  const lines = [];
  lines.push("# Deploy Evidence Pack");
  lines.push("");
  lines.push(`- Generated: ${summary.generatedAtIso}`);
  lines.push(`- Target: ${summary.target}`);
  lines.push(`- Status: ${summary.status}`);
  lines.push(`- Base URL: ${summary.baseUrl}`);
  lines.push(`- Commit: ${summary.git.sha}`);
  lines.push(`- Branch: ${summary.git.branch}`);
  lines.push("");
  lines.push("## Artifact Status");
  lines.push("");
  lines.push("| Artifact | Required | Status | Path |");
  lines.push("| --- | --- | --- | --- |");
  for (const artifact of summary.artifacts) {
    lines.push(
      `| ${artifact.label} | ${artifact.required ? "yes" : "no"} | ${statusToEmoji(artifact.status)} | ${artifact.relativePath} |`
    );
  }
  lines.push("");

  const failures = summary.artifacts.filter((artifact) => artifact.status === "failed");
  const missingRequired = summary.artifacts.filter(
    (artifact) => artifact.required && artifact.status === "missing"
  );
  if (failures.length > 0 || missingRequired.length > 0) {
    lines.push("## Attention");
    lines.push("");
    for (const artifact of failures) {
      lines.push(`- Failed: ${artifact.label}`);
    }
    for (const artifact of missingRequired) {
      lines.push(`- Missing required: ${artifact.label}`);
    }
    lines.push("");
  }

  lines.push("## Notes");
  lines.push("");
  lines.push("- This report is generated from local deploy artifacts and should be attached to release evidence.");
  lines.push("- Use alongside CI artifacts for full production promotion traceability.");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function computeOverallStatus(summary, options) {
  const requiredFailed = summary.artifacts.some(
    (artifact) => artifact.required && (artifact.status === "failed" || artifact.status === "missing")
  );
  if (requiredFailed) return "failed";

  const anyFailed = summary.artifacts.some((artifact) => artifact.status === "failed");
  if (anyFailed) return options.strict ? "failed" : "warning";

  const rollbackArtifact = summary.artifacts.find((artifact) => artifact.id === "rollback");
  if (rollbackArtifact?.exists && rollbackArtifact.status !== "missing") {
    const rollbackTriggered = Boolean(rollbackArtifact.payload?.rollbackApplied);
    if (rollbackTriggered) {
      return options.strict ? "warning" : "warning";
    }
  }

  return "passed";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const sha = runGit(["rev-parse", "HEAD"], true);
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], true);

  const summary = {
    generatedAtIso: new Date().toISOString(),
    target: options.target,
    baseUrl: options.baseUrl,
    status: "passed",
    strict: options.strict,
    git: {
      sha: sha.ok ? sha.stdout : "",
      branch: branch.ok ? branch.stdout : "",
    },
    artifacts: [],
    output: {
      json: options.outputJsonPath,
      markdown: options.outputMarkdownPath,
    },
  };

  const artifactDefs = deriveArtifacts(options);
  for (const def of artifactDefs) {
    const exists = existsSync(def.path);
    const payload = exists ? await readJsonSafe(def.path) : null;
    const status = exists ? normalizeStatus(payload) : "missing";

    summary.artifacts.push({
      id: def.id,
      label: def.label,
      required: def.required,
      path: def.path,
      relativePath: def.path.startsWith(`${repoRoot}/`) ? def.path.slice(repoRoot.length + 1) : def.path,
      exists,
      status,
      payload,
    });
  }

  summary.status = computeOverallStatus(summary, options);

  const markdown = buildMarkdown(summary);

  await mkdir(dirname(options.outputJsonPath), { recursive: true });
  await writeFile(options.outputJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  await mkdir(dirname(options.outputMarkdownPath), { recursive: true });
  await writeFile(options.outputMarkdownPath, markdown, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`target: ${summary.target}\n`);
    process.stdout.write(`json: ${options.outputJsonPath}\n`);
    process.stdout.write(`markdown: ${options.outputMarkdownPath}\n`);
    for (const artifact of summary.artifacts) {
      process.stdout.write(`- ${artifact.label}: ${artifact.status}${artifact.required ? " (required)" : ""}\n`);
    }
  }

  if (summary.status === "failed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`deploy-evidence-pack failed: ${message}`);
  process.exit(1);
});
