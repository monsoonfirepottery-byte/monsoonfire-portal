"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readStripeModel = readStripeModel;
// P0: read-only scaffold. No direct Stripe secret use in local brain.
// Cloud (Functions) remains authoritative for payment state.
async function readStripeModel() {
    const startedAt = Date.now();
    return {
        readAt: new Date().toISOString(),
        unsettledPayments: 0,
        durationMs: Date.now() - startedAt,
        mode: "stub",
        warnings: [],
    };
}
