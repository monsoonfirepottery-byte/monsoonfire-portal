#!/usr/bin/env node

/* eslint-disable no-console */

import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildFirebaseCliInvocation, prependPathEntries } from "./lib/command-runner.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

function parseArgs(argv) {
  const options = {
    project: process.env.PORTAL_PROJECT_ID || "monsoonfire-portal",
    config: "firebase.emulators.local.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--project" && argv[index + 1]) {
      options.project = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--project=")) {
      options.project = arg.slice("--project=".length).trim();
      continue;
    }

    if (arg === "--config" && argv[index + 1]) {
      options.config = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      options.config = arg.slice("--config=".length).trim();
      continue;
    }
  }

  return options;
}

function resolveRulesTestFiles() {
  const rulesDir = resolve(repoRoot, "scripts", "rules");
  const names = readdirSync(rulesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".rules.test.mjs"))
    .map((entry) => `scripts/rules/${entry.name}`)
    .sort();

  if (names.length === 0) {
    throw new Error("No rules test files found under scripts/rules/*.rules.test.mjs");
  }

  return names;
}

function ensureJavaRuntime() {
  const result = spawnSync(process.execPath, ["./scripts/ensure-java-runtime.mjs", "--json"], {
    cwd: repoRoot,
    env: {
      ...process.env,
    },
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(stderr || "Java runtime bootstrap failed.");
  }

  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || "").trim());
  } catch {
    throw new Error("Java runtime bootstrap returned invalid JSON.");
  }

  if (parsed?.status !== "ok" || !parsed?.javaHome) {
    throw new Error("Java runtime bootstrap did not provide JAVA_HOME.");
  }

  return {
    javaHome: String(parsed.javaHome),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { javaHome } = ensureJavaRuntime();
  const rulesTests = resolveRulesTestFiles();
  const testCommand = `node --test ${rulesTests.join(" ")}`;
  const javaEnv = prependPathEntries([resolve(javaHome, "bin")], {
    ...process.env,
    JAVA_HOME: javaHome,
  });
  const firebaseCli = buildFirebaseCliInvocation(repoRoot, { env: javaEnv });

  const result = spawnSync(
    firebaseCli.command,
    [
      ...firebaseCli.args,
      "emulators:exec",
      "--config",
      options.config,
      "--project",
      options.project,
      "--only",
      "firestore",
      testCommand,
    ],
    {
      cwd: repoRoot,
      env: javaEnv,
      stdio: "inherit",
      encoding: "utf8",
    }
  );

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`test-rules failed: ${message}`);
  process.exit(1);
}
