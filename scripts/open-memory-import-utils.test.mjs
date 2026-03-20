import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImportCommandPayload } from "./lib/open-memory-import-utils.mjs";

function intFlag(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

test("buildImportCommandPayload preserves row source when --source is omitted", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "open-memory-import-"));
  const inputPath = join(tempDir, "rows.jsonl");
  writeFileSync(
    inputPath,
    [
      JSON.stringify({
        content: "Repo markdown row",
        source: "repo-markdown",
        clientRequestId: "repo-1",
      }),
      JSON.stringify({
        content: "Codex row",
        source: "codex-resumable-session",
        clientRequestId: "codex-1",
      }),
    ].join("\n"),
    "utf8"
  );

  const payload = buildImportCommandPayload({
    inputPath,
    flags: {},
    intFlag,
    parseCsv,
  });

  assert.equal(Object.prototype.hasOwnProperty.call(payload, "sourceOverride"), false);
  assert.equal(payload.items[0]?.source, "repo-markdown");
  assert.equal(payload.items[1]?.source, "codex-resumable-session");
});

test("buildImportCommandPayload only sends sourceOverride when --source is explicit", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "open-memory-import-"));
  const inputPath = join(tempDir, "rows.txt");
  writeFileSync(inputPath, "plain text import row", "utf8");

  const payload = buildImportCommandPayload({
    inputPath,
    flags: {
      source: "import",
      "continue-on-error": "false",
    },
    intFlag,
    parseCsv,
  });

  assert.equal(payload.sourceOverride, "import");
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0]?.source, "import");
  assert.equal(payload.continueOnError, false);
});
