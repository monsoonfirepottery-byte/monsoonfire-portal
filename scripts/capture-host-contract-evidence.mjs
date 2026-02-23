#!/usr/bin/env node

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));
const artifactPath = resolve(REPO_ROOT, args.artifact);
const fixturePath = resolve(REPO_ROOT, "scripts/.host-contract-regression-fixture.tmp.mjs");

const startedAt = new Date().toISOString();
const clean = runScanner();
if (!clean.parsed) {
  failWith(`Unable to parse clean scanner output. Command: ${clean.command}`);
}
if (clean.exitCode !== 0) {
  failWith("Clean scanner pass failed; cannot capture fail-mode evidence reliably.");
}

let failMode = null;
try {
  writeFileSync(
    fixturePath,
    [
      "// Intentional regression fixture for host-contract fail-mode evidence.",
      "export const hostContractRegressionFixture = \"http://127.0.0.1:8787\";",
      "",
    ].join("\n"),
    "utf8",
  );

  failMode = runScanner();
  if (!failMode.parsed) {
    failWith("Unable to parse fail-mode scanner output.");
  }
  if (failMode.exitCode === 0) {
    failWith("Fail-mode scan unexpectedly passed; expected host-contract violation.");
  }

  const hasFixtureViolation = Array.isArray(failMode.parsed.violations) &&
    failMode.parsed.violations.some((entry) =>
      String(entry.file || "").includes("scripts/.host-contract-regression-fixture.tmp.mjs")
    );
  if (!hasFixtureViolation) {
    failWith("Fail-mode output did not include the intentional regression fixture.");
  }
} finally {
  rmSync(fixturePath, { force: true });
}

const payload = {
  generatedAt: startedAt,
  status: "pass",
  checks: {
    cleanPass: {
      exitCode: clean.exitCode,
      summary: clean.parsed?.summary || null,
      scannedFiles: clean.parsed?.scannedFiles || 0,
      violations: clean.parsed?.violations?.length || 0,
    },
    intentionalFailMode: {
      exitCode: failMode?.exitCode ?? 1,
      summary: failMode?.parsed?.summary || null,
      scannedFiles: failMode?.parsed?.scannedFiles || 0,
      violations: failMode?.parsed?.violations?.length || 0,
      fixtureViolationCount: Array.isArray(failMode?.parsed?.violations)
        ? failMode.parsed.violations.filter((entry) =>
            String(entry.file || "").includes("scripts/.host-contract-regression-fixture.tmp.mjs")
          ).length
        : 0,
    },
  },
  commands: {
    clean: clean.command,
    failMode: failMode?.command || "",
  },
};

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

if (args.json) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  process.stdout.write("host-contract evidence: PASS\n");
  process.stdout.write(`  artifact: ${relativeToRepo(artifactPath)}\n`);
  process.stdout.write(`  clean summary: ${JSON.stringify(payload.checks.cleanPass.summary)}\n`);
  process.stdout.write(`  fail-mode summary: ${JSON.stringify(payload.checks.intentionalFailMode.summary)}\n`);
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    artifact: "output/host-contract-evidence/latest.json",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if ((arg === "--artifact" || arg === "--out") && argv[i + 1]) {
      parsed.artifact = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node ./scripts/capture-host-contract-evidence.mjs [--json] [--artifact <path>]\n");
      process.exit(0);
    }
  }
  return parsed;
}

function runScanner() {
  const cmd = "node ./scripts/scan-studiobrain-host-contract.mjs --strict --json";
  const out = spawnSync("node", ["./scripts/scan-studiobrain-host-contract.mjs", "--strict", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
  const raw = `${out.stdout || ""}${out.stderr || ""}`.trim();
  const parsed = extractJson(raw);
  return {
    command: cmd,
    exitCode: out.status ?? 1,
    raw: raw.slice(0, 6000),
    parsed,
  };
}

function extractJson(text) {
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
    if (ch === "{") {
      depth += 1;
      continue;
    }
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

function failWith(message) {
  process.stderr.write(`host-contract evidence failed: ${message}\n`);
  process.exit(1);
}

function relativeToRepo(absPath) {
  return absPath.startsWith(`${REPO_ROOT}/`)
    ? absPath.slice(REPO_ROOT.length + 1)
    : absPath;
}
