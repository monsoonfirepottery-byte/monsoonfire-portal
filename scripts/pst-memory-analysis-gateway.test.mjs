import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function runGateway(args) {
  return spawnSync("node", ["./scripts/pst-memory-analysis-gateway.mjs", "--json", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function parseJson(text) {
  return JSON.parse(String(text || "").trim());
}

test("pst-memory-analysis-gateway distills high-signal rows with bounded output", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pst-analysis-gateway-"));
  try {
    const inputPath = join(tempDir, "input.jsonl");
    const outputPath = join(tempDir, "output.jsonl");
    const reportPath = join(tempDir, "report.json");

    writeJsonl(inputPath, [
      {
        content:
          'On 2026-02-20 from alex@example.com to team@example.com subject "Launch Decision". Decision: move launch to Friday due to QA blocker. Action item: Sam updates rollout plan by Wednesday.',
        source: "pst:libratom",
        metadata: {
          subject: "Launch Decision",
          from: "alex@example.com",
          to: "team@example.com",
          messageDate: "2026-02-20T10:00:00Z",
        },
        clientRequestId: "raw-1",
        occurredAt: "2026-02-20T10:00:00Z",
      },
      {
        content:
          'On 2026-02-21 from sam@example.com to alex@example.com subject "Re: Launch Decision". Follow-up: owner confirmed timeline and next step for QA sign-off.',
        source: "pst:libratom",
        metadata: {
          subject: "Re: Launch Decision",
          from: "sam@example.com",
          to: "alex@example.com",
          messageDate: "2026-02-21T10:00:00Z",
        },
        clientRequestId: "raw-2",
        occurredAt: "2026-02-21T10:00:00Z",
      },
      {
        content:
          'On 2026-02-22 from finance@example.com to alex@example.com subject "Budget Renewal". Contract renewal quote came in higher than budget. Need decision by Monday.',
        source: "pst:libratom",
        metadata: {
          subject: "Budget Renewal",
          from: "finance@example.com",
          to: "alex@example.com",
          messageDate: "2026-02-22T10:00:00Z",
        },
        clientRequestId: "raw-3",
        occurredAt: "2026-02-22T10:00:00Z",
      },
      {
        content: 'On 2026-02-22 from friend@example.com to alex@example.com subject "Lunch?". Want to grab lunch sometime next week?',
        source: "pst:libratom",
        metadata: {
          subject: "Lunch?",
          from: "friend@example.com",
          to: "alex@example.com",
          messageDate: "2026-02-22T13:00:00Z",
        },
        clientRequestId: "raw-4",
        occurredAt: "2026-02-22T13:00:00Z",
      },
      {
        content:
          'On 2026-02-23 from security@example.com to team@example.com subject "Incident Follow-up". Security incident concern remains open. Action item: complete remediation checklist.',
        source: "pst:libratom",
        metadata: {
          subject: "Incident Follow-up",
          from: "security@example.com",
          to: "team@example.com",
          messageDate: "2026-02-23T09:00:00Z",
        },
        clientRequestId: "raw-5",
        occurredAt: "2026-02-23T09:00:00Z",
      },
      {
        content:
          'On 2026-02-24 from security@example.com to team@example.com subject "Re: Incident Follow-up". Risk accepted temporarily until patch rollout Thursday.',
        source: "pst:libratom",
        metadata: {
          subject: "Re: Incident Follow-up",
          from: "security@example.com",
          to: "team@example.com",
          messageDate: "2026-02-24T09:00:00Z",
        },
        clientRequestId: "raw-6",
        occurredAt: "2026-02-24T09:00:00Z",
      },
    ]);

    const result = runGateway([
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--report",
      reportPath,
      "--max-output",
      "4",
      "--max-trend-summaries",
      "1",
      "--max-correlations",
      "1",
    ]);

    assert.equal(result.status, 0, result.stderr || "gateway run should succeed");
    const report = parseJson(result.stdout);
    assert.equal(report.status, "ok");
    assert.equal(report.summary.rawInputRows, 6);
    assert.ok(report.summary.analyzedMemoriesWritten <= 4);
    assert.ok(report.breakdown.message_insight >= 1);
    assert.ok(report.breakdown.thread_summary >= 1);

    const outputRows = readFileSync(outputPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.ok(outputRows.length > 0);
    assert.ok(outputRows.every((row) => row.source === "pst:analysis-gateway"));
    assert.ok(
      outputRows.every(
        (row) =>
          typeof row.metadata?.analysisType === "string" &&
          row.metadata.analysisType.length > 0
      )
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("pst-memory-analysis-gateway returns non-zero when input file is missing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pst-analysis-gateway-missing-"));
  try {
    const result = runGateway([
      "--input",
      join(tempDir, "missing.jsonl"),
      "--output",
      join(tempDir, "output.jsonl"),
      "--report",
      join(tempDir, "report.json"),
    ]);
    assert.equal(result.status, 1);
    assert.match(String(result.stderr || ""), /Input JSONL not found/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
