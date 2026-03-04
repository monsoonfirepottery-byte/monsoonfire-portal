import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  buildContinuityArtifact,
  buildRelationshipMonitoringArtifact,
  buildRelationshipQualityArtifact,
} from "./lib/pst-memory-continuity.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function runNode(args) {
  return spawnSync("node", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function writeJsonl(path, rows) {
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("pst continuity flow reconstructs thread context, cross-links, and handoff continuity", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pst-continuity-flow-"));
  try {
    const inputPath = join(tempDir, "raw.jsonl");
    const analysisOutputPath = join(tempDir, "analysis.jsonl");
    const analysisReportPath = join(tempDir, "analysis-report.json");
    const promotedOutputPath = join(tempDir, "promoted.jsonl");
    const promotedDeadLetterPath = join(tempDir, "promoted-dead.jsonl");
    const promotedReportPath = join(tempDir, "promoted-report.json");
    const importCheckpointPath = join(tempDir, "import-checkpoint.json");
    const importLedgerPath = join(tempDir, "import-ledger.jsonl");
    const importDeadLetterPath = join(tempDir, "import-dead.jsonl");
    const importReportPath = join(tempDir, "import-report.json");
    const mockOpenMemoryPath = join(tempDir, "mock-open-memory.mjs");
    const continuityArtifactPath = join(tempDir, "continuity.json");

    writeFileSync(
      mockOpenMemoryPath,
      `#!/usr/bin/env node
const fs = await import("node:fs");
const args = process.argv.slice(2);
if (args[0] !== "import") {
  process.stderr.write("unsupported command\\n");
  process.exit(1);
}
const inputIndex = args.indexOf("--input");
const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : "";
const lines = fs.readFileSync(inputPath, "utf8").split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
process.stdout.write(JSON.stringify({ ok: true, result: { total: lines.length, imported: lines.length, failed: 0 } }) + "\\n");
`
    );

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
          'On 2026-02-22 from owner@example.com to sam@example.com subject "Re: Launch Decision". We will keep launch Friday and close blocker items tonight.',
        source: "pst:libratom",
        metadata: {
          subject: "Re: Launch Decision",
          from: "owner@example.com",
          to: "sam@example.com",
          messageDate: "2026-02-22T08:00:00Z",
        },
        clientRequestId: "raw-3",
        occurredAt: "2026-02-22T08:00:00Z",
      },
    ]);

    const analysisResult = runNode([
      "./scripts/pst-memory-analysis-gateway.mjs",
      "--json",
      "--input",
      inputPath,
      "--output",
      analysisOutputPath,
      "--report",
      analysisReportPath,
      "--max-output",
      "8",
      "--max-thread-summaries",
      "4",
      "--max-message-insights",
      "8",
      "--max-correlations",
      "4",
    ]);
    assert.equal(analysisResult.status, 0, analysisResult.stderr || "analysis gateway should succeed");

    const analysisRows = readJsonl(analysisOutputPath);
    const threadSummary = analysisRows.find(
      (row) => String(row?.metadata?.analysisType || "") === "thread_summary"
    );
    assert.ok(threadSummary, "thread summary should be produced");
    assert.ok(Array.isArray(threadSummary.metadata?.sourceClientRequestIds));
    assert.ok(threadSummary.metadata.sourceClientRequestIds.length >= 2);

    const promoteResult = runNode([
      "./scripts/pst-memory-promote.mjs",
      "--json",
      "--input",
      analysisOutputPath,
      "--output",
      promotedOutputPath,
      "--dead-letter",
      promotedDeadLetterPath,
      "--report",
      promotedReportPath,
      "--semantic-min-score",
      "4",
      "--episodic-min-score",
      "1",
      "--max-output",
      "12",
    ]);
    assert.equal(promoteResult.status, 0, promoteResult.stderr || "promote should succeed");

    const promotedRows = readJsonl(promotedOutputPath);
    assert.ok(promotedRows.length >= 2);
    const promotedIds = new Set(promotedRows.map((row) => String(row?.id || "").trim()).filter(Boolean));
    const hasCrossLinks = promotedRows.some((row) =>
      Array.isArray(row?.metadata?.relatedMemoryIds) &&
      row.metadata.relatedMemoryIds.some((id) => promotedIds.has(String(id || "").trim()))
    );
    assert.ok(hasCrossLinks, "promoted rows should include cross-reference links");

    const importResult = runNode([
      "./scripts/pst-memory-import-resumable.mjs",
      "--json",
      "--input",
      promotedOutputPath,
      "--run-id",
      "pst-continuity-flow-test",
      "--chunk-size",
      "2",
      "--checkpoint",
      importCheckpointPath,
      "--ledger",
      importLedgerPath,
      "--dead-letter",
      importDeadLetterPath,
      "--report",
      importReportPath,
      "--open-memory-script",
      mockOpenMemoryPath,
    ]);
    assert.equal(importResult.status, 0, importResult.stderr || "import resumable should succeed");
    const importPayload = JSON.parse(String(importResult.stdout || "{}"));
    assert.equal(importPayload.progress.completed, true);
    assert.ok(Number(importPayload.totals.imported || 0) >= 2);

    const continuity = buildContinuityArtifact({
      runId: "pst-continuity-flow-test",
      promotedRows,
      generatedAt: "2026-03-04T00:00:00.000Z",
      handoffOwner: "agent:codex",
      handoffSourceShellId: "shell-source",
      handoffTargetShellId: "shell-target",
      resumeHints: ["launch-thread", "qa-blocker"],
    });
    writeFileSync(continuityArtifactPath, `${JSON.stringify(continuity, null, 2)}\n`, "utf8");
    assert.equal(continuity.activeHandoff.handoffOwner, "agent:codex");
    assert.equal(continuity.activeHandoff.handoffSourceShellId, "shell-source");
    assert.equal(continuity.activeHandoff.handoffTargetShellId, "shell-target");
    assert.ok(Array.isArray(continuity.identityAnchors) && continuity.identityAnchors.length > 0);
    assert.ok(Array.isArray(continuity.activeWorkstreams) && continuity.activeWorkstreams.length > 0);
    assert.ok(Array.isArray(continuity.recentIntentTrajectory) && continuity.recentIntentTrajectory.length > 0);

    const quality = buildRelationshipQualityArtifact({
      runId: "pst-continuity-flow-test",
      promotedRows,
      generatedAt: "2026-03-04T00:00:00.000Z",
    });
    assert.ok(Number(quality.counts.totalEdges || 0) >= 1);

    const monitoring = buildRelationshipMonitoringArtifact({
      runId: "pst-continuity-flow-test",
      generatedAt: "2026-03-04T00:00:00.000Z",
      relationshipQualityArtifact: quality,
      continuityArtifact: continuity,
    });
    assert.equal(monitoring.schema, "pst-memory-relationship-monitor.v1");
    assert.ok(Array.isArray(monitoring.alerts) && monitoring.alerts.length >= 5);
    assert.ok(["ok", "warn", "critical"].includes(String(monitoring.status)));

    const smokeResult = runNode([
      "./scripts/pst-memory-continuity-smoke.mjs",
      "--json",
      "--strict",
      "--max-runtime-ms",
      "5000",
      "--artifact",
      continuityArtifactPath,
    ]);
    assert.equal(smokeResult.status, 0, smokeResult.stderr || "continuity smoke should pass");
    const smokePayload = JSON.parse(String(smokeResult.stdout || "{}"));
    assert.equal(smokePayload.status, "pass");
    assert.ok(Number(smokePayload.runtimeMs || 0) <= Number(smokePayload.runtimeBudgetMs || 0));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
