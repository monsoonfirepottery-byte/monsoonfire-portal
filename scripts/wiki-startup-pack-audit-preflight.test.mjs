import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  buildRefreshArgs,
  contextNeedsRefresh,
  hasJsonArg,
  parseContextArg,
  refreshArtifactForContext,
} from "./wiki-startup-pack-audit-preflight.mjs";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("wiki startup preflight refreshes when context artifact is missing or malformed", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-startup-preflight-missing-"));
  try {
    assert.equal(contextNeedsRefresh({ repoRoot: root }), true);
    writeFileSync(join(root, "output-wrong.json"), "{not json", "utf8");
    assert.equal(contextNeedsRefresh({ repoRoot: root, context: "output-wrong.json" }), true);
    writeJson(join(root, "output/wiki/context-refresh.json"), {
      schema: "wiki-context-pack-report.v1",
      contextPack: { items: [] },
    });
    assert.equal(contextNeedsRefresh({ repoRoot: root }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wiki startup preflight honors explicit context arguments", () => {
  const root = mkdtempSync(join(tmpdir(), "wiki-startup-preflight-context-"));
  try {
    writeJson(join(root, "custom/context.json"), { schema: "wiki-context-pack.v1", items: [] });
    assert.equal(parseContextArg(["--strict", "--context", "custom/context.json"]), "custom/context.json");
    assert.equal(parseContextArg(["--context=custom/context.json"]), "custom/context.json");
    assert.equal(contextNeedsRefresh({ repoRoot: root, context: "custom/context.json" }), false);
    assert.equal(contextNeedsRefresh({ repoRoot: root, context: "custom/missing.json" }), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wiki startup preflight keeps JSON audit stdout single-object friendly", () => {
  assert.equal(hasJsonArg(["--strict", "--json"]), true);
  assert.equal(hasJsonArg(["--strict"]), false);
  assert.equal(refreshArtifactForContext("custom/context.json"), "custom/context.json");
  assert.equal(refreshArtifactForContext(""), "output/wiki/context-refresh.json");
  assert.deepEqual(buildRefreshArgs("custom/context.json"), [
    "./scripts/wiki-postgres.mjs",
    "context",
    "--fresh-extract",
    "--write-markdown",
    "--json",
    "--artifact",
    "custom/context.json",
  ]);
});
