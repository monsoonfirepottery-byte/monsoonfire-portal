import test from "node:test";
import assert from "node:assert/strict";

import { billingSummaryTestHooks } from "./billingSummary";

test("billing summary helpers narrow Firestore array values without any", () => {
  const rows = billingSummaryTestHooks.asRecordArray([
    {
      productId: "clay-1",
      quantity: 2,
    },
    null,
    "not-an-object",
  ]);

  assert.deepEqual(rows, [
    {
      productId: "clay-1",
      quantity: 2,
    },
    {},
    {},
  ]);
});

test("billing summary helper normalizes currency from unknown input", () => {
  assert.equal(billingSummaryTestHooks.normalizeCurrency("usd"), "USD");
  assert.equal(billingSummaryTestHooks.normalizeCurrency(""), "USD");
  assert.equal(billingSummaryTestHooks.normalizeCurrency(null), "USD");
});

test("billing summary helper reports unknown errors without loose catch any", () => {
  assert.equal(billingSummaryTestHooks.errorMessage(new Error("index missing")), "index missing");
  assert.equal(billingSummaryTestHooks.errorMessage("plain failure"), "plain failure");
  assert.equal(billingSummaryTestHooks.errorMessage(null), "Unknown error");
});
