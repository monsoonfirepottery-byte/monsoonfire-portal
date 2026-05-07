import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInstalledToolsFreshness,
  sourceFreshness
} from "./admin_effectivity_audit.mjs";

test("sourceFreshness rejects sources older than the selected slice window", () => {
  const result = sourceFreshness("2026-05-07T10:00:00.000Z", {
    now: "2026-05-07T11:00:00.000Z",
    minGeneratedAt: "2026-05-07T10:30:00.000Z",
    maxAgeHours: 24
  });

  assert.equal(result.status, "older_than_slice_window");
  assert.equal(result.score, 0);
});

test("sourceFreshness accepts fresh sources inside the max age", () => {
  const result = sourceFreshness("2026-05-07T10:45:00.000Z", {
    now: "2026-05-07T11:00:00.000Z",
    minGeneratedAt: "2026-05-07T10:30:00.000Z",
    maxAgeHours: 24
  });

  assert.equal(result.status, "fresh");
  assert.equal(result.score, 1);
});

test("buildInstalledToolsFreshness requires both inventory and tooling source freshness", () => {
  const stale = buildInstalledToolsFreshness({
    schema: "studiobrain-installed-tool-inventory.v1",
    generatedAt: "2026-05-07T11:00:00.000Z",
    effectivitySource: {
      generatedAt: "2026-05-07T09:00:00.000Z",
      status: "warn"
    }
  }, {
    now: "2026-05-07T11:05:00.000Z",
    minGeneratedAt: "2026-05-07T10:30:00.000Z"
  });

  assert.equal(stale.status, "stale_source");
  assert.equal(stale.score, 0);
  assert.equal(stale.inventory.status, "fresh");
  assert.equal(stale.toolingQuality.status, "older_than_slice_window");

  const fresh = buildInstalledToolsFreshness({
    schema: "studiobrain-installed-tool-inventory.v1",
    generatedAt: "2026-05-07T11:00:00.000Z",
    effectivitySource: {
      generatedAt: "2026-05-07T10:45:00.000Z",
      status: "warn"
    }
  }, {
    now: "2026-05-07T11:05:00.000Z",
    minGeneratedAt: "2026-05-07T10:30:00.000Z"
  });

  assert.equal(fresh.status, "fresh");
  assert.equal(fresh.score, 1);
});
