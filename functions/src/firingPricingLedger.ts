import { calculateFiringPrice } from "./firingPricing";

/** A single customer's standard v3 work in one identified physical firing.
 * Store and update this entire record in the same Firestore transaction as a
 * billing reservation. Do not discard a reservation on an uncertain Stripe
 * outcome: it must first be reconciled with the external invoice.
 */
export type FiringPricingLedger = {
  heatId: "low" | "mid" | "high";
  quantity: number;
  wholeKiln: boolean;
  privateFulfilled: boolean;
  rushFulfilled: boolean;
  totalCents: number;
  operations: Record<string, { fingerprint: string; chargeCents: number }>;
};

export type FiringLedgerEntry = {
  operationId: string;
  heatId: FiringPricingLedger["heatId"];
  billingUnit: "half_shelf" | "whole_kiln";
  quantity: number;
  privateFulfilled: boolean;
  rushFulfilled: boolean;
};

/** Compute a reservation's incremental charge. This is a pure calculation;
 * identity verification, authorization, atomic storage and recovery belong to
 * the caller. The ledger must not be used for custom quotes or overrides.
 */
export function addFiringLedgerEntry(ledger: FiringPricingLedger | null, entry: FiringLedgerEntry): {
  ledger: FiringPricingLedger;
  chargeCents: number;
  duplicate: boolean;
} {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(entry.operationId) || ["__proto__", "constructor", "prototype"].includes(entry.operationId) || !Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 20) throw new Error("INVALID_LEDGER_ENTRY");
  if (ledger && ledger.heatId !== entry.heatId) throw new Error("FIRING_RANGE_CONFLICT");
  const fingerprint = JSON.stringify([entry.heatId, entry.billingUnit, entry.quantity, entry.privateFulfilled, entry.rushFulfilled]);
  const existing = ledger && Object.prototype.hasOwnProperty.call(ledger.operations, entry.operationId) ? ledger.operations[entry.operationId] : undefined;
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error("LEDGER_OPERATION_CONFLICT");
    return { ledger: ledger!, chargeCents: existing.chargeCents, duplicate: true };
  }
  const quantity = (ledger?.quantity ?? 0) + entry.quantity;
  const wholeKiln = Boolean(ledger?.wholeKiln || entry.billingUnit === "whole_kiln");
  const privateFulfilled = Boolean(ledger?.privateFulfilled || entry.privateFulfilled);
  const rushFulfilled = Boolean(ledger?.rushFulfilled || entry.rushFulfilled);
  // Above 20 units the standard cap has already been reached. Keep the true
  // quantity for audit, but clamp the argument accepted by the price function.
  const price = calculateFiringPrice({ version: 3, heatId: entry.heatId, billingUnit: wholeKiln ? "whole_kiln" : "half_shelf", quantity: Math.min(quantity, 20), privateFulfilled, rushFulfilled });
  if (price.chargeCents === null) throw new Error("UNSUPPORTED_LEDGER_PRICE");
  const chargeCents = price.chargeCents - (ledger?.totalCents ?? 0);
  if (chargeCents < 0) throw new Error("INVALID_LEDGER_TOTAL");
  return { ledger: { heatId: entry.heatId, quantity, wholeKiln, privateFulfilled, rushFulfilled, totalCents: price.chargeCents, operations: { ...ledger?.operations, [entry.operationId]: { fingerprint, chargeCents } } }, chargeCents, duplicate: false };
}
