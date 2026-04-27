import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { maybeLogStartupTelemetryToolcall } from "./codex-startup-telemetry.mjs";

test("maybeLogStartupTelemetryToolcall dedupes nested startup packet observations", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-startup-telemetry-"));
  const codexDir = join(repoRoot, ".codex");
  const toolcallPath = join(codexDir, "toolcalls.ndjson");

  try {
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      toolcallPath,
      `${JSON.stringify({
        tsIso: new Date().toISOString(),
        tool: "codex-desktop",
        action: "startup-bootstrap",
        context: {
          startup: {
            startupPacket: {
              observationKey: "thread-1|rollout-1.jsonl",
            },
          },
        },
      })}\n`,
      "utf8"
    );

    const result = maybeLogStartupTelemetryToolcall({
      tool: "codex-desktop",
      action: "startup-bootstrap",
      context: {
        startup: {
          startupPacket: {
            observationKey: "thread-1|rollout-1.jsonl",
          },
        },
      },
      cwd: repoRoot,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "startup-observation-already-logged");
    assert.equal(readFileSync(toolcallPath, "utf8").trim().split(/\r?\n/).length, 1);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
