#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs, readStringFlag, readBoolFlag, runCommand } from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "PST memory resume helper",
      "",
      "Usage:",
      "  node ./scripts/pst-memory-resume.mjs --run-id <id> [--json]",
      "",
      "Options:",
      "  --run-id <id>     Required run id",
      "  --run-dir <path>  Optional run dir override",
      "  --json            Print runner JSON report output",
    ].join("\n")
  );
}

function run() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const runId = readStringFlag(flags, "run-id", "").trim();
  if (!runId) {
    throw new Error("--run-id is required");
  }
  const runDir = readStringFlag(flags, "run-dir", "").trim();
  const printJson = readBoolFlag(flags, "json", false);

  const args = ["./scripts/pst-memory-runner.mjs", "--run-id", runId, "--resume", "true"];
  if (runDir) {
    args.push("--run-dir", runDir);
  }
  if (printJson) {
    args.push("--json");
  }

  const result = runCommand(process.execPath, args, { cwd: REPO_ROOT, allowFailure: false });
  process.stdout.write(result.stdout);
}

try {
  run();
} catch (error) {
  process.stderr.write(`pst-memory-resume failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
