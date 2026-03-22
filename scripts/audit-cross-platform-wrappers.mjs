#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const TARGET_FILES = [
  "scripts/test-rules.mjs",
  "scripts/start-emulators.mjs",
  "scripts/portal-pr-functional-gate.mjs",
  "scripts/deploy-firebase-safe.mjs",
];

const RULES = [
  {
    id: "bare-npx-spawn",
    message: "Use the shared command-runner helper instead of spawning bare npx.",
    pattern: /spawnSync\(\s*["']npx(?:\.cmd)?["']/,
  },
  {
    id: "bare-npm-spawn",
    message: "Use the shared command-runner helper instead of spawning bare npm.",
    pattern: /spawnSync\(\s*["']npm(?:\.cmd)?["']/,
  },
  {
    id: "hardcoded-path-colon",
    message: "Use path.delimiter or prependPathEntries instead of hard-coded PATH separators.",
    pattern: /(?:join|split)\(\s*["']:(?:["'])\s*\)|PATH:\s*`[^`]*:[^`]*`/,
  },
];

export function scanSourceText(source) {
  return RULES.filter((rule) => rule.pattern.test(source)).map((rule) => ({
    id: rule.id,
    message: rule.message,
  }));
}

function main() {
  const findings = [];
  for (const relativePath of TARGET_FILES) {
    const absolutePath = resolve(REPO_ROOT, relativePath);
    const source = readFileSync(absolutePath, "utf8");
    for (const finding of scanSourceText(source)) {
      findings.push({
        file: relativePath,
        ...finding,
      });
    }
  }

  const report = {
    schema: "cross-platform-wrapper-audit.v1",
    generatedAt: new Date().toISOString(),
    status: findings.length === 0 ? "pass" : "fail",
    targetFiles: TARGET_FILES,
    findings,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (findings.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main();
}
