import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { runGuardrails } from "./stability-guardrails.mjs";

function writeArtifact(path, content = "artifact\n") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function touchTreeOld(root, daysOld = 30) {
  const at = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  utimesSync(root, at, at);
}

test("guardrails cleanup prunes aged memory source artifacts and preserves summaries", () => {
  const outputRoot = join(tmpdir(), `stability-guardrails-${Date.now()}`);
  const oldPstRoot = join(outputRoot, "memory", "pst-signal-quality-run-2026-03-06-finalcandidate");
  const oldWaveRoot = join(outputRoot, "memory", "production-wave-2026-03-07a");
  const oldOvernightRoot = join(outputRoot, "memory", "overnight-iterate-2026-03-06a");
  const oldTwitterRoot = join(outputRoot, "memory", "twitter-production-run-2026-03-06a");
  const recentWaveRoot = join(outputRoot, "memory", "production-wave-2026-03-30a");

  try {
    writeArtifact(join(oldPstRoot, "canonical-corpus", "source-index", "chunk.json"), "pst\n");
    writeArtifact(join(oldPstRoot, "canonical-corpus", "corpus.sqlite"), "sqlite\n");
    writeArtifact(join(oldPstRoot, "signal-quality", "report.json"), "{}\n");
    writeArtifact(join(oldWaveRoot, "sources", "mail", "messages.jsonl"), "mail\n");
    writeArtifact(join(oldWaveRoot, "wave-summary.json"), "{}\n");
    writeArtifact(join(oldOvernightRoot, "iteration-01-grounded-message-insights", "report.json"), "{}\n");
    writeArtifact(join(oldOvernightRoot, "overnight-summary.json"), "{}\n");
    writeArtifact(join(oldTwitterRoot, "canonical-corpus", "manifest.json"), "{}\n");
    writeArtifact(join(oldTwitterRoot, "twitter-analysis-report.json"), "{}\n");
    writeArtifact(join(recentWaveRoot, "sources", "mail", "messages.jsonl"), "recent\n");

    touchTreeOld(join(outputRoot, "memory", "pst-signal-quality-run-2026-03-06-finalcandidate"));
    touchTreeOld(join(outputRoot, "memory", "production-wave-2026-03-07a"));
    touchTreeOld(join(outputRoot, "memory", "overnight-iterate-2026-03-06a"));
    touchTreeOld(join(outputRoot, "memory", "twitter-production-run-2026-03-06a"));

    const report = runGuardrails({
      outputDir: outputRoot,
      cleanupArtifacts: true,
      cleanupDays: 14,
      strict: false,
      json: true,
    });

    assert.equal(report.cleanup?.removedFiles, 5);
    assert.ok(!existsSync(join(oldPstRoot, "canonical-corpus", "source-index")));
    assert.ok(!existsSync(join(oldPstRoot, "canonical-corpus", "corpus.sqlite")));
    assert.ok(existsSync(join(oldPstRoot, "signal-quality", "report.json")));
    assert.ok(!existsSync(join(oldWaveRoot, "sources")));
    assert.ok(existsSync(join(oldWaveRoot, "wave-summary.json")));
    assert.ok(!existsSync(join(oldOvernightRoot, "iteration-01-grounded-message-insights")));
    assert.ok(existsSync(join(oldOvernightRoot, "overnight-summary.json")));
    assert.ok(!existsSync(join(oldTwitterRoot, "canonical-corpus")));
    assert.ok(existsSync(join(oldTwitterRoot, "twitter-analysis-report.json")));
    assert.ok(existsSync(join(recentWaveRoot, "sources", "mail", "messages.jsonl")));
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});
