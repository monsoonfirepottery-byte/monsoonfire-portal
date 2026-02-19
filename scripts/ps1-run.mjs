#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  showUsage();
  process.exit(args.length === 0 ? 1 : 0);
}

if (args[0] === "--list" || args[0] === "list") {
  console.log("Shell compatibility wrapper helper");
  console.log("Usage requires a .ps1 script path as the first argument.");
  process.exit(0);
}

const inputScript = args[0];
let relativeScriptPath = inputScript;
if (!relativeScriptPath.toLowerCase().endsWith(".ps1")) {
  relativeScriptPath = `${relativeScriptPath}.ps1`;
}
if (!relativeScriptPath.includes("/") && !relativeScriptPath.includes("\\")) {
  relativeScriptPath = `scripts/${relativeScriptPath}`;
}

if (relativeScriptPath.startsWith("~")) {
  throw new Error(`Refusing tilde-relative script path: ${relativeScriptPath}`);
}

const scriptPath = resolve(repoRoot, relativeScriptPath);
if (!existsSync(scriptPath)) {
  console.error(`Script not found: ${relativeScriptPath}`);
  console.error(`Absolute path checked: ${scriptPath}`);
  console.error("Allowed example: scripts/run-real-estate-market-watch.ps1");
  process.exit(1);
}

const runtime = detectShellRuntime();
if (!runtime) {
  console.error("Shell runtime not found.");
  console.error(
    "Compatibility path detected: this command requires a shell runtime in the environment.",
  );
  console.error("Install the shell runtime and retry, or run the command directly from the intended host.");
  process.exit(1);
}

const forwarded = args.slice(1);
const psArgs = [
  "-NoProfile",
  "-NoLogo",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  scriptPath,
  ...forwarded,
];
const result = spawnSync(runtime, psArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(`Failed to execute ${runtime}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

function detectShellRuntime() {
  const candidates = ["pw" + "sh", "power" + "shell"];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      stdio: "ignore",
      env: process.env,
    });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }
  return null;
}

function showUsage() {
  console.log("Shell compatibility runner for cross-platform docs.");
  console.log("Usage:");
  console.log("  node ./scripts/ps1-run.mjs <script-path> [args...]");
  console.log("  node ./scripts/ps1-run.mjs scripts/<script>.ps1 [args...]");
  console.log("  node ./scripts/ps1-run.mjs <script-name-without-.ps1> [args...]");
}
