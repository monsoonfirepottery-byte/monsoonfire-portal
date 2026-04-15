import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyMyPiecesEmptyStates,
  normalizeCanaryText,
} from "./portal-authenticated-canary-state.mjs";

test("normalizeCanaryText collapses whitespace for canary comparisons", () => {
  assert.equal(normalizeCanaryText("  Loading   history...\n"), "Loading history...");
});

test("classifyMyPiecesEmptyStates keeps loading variants out of empty guidance checks", () => {
  const state = classifyMyPiecesEmptyStates([
    "Loading ratings queue...",
    "Loading history...",
  ]);

  assert.equal(state.loadingVisible, true);
  assert.equal(state.nonLoadingEmptyStateCount, 0);
  assert.deepEqual(state.nonLoadingEmptyStates, []);
  assert.equal(state.hasRecognizedEmptyGuidance, false);
});

test("classifyMyPiecesEmptyStates recognizes settled empty guidance and custom patterns", () => {
  const builtInGuidance = classifyMyPiecesEmptyStates([
    "Your first completed pieces will land here.",
  ]);
  const customGuidance = classifyMyPiecesEmptyStates(
    ["Staff curated placeholder copy."],
    ["placeholder copy"]
  );

  assert.equal(builtInGuidance.loadingVisible, false);
  assert.equal(builtInGuidance.nonLoadingEmptyStateCount, 1);
  assert.equal(builtInGuidance.hasRecognizedEmptyGuidance, true);

  assert.equal(customGuidance.loadingVisible, false);
  assert.equal(customGuidance.nonLoadingEmptyStateCount, 1);
  assert.equal(customGuidance.hasRecognizedEmptyGuidance, true);
});
