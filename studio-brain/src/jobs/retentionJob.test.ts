import test from "node:test";
import assert from "node:assert/strict";
import { computeRetentionCutoff } from "./retentionJob";

test("computeRetentionCutoff applies retention window in days", () => {
  const now = new Date("2026-02-13T12:00:00.000Z");
  const cutoff = computeRetentionCutoff(now, 30);
  assert.equal(cutoff, "2026-01-14T12:00:00.000Z");
});

test("computeRetentionCutoff enforces minimum one-day window", () => {
  const now = new Date("2026-02-13T12:00:00.000Z");
  const cutoff = computeRetentionCutoff(now, 0);
  assert.equal(cutoff, "2026-02-12T12:00:00.000Z");
});
