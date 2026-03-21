import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { stableHash } from "./lib/pst-memory-utils.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

function runPromote(args) {
  return spawnSync(process.execPath, ["./scripts/pst-memory-promote.mjs", "--json", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

test("pst-memory-promote applies gating, novelty dedupe, and memory layers", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pst-promote-"));
  try {
    const input = join(tempDir, "analysis.jsonl");
    const output = join(tempDir, "promoted.jsonl");
    const deadLetter = join(tempDir, "dead.jsonl");
    const report = join(tempDir, "report.json");

    const rows = [
      {
        content: "Decision summary about launch and owner assignment.",
        source: "pst:analysis-hybrid",
        tags: ["decision"],
        clientRequestId: "id-1",
        metadata: { analysisType: "thread_summary", score: 9, subject: "Launch" },
      },
      {
        content: "Decision summary about launch and owner assignment.",
        source: "pst:analysis-hybrid",
        tags: ["decision"],
        clientRequestId: "id-1-dup",
        metadata: { analysisType: "thread_summary", score: 8, subject: "Launch" },
      },
      {
        content: "Minor note with weak signal.",
        source: "pst:analysis-hybrid",
        tags: ["note"],
        clientRequestId: "id-2",
        metadata: { analysisType: "message_insight", score: 1 },
      },
      {
        content: "Action follow-up with deadline and owner.",
        source: "pst:analysis-hybrid",
        tags: ["action"],
        clientRequestId: "id-3",
        metadata: { analysisType: "message_insight", score: 5 },
      },
    ];
    writeFileSync(input, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

    const result = runPromote([
      "--input",
      input,
      "--output",
      output,
      "--dead-letter",
      deadLetter,
      "--report",
      report,
      "--semantic-min-score",
      "7",
      "--episodic-min-score",
      "3",
    ]);
    assert.equal(result.status, 0, result.stderr || "promote should succeed");

    const payload = JSON.parse(String(result.stdout || "{}"));
    assert.equal(payload.counts.promotedRows, 2);
    assert.equal(payload.counts.semanticRows, 1);
    assert.equal(payload.counts.episodicRows, 1);
    assert.ok(payload.counts.droppedRows >= 2);

    const promotedRows = readFileSync(output, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(promotedRows.length, 2);
    assert.ok(promotedRows.some((row) => row.metadata?.memoryLayer === "semantic"));
    assert.ok(promotedRows.some((row) => row.metadata?.memoryLayer === "episodic"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function deriveMemoryId({ tenantId, clientRequestId }) {
  const scope = String(tenantId || "none").trim();
  return `mem_req_${stableHash(`${scope}|${String(clientRequestId || "")}`)}`;
}

test("pst-memory-promote adds deterministic memory ids and relationship links", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pst-promote-"));
  try {
    const input = join(tempDir, "analysis-thread.jsonl");
    const output = join(tempDir, "promoted.jsonl");
    const deadLetter = join(tempDir, "dead.jsonl");
    const report = join(tempDir, "report.json");

    const rows = [
      {
        content: "Launch thread summary with owner and owner feedback.",
        source: "pst:analysis-hybrid",
        tags: ["thread_summary"],
        clientRequestId: "thread-summary-1",
        metadata: {
          analysisType: "thread_summary",
          score: 9,
          threadKey: "thread:launch",
          sourceClientRequestIds: ["msg-a", "msg-b"],
        },
      },
      {
        content: "Message follow-up confirms launch window and owner.",
        source: "pst:analysis-hybrid",
        tags: ["message_insight"],
        clientRequestId: "msg-b",
        metadata: {
          analysisType: "message_insight",
          score: 8,
          threadKey: "thread:launch",
          sourceClientRequestId: "msg-b",
        },
      },
      {
        content: "Unrelated low-signal reminder.",
        source: "pst:analysis-hybrid",
        tags: ["note"],
        clientRequestId: "low-signal",
        metadata: { analysisType: "message_insight", score: 1 },
      },
    ];
    writeFileSync(input, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

    const result = runPromote([
      "--input",
      input,
      "--output",
      output,
      "--dead-letter",
      deadLetter,
      "--report",
      report,
      "--semantic-min-score",
      "7",
      "--episodic-min-score",
      "2",
      "--max-output",
      "5",
    ]);
    assert.equal(result.status, 0, result.stderr || "promote should succeed");

    const promotedRows = readFileSync(output, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.equal(promotedRows.length, 2);
    const byRequestId = new Map(promotedRows.map((row) => [String(row.clientRequestId), row]));
    const summary = byRequestId.get("thread-summary-1");
    const message = byRequestId.get("msg-b");

    assert.ok(summary, "thread summary should be present");
    assert.ok(message, "message insight should be present");

    const expectedSummaryId = deriveMemoryId({
      tenantId: summary.tenantId,
      clientRequestId: summary.clientRequestId,
    });
    const expectedMessageId = deriveMemoryId({
      tenantId: message.tenantId,
      clientRequestId: message.clientRequestId,
    });

    assert.equal(summary.id, expectedSummaryId);
    assert.equal(message.id, expectedMessageId);
    assert.ok(Array.isArray(summary.metadata?.relatedMemoryIds));
    assert.ok(Array.isArray(message.metadata?.relatedMemoryIds));
    assert.ok(summary.metadata.relatedMemoryIds.includes(expectedMessageId));
    assert.ok(message.metadata.relatedMemoryIds.includes(expectedSummaryId));
    assert.ok(Array.isArray(summary.metadata?.relationships));
    assert.ok(Array.isArray(message.metadata?.relationships));
    assert.ok(Array.isArray(summary.metadata?.relationTypes));
    assert.ok(Array.isArray(message.metadata?.relationTypes));
    assert.equal(summary.metadata?.relationshipModel?.appendOnly, true);
    assert.equal(message.metadata?.relationshipModel?.appendOnly, true);

    const summaryEdges = summary.metadata.relationships;
    const messageEdges = message.metadata.relationships;
    const summaryTargets = new Set(summaryEdges.map((edge) => edge?.toMemoryId));
    const messageTargets = new Set(messageEdges.map((edge) => edge?.toMemoryId));
    assert.ok(summaryTargets.has(expectedMessageId));
    assert.ok(messageTargets.has(expectedSummaryId));
    assert.ok(summaryEdges.every((edge) => edge?.direction === "outbound"));
    assert.ok(messageEdges.every((edge) => edge?.direction === "outbound"));
    assert.ok(summaryEdges.every((edge) => typeof edge?.confidence === "number"));
    assert.ok(messageEdges.every((edge) => typeof edge?.confidence === "number"));
    assert.ok(summaryEdges.some((edge) => edge?.type === "thread_neighbor"));
    assert.ok(messageEdges.some((edge) => edge?.type === "source_reference"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
