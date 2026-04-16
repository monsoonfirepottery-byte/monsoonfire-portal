#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadToolContractRegistry,
  buildAgentSelectableToolRegistry,
} from "./lib/agent-harness-control-plane.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = { json: false, selectableOnly: false };
  for (const raw of argv) {
    const arg = String(raw || "").trim();
    if (!arg) continue;
    if (arg === "--json") parsed.json = true;
    else if (arg === "--selectable-only") parsed.selectableOnly = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Agent tool registry build",
          "",
          "Usage:",
          "  node ./scripts/agent-tool-registry-build.mjs [--json] [--selectable-only]",
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
  const loaded = loadToolContractRegistry(REPO_ROOT);
  const registry = args.selectableOnly ? buildAgentSelectableToolRegistry(loaded.registry) : loaded.registry;

  if (args.json) {
    process.stdout.write(`${JSON.stringify(registry, null, 2)}\n`);
    return;
  }

  process.stdout.write(`agent tool registry: ${registry.tools.length} tools\n`);
  if (registry.primitiveFamilies) {
    process.stdout.write(
      `primitive families: ${Number(registry.primitiveFamilies.familyCount || 0)} families, ${Number(registry.primitiveFamilies.generatedCount || 0)} generated tools\n`,
    );
  }
}

main();
