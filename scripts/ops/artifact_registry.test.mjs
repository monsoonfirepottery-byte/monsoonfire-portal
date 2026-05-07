import test from "node:test";
import assert from "node:assert/strict";

import { defaultArtifactRegistry, FRESHNESS_TIERS, OPS_ARTIFACT_REGISTRY } from "./artifact_registry.mjs";

test("ops artifact registry has unique ids and schema-backed entries", () => {
  const ids = OPS_ARTIFACT_REGISTRY.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);

  for (const entry of OPS_ARTIFACT_REGISTRY) {
    assert.match(entry.id, /^[a-z0-9-]+$/);
    assert.match(entry.artifact, /^output\/ops\/.+\.json$/);
    assert.match(entry.schema, /^schemas\/ops\/.+\.schema\.json$/);
    assert.ok(Object.hasOwn(FRESHNESS_TIERS, entry.freshnessTier));
  }
});

test("defaultArtifactRegistry returns a defensive copy", () => {
  const registry = defaultArtifactRegistry();
  registry[0].id = "mutated";

  assert.notEqual(OPS_ARTIFACT_REGISTRY[0].id, "mutated");
});

test("defaultArtifactRegistry expands freshness tiers into maxAgeHours", () => {
  const registry = defaultArtifactRegistry();
  const loopEntry = registry.find((entry) => entry.freshnessTier === "loop");
  const dailyEntry = registry.find((entry) => entry.freshnessTier === "daily");

  assert.equal(loopEntry.maxAgeHours, FRESHNESS_TIERS.loop.maxAgeHours);
  assert.equal(dailyEntry.maxAgeHours, FRESHNESS_TIERS.daily.maxAgeHours);
});
