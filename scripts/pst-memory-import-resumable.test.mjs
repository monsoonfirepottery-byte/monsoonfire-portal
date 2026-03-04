import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function runImport(args) {
  return spawnSync("node", ["./scripts/pst-memory-import-resumable.mjs", "--json", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

test("pst-memory-import-resumable imports in chunks and writes checkpoint", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pst-import-resume-"));
  try {
    const inputPath = join(tempDir, "promoted.jsonl");
    const checkpointPath = join(tempDir, "checkpoint.json");
    const ledgerPath = join(tempDir, "ledger.jsonl");
    const deadLetterPath = join(tempDir, "dead.jsonl");
    const reportPath = join(tempDir, "report.json");
    const mockScriptPath = join(tempDir, "mock-open-memory.mjs");

    const rows = new Array(7).fill(0).map((_, idx) => ({
      content: `Row ${idx + 1}`,
      source: "pst:promoted-memory",
      tags: ["test"],
      metadata: { idx },
      clientRequestId: `req-${idx + 1}`,
    }));
    writeFileSync(inputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

    writeFileSync(
      mockScriptPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] !== "import") {
  process.stderr.write("unsupported command\\n");
  process.exit(1);
}
const inputIndex = args.indexOf("--input");
const fs = await import("node:fs");
const path = inputIndex >= 0 ? args[inputIndex + 1] : "";
const lines = fs.readFileSync(path, "utf8").split(/\\r?\\n/).map((x) => x.trim()).filter(Boolean);
process.stdout.write(JSON.stringify({ ok: true, result: { total: lines.length, imported: lines.length, failed: 0 } }) + "\\n");
`
    );

    const result = runImport([
      "--input",
      inputPath,
      "--run-id",
      "test-run-1",
      "--chunk-size",
      "3",
      "--checkpoint",
      checkpointPath,
      "--ledger",
      ledgerPath,
      "--dead-letter",
      deadLetterPath,
      "--report",
      reportPath,
      "--open-memory-script",
      mockScriptPath,
    ]);

    assert.equal(result.status, 0, result.stderr || "resumable import should pass");
    const payload = JSON.parse(String(result.stdout || "{}"));
    assert.equal(payload.progress.completed, true);
    assert.equal(payload.totals.imported, 7);

    const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
    assert.equal(checkpoint.nextIndex, 7);
    assert.equal(checkpoint.totals.chunksSucceeded, 3);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pst-memory-import-resumable retries transient failures and continues", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pst-import-retry-"));
  try {
    const inputPath = join(tempDir, "promoted.jsonl");
    const checkpointPath = join(tempDir, "checkpoint.json");
    const ledgerPath = join(tempDir, "ledger.jsonl");
    const deadLetterPath = join(tempDir, "dead.jsonl");
    const reportPath = join(tempDir, "report.json");
    const mockScriptPath = join(tempDir, "mock-open-memory-retry.mjs");
    const statePath = join(tempDir, "state.json");

    const rows = new Array(4).fill(0).map((_, idx) => ({
      content: `Retry Row ${idx + 1}`,
      source: "pst:promoted-memory",
      tags: ["test"],
      metadata: { idx },
      clientRequestId: `retry-${idx + 1}`,
    }));
    writeFileSync(inputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
    writeFileSync(statePath, JSON.stringify({ calls: 0 }), "utf8");

    writeFileSync(
      mockScriptPath,
      `#!/usr/bin/env node
const fs = await import("node:fs");
const statePath = process.env.MOCK_STATE_PATH;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
state.calls += 1;
fs.writeFileSync(statePath, JSON.stringify(state), "utf8");
if (state.calls === 1) {
  process.stderr.write("transient failure\\n");
  process.exit(1);
}
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const path = inputIndex >= 0 ? args[inputIndex + 1] : "";
const lines = fs.readFileSync(path, "utf8").split(/\\r?\\n/).map((x) => x.trim()).filter(Boolean);
process.stdout.write(JSON.stringify({ ok: true, result: { total: lines.length, imported: lines.length, failed: 0 } }) + "\\n");
`
    );

    const result = spawnSync(
      "node",
      [
        "./scripts/pst-memory-import-resumable.mjs",
        "--json",
        "--input",
        inputPath,
        "--run-id",
        "test-run-retry",
        "--chunk-size",
        "2",
        "--max-retries",
        "2",
        "--checkpoint",
        checkpointPath,
        "--ledger",
        ledgerPath,
        "--dead-letter",
        deadLetterPath,
        "--report",
        reportPath,
        "--open-memory-script",
        mockScriptPath,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          MOCK_STATE_PATH: statePath,
        },
      }
    );

    assert.equal(result.status, 0, result.stderr || "retry run should succeed");
    const payload = JSON.parse(String(result.stdout || "{}"));
    assert.equal(payload.progress.completed, true);
    assert.equal(payload.totals.imported, 4);
    assert.equal(payload.totals.chunksFailed, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pst-memory-import-resumable supports executable open-memory wrappers", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pst-import-wrapper-"));
  try {
    const inputPath = join(tempDir, "promoted.jsonl");
    const checkpointPath = join(tempDir, "checkpoint.json");
    const ledgerPath = join(tempDir, "ledger.jsonl");
    const deadLetterPath = join(tempDir, "dead.jsonl");
    const reportPath = join(tempDir, "report.json");
    const mockWrapperPath = join(tempDir, "mock-open-memory.sh");

    const rows = new Array(3).fill(0).map((_, idx) => ({
      content: `Wrapper Row ${idx + 1}`,
      source: "pst:promoted-memory",
      tags: ["test"],
      metadata: { idx },
      clientRequestId: `wrapper-${idx + 1}`,
    }));
    writeFileSync(inputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

    writeFileSync(
      mockWrapperPath,
      `#!/usr/bin/env bash
set -euo pipefail
cmd="\${1:-}"
shift || true
if [[ "$cmd" != "import" ]]; then
  echo '{"ok":false,"error":"unsupported"}'
  exit 1
fi
input=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --input)
      input="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
count=$(wc -l < "$input" | tr -d ' ')
echo "{\\"ok\\":true,\\"result\\":{\\"total\\":$count,\\"imported\\":$count,\\"failed\\":0}}"
`
    );
    chmodSync(mockWrapperPath, 0o755);

    const result = runImport([
      "--input",
      inputPath,
      "--run-id",
      "test-run-wrapper",
      "--checkpoint",
      checkpointPath,
      "--ledger",
      ledgerPath,
      "--dead-letter",
      deadLetterPath,
      "--report",
      reportPath,
      "--open-memory-script",
      mockWrapperPath,
    ]);

    assert.equal(result.status, 0, result.stderr || "wrapper-backed import should pass");
    const payload = JSON.parse(String(result.stdout || "{}"));
    assert.equal(payload.progress.completed, true);
    assert.equal(payload.totals.imported, 3);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pst-memory-import-resumable resumes from checkpoint without duplicating imported rows", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pst-import-resume-idempotent-"));
  try {
    const inputPath = join(tempDir, "promoted.jsonl");
    const checkpointPath = join(tempDir, "checkpoint.json");
    const ledgerPath = join(tempDir, "ledger.jsonl");
    const deadLetterPath = join(tempDir, "dead.jsonl");
    const reportPath = join(tempDir, "report.json");
    const failScriptPath = join(tempDir, "mock-open-memory-fail-second-chunk.mjs");
    const successScriptPath = join(tempDir, "mock-open-memory-success.mjs");
    const importStatePath = join(tempDir, "import-state.json");

    const rows = new Array(5).fill(0).map((_, idx) => ({
      content: `Resume Row ${idx + 1}`,
      source: "pst:promoted-memory",
      tags: ["test"],
      metadata: { idx },
      clientRequestId: `resume-${idx + 1}`,
    }));
    writeFileSync(inputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
    writeFileSync(importStatePath, JSON.stringify({ imported: {} }), "utf8");

    writeFileSync(
      failScriptPath,
      `#!/usr/bin/env node
const fs = await import("node:fs");
const args = process.argv.slice(2);
if (args[0] !== "import") process.exit(1);
const inputIndex = args.indexOf("--input");
const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : "";
const rawLines = fs.readFileSync(inputPath, "utf8").split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
const rows = rawLines.map((line) => JSON.parse(line));
if (rows.some((row) => String(row.clientRequestId || "") === "resume-3")) {
  process.stderr.write("forced chunk failure for resume validation\\n");
  process.exit(1);
}
const statePath = process.env.MOCK_IMPORT_STATE_PATH;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
for (const row of rows) {
  const key = String(row.clientRequestId || "");
  state.imported[key] = Number(state.imported[key] || 0) + 1;
}
fs.writeFileSync(statePath, JSON.stringify(state), "utf8");
process.stdout.write(JSON.stringify({ ok: true, result: { total: rows.length, imported: rows.length, failed: 0 } }) + "\\n");
`
    );

    writeFileSync(
      successScriptPath,
      `#!/usr/bin/env node
const fs = await import("node:fs");
const args = process.argv.slice(2);
if (args[0] !== "import") process.exit(1);
const inputIndex = args.indexOf("--input");
const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : "";
const rawLines = fs.readFileSync(inputPath, "utf8").split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
const rows = rawLines.map((line) => JSON.parse(line));
const statePath = process.env.MOCK_IMPORT_STATE_PATH;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
for (const row of rows) {
  const key = String(row.clientRequestId || "");
  state.imported[key] = Number(state.imported[key] || 0) + 1;
}
fs.writeFileSync(statePath, JSON.stringify(state), "utf8");
process.stdout.write(JSON.stringify({ ok: true, result: { total: rows.length, imported: rows.length, failed: 0 } }) + "\\n");
`
    );

    const firstRun = spawnSync(
      "node",
      [
        "./scripts/pst-memory-import-resumable.mjs",
        "--json",
        "--input",
        inputPath,
        "--run-id",
        "test-run-resume-idempotent",
        "--chunk-size",
        "2",
        "--max-retries",
        "0",
        "--continue-on-error",
        "false",
        "--checkpoint",
        checkpointPath,
        "--ledger",
        ledgerPath,
        "--dead-letter",
        deadLetterPath,
        "--report",
        reportPath,
        "--open-memory-script",
        failScriptPath,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          MOCK_IMPORT_STATE_PATH: importStatePath,
        },
      }
    );

    assert.equal(firstRun.status, 1, "first run should stop on forced chunk failure");
    const checkpointAfterFirstRun = JSON.parse(readFileSync(checkpointPath, "utf8"));
    assert.equal(checkpointAfterFirstRun.nextIndex, 2, "checkpoint should persist completed first chunk");

    const secondRun = spawnSync(
      "node",
      [
        "./scripts/pst-memory-import-resumable.mjs",
        "--json",
        "--input",
        inputPath,
        "--run-id",
        "test-run-resume-idempotent",
        "--chunk-size",
        "2",
        "--max-retries",
        "0",
        "--continue-on-error",
        "false",
        "--checkpoint",
        checkpointPath,
        "--ledger",
        ledgerPath,
        "--dead-letter",
        deadLetterPath,
        "--report",
        reportPath,
        "--open-memory-script",
        successScriptPath,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          MOCK_IMPORT_STATE_PATH: importStatePath,
        },
      }
    );

    assert.equal(secondRun.status, 0, secondRun.stderr || "second run should resume and complete");
    const payload = JSON.parse(String(secondRun.stdout || "{}"));
    assert.equal(payload.progress.completed, true);
    assert.equal(payload.progress.nextIndex, 5);

    const finalState = JSON.parse(readFileSync(importStatePath, "utf8"));
    const importedCounts = finalState.imported || {};
    assert.equal(importedCounts["resume-1"], 1);
    assert.equal(importedCounts["resume-2"], 1);
    assert.equal(importedCounts["resume-3"], 1);
    assert.equal(importedCounts["resume-4"], 1);
    assert.equal(importedCounts["resume-5"], 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
