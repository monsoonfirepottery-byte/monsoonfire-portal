import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("rubric scorecard reads Codex exec snake-case reasoning usage", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-rubric-"));
  try {
    const toolcallsPath = join(tempRoot, "toolcalls.ndjson");
    const statePath = join(tempRoot, "state.json");
    writeFileSync(
      toolcallsPath,
      `${JSON.stringify({
        tsIso: new Date().toISOString(),
        actor: "codex",
        tool: "codex.exec",
        action: "shadow",
        ok: true,
        durationMs: 1200,
        errorType: "",
        errorMessage: "",
        context: {},
        usage: {
          input_tokens: 100,
          cached_input_tokens: 40,
          output_tokens: 30,
          reasoning_output_tokens: 20,
          total_tokens: 150,
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(statePath, JSON.stringify({ recommendations: [] }), "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "scripts/codex/rubric-scorecard.mjs",
        "--toolcalls",
        toolcallsPath,
        "--state",
        statePath,
        "--window-hours",
        "1",
        "--estimate-token-usage",
        "false",
        "--json",
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.metrics.tokens.inputTokens, 100);
    assert.equal(report.metrics.tokens.cacheReadTokens, 40);
    assert.equal(report.metrics.tokens.outputTokens, 30);
    assert.equal(report.metrics.tokens.reasoningTokens, 20);
    assert.equal(report.metrics.tokens.totalTokens, 150);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
