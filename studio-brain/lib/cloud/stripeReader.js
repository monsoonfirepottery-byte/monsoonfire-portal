"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveStripeReaderPolicy = resolveStripeReaderPolicy;
exports.readStripeModel = readStripeModel;
function parseBool(value) {
    if (!value)
        return false;
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
}
function resolveStripeReaderPolicy(options = {}) {
    const stripeMode = options.stripeMode ?? process.env.STRIPE_MODE ?? "test";
    const allowStubOverride = options.allowStubOverride ?? parseBool(process.env.STUDIO_BRAIN_ALLOW_STRIPE_STUB);
    const production = process.env.NODE_ENV === "production";
    if (stripeMode !== "live" || !production) {
        return { allowed: true, mode: "stub", warnings: [] };
    }
    if (allowStubOverride) {
        return {
            allowed: true,
            mode: "stub",
            warnings: [
                "stripe stub override enabled for production live mode",
                "cloud functions remain the authoritative Stripe source of truth",
            ],
        };
    }
    return {
        allowed: false,
        mode: "live_read",
        warnings: ["production live mode requested but Stripe live-read is not implemented"],
    };
}
// P0: read-only scaffold. No direct Stripe secret use in local brain.
// Cloud (Functions) remains authoritative for payment state.
async function readStripeModel() {
    const startedAt = Date.now();
    const policy = resolveStripeReaderPolicy();
    if (!policy.allowed) {
        throw new Error("stripe stub fallback is blocked for production live mode");
    }
    return {
        readAt: new Date().toISOString(),
        unsettledPayments: 0,
        durationMs: Date.now() - startedAt,
        mode: policy.mode,
        warnings: policy.warnings,
    };
}
