#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_AGENT_TOOL_REGISTRY_PATH,
  auditToolContractLifecycle,
  loadToolContractRegistry,
} from "./lib/agent-harness-control-plane.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = { json: false, strict: false };
  for (const raw of argv) {
    const arg = String(raw || "").trim();
    if (!arg) continue;
    if (arg === "--json") parsed.json = true;
    else if (arg === "--strict") parsed.strict = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Agent tool lifecycle audit",
          "",
          "Usage:",
          "  node ./scripts/agent-tool-lifecycle-audit.mjs [--json] [--strict]",
          "",
          `Registry: ${DEFAULT_AGENT_TOOL_REGISTRY_PATH}`,
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = loadToolContractRegistry(REPO_ROOT).registry;
  const audit = auditToolContractLifecycle(registry);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  } else {
    process.stdout.write(`tool lifecycle audit: ${audit.status}\n`);
    for (const finding of audit.findings) {
      process.stdout.write(`- [${finding.severity}] ${finding.toolId}: ${finding.message}\n`);
    }
  }

  if (audit.status === "fail" || (args.strict && audit.status !== "pass")) {
    process.exit(1);
  }
}

main();
