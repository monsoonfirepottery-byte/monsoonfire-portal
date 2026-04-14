import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildVisualDiffAggregateJson,
  buildVisualDiffAggregateMarkdown,
  comparePngFiles,
  encodePng,
  loadPortalVisualDiffPlan,
  normalizeVisualDiffId,
} from "./lib/portal-visual-diff.mjs";

function makeImage(width, height, pixels) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 1) {
    const [r, g, b, a] = pixels[index];
    data[index * 4] = r;
    data[index * 4 + 1] = g;
    data[index * 4 + 2] = b;
    data[index * 4 + 3] = a;
  }
  return encodePng({ width, height, data });
}

test("normalizes visual diff ids", () => {
  assert.equal(normalizeVisualDiffId(" Portal Authenticated Canary "), "portal-authenticated-canary");
});

test("loads the portal visual diff plan", () => {
  const plan = loadPortalVisualDiffPlan();
  assert.ok(plan.scripts["portal-authenticated-canary"]);
  assert.ok(plan.scripts["portal-community-layout-canary"]);
  assert.ok(plan.scripts["portal-playwright-smoke"]);
});

test("compares png images and emits a diff sheet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "portal-visual-diff-"));
  const baselinePath = join(dir, "baseline.png");
  const actualPath = join(dir, "actual.png");

  await writeFile(
    baselinePath,
    makeImage(2, 2, [
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [0, 128, 255, 255],
      [255, 128, 0, 255],
    ])
  );
  await writeFile(
    actualPath,
    makeImage(2, 2, [
      [255, 255, 255, 255],
      [10, 10, 10, 255],
      [0, 128, 255, 255],
      [255, 128, 0, 255],
    ])
  );

  const comparison = await comparePngFiles(baselinePath, actualPath);
  assert.equal(comparison.same, false);
  assert.equal(comparison.diffPixels, 1);
  assert.equal(comparison.totalPixels, 4);
  assert.ok(comparison.comparisonSheet);
  assert.equal(comparison.comparisonSheet.width, 2 * 3 + 24);
  assert.equal(comparison.comparisonSheet.height, 2);
});

test("renders an aggregate markdown summary", () => {
  const markdown = buildVisualDiffAggregateMarkdown([
    {
      scriptTitle: "Portal smoke",
      status: "passed",
      mode: "compare",
      totals: { frames: 2, failed: 0 },
      markdownPath: "/tmp/portal-visual-diff.md",
    },
  ]);
  assert.match(markdown, /Portal visual diff triage/);
  assert.match(markdown, /Portal smoke/);
});

test("builds an aggregate json summary", () => {
  const json = buildVisualDiffAggregateJson([
    { totals: { frames: 2, passed: 2, failed: 0, captured: 0, missing: 0 } },
  ]);
  assert.equal(json.totals.frames, 2);
  assert.equal(json.totals.passed, 2);
});

