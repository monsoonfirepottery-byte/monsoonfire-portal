import test from "node:test";
import assert from "node:assert/strict";

import { isCommunityShelfIntakeMode, normalizeIntakeMode } from "./intakeMode";

test("normalizeIntakeMode returns canonical values", () => {
  assert.equal(normalizeIntakeMode("SHELF_PURCHASE"), "SHELF_PURCHASE");
  assert.equal(normalizeIntakeMode("WHOLE_KILN"), "WHOLE_KILN");
  assert.equal(normalizeIntakeMode("COMMUNITY_SHELF"), "COMMUNITY_SHELF");
});

test("normalizeIntakeMode maps legacy values to shelf purchase", () => {
  assert.equal(normalizeIntakeMode("SELF_SERVICE"), "SHELF_PURCHASE");
  assert.equal(normalizeIntakeMode("STAFF_HANDOFF"), "SHELF_PURCHASE");
  assert.equal(normalizeIntakeMode("KILNFIRE_PIECES"), "SHELF_PURCHASE");
});

test("normalizeIntakeMode uses fallback for unknown values", () => {
  assert.equal(normalizeIntakeMode("unknown"), "SHELF_PURCHASE");
  assert.equal(normalizeIntakeMode("unknown", "COMMUNITY_SHELF"), "COMMUNITY_SHELF");
});

test("isCommunityShelfIntakeMode detects community mode safely", () => {
  assert.equal(isCommunityShelfIntakeMode("COMMUNITY_SHELF"), true);
  assert.equal(isCommunityShelfIntakeMode("WHOLE_KILN"), false);
  assert.equal(isCommunityShelfIntakeMode("SELF_SERVICE"), false);
  assert.equal(isCommunityShelfIntakeMode(null), false);
});
