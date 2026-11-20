import assert from "node:assert/strict";
import test from "node:test";
import { addFiringLedgerEntry, type FiringLedgerEntry, type FiringPricingLedger } from "./firingPricingLedger";

const entry = (operationId: string, quantity: number, extras: Partial<FiringLedgerEntry> = {}): FiringLedgerEntry => ({ operationId, quantity, heatId: "high", billingUnit: "half_shelf", privateFulfilled: false, rushFulfilled: false, ...extras });

test("multiple tickets reserve only the remaining base and each add-on once", () => {
  let ledger: FiringPricingLedger | null = null;
  const amounts: number[] = [];
  for (const next of [entry("one", 2, { rushFulfilled: true }), entry("two", 1, { rushFulfilled: true }), entry("three", 1), entry("four", 1)]) {
    const result = addFiringLedgerEntry(ledger, next); ledger = result.ledger; amounts.push(result.chargeCents);
  }
  assert.deepEqual(amounts, [11000, 4500, 2500, 0]);
  assert.equal(ledger?.totalCents, 18000);
});

test("private partial loads reach $180 and do not repeat privacy or rush", () => {
  const first = addFiringLedgerEntry(null, entry("a", 1, { privateFulfilled: true, rushFulfilled: true }));
  assert.equal(first.chargeCents, 20000);
  assert.equal(addFiringLedgerEntry(first.ledger, entry("b", 2, { privateFulfilled: true, rushFulfilled: true })).chargeCents, 0);
  const shared = addFiringLedgerEntry(null, entry("c", 2));
  assert.equal(addFiringLedgerEntry(shared.ledger, entry("d", 1, { privateFulfilled: true })).chargeCents, 9000);
});

test("retries are idempotent and conflicting inputs and firing ranges fail", () => {
  const first = addFiringLedgerEntry(null, entry("a", 3));
  assert.equal(addFiringLedgerEntry(first.ledger, entry("a", 3)).duplicate, true);
  assert.throws(() => addFiringLedgerEntry(first.ledger, entry("a", 2)), /LEDGER_OPERATION_CONFLICT/);
  assert.throws(() => addFiringLedgerEntry(first.ledger, entry("b", 1, { heatId: "mid" })), /FIRING_RANGE_CONFLICT/);
});
