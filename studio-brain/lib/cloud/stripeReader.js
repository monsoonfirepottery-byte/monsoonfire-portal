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
function parseMode(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "stub")
        return "stub";
    if (normalized === "live_read")
        return "live_read";
    return "auto";
}
function resolveStripeReaderPolicy(options = {}) {
    const stripeMode = options.stripeMode ?? process.env.STRIPE_MODE ?? "test";
    const allowStubOverride = options.allowStubOverride ?? parseBool(process.env.STUDIO_BRAIN_ALLOW_STRIPE_STUB);
    const requestedMode = parseMode(options.readerMode ?? process.env.STUDIO_BRAIN_STRIPE_READER_MODE);
    const rawRequestedMode = String(options.readerMode ?? process.env.STUDIO_BRAIN_STRIPE_READER_MODE ?? "").trim();
    const nodeEnv = (options.nodeEnv ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
    const production = nodeEnv === "production";
    const productionLive = stripeMode === "live" && production;
    const warnings = [];
    if (rawRequestedMode && requestedMode === "auto") {
        warnings.push(`invalid stripe reader mode '${rawRequestedMode}' defaulted to auto`);
    }
    if (requestedMode === "live_read") {
        return {
            allowed: false,
            mode: "live_read",
            requestedMode,
            reason: "live-read mode requested, but Stripe live-read is not implemented",
            warnings: [...warnings, "cloud functions remain the authoritative Stripe source of truth"],
        };
    }
    if (requestedMode === "stub") {
        if (!productionLive) {
            return {
                allowed: true,
                mode: "stub",
                requestedMode,
                reason: "explicit stub mode allowed outside production live mode",
                warnings,
            };
        }
        if (allowStubOverride) {
            return {
                allowed: true,
                mode: "stub",
                requestedMode,
                reason: "explicit production stub override enabled",
                warnings: [
                    ...warnings,
                    "stripe stub override enabled for production live mode",
                    "cloud functions remain the authoritative Stripe source of truth",
                ],
            };
        }
        return {
            allowed: false,
            mode: "live_read",
            requestedMode,
            reason: "stub mode requested in production live mode without override",
            warnings: [
                ...warnings,
                "set STUDIO_BRAIN_ALLOW_STRIPE_STUB=true only for emergency controlled fallback",
            ],
        };
    }
    if (!productionLive) {
        return {
            allowed: true,
            mode: "stub",
            requestedMode,
            reason: "auto mode resolved to stub outside production live mode",
            warnings,
        };
    }
    if (allowStubOverride) {
        return {
            allowed: true,
            mode: "stub",
            requestedMode,
            reason: "auto mode resolved to stub via explicit production override",
            warnings: [
                ...warnings,
                "stripe stub override enabled for production live mode",
                "cloud functions remain the authoritative Stripe source of truth",
            ],
        };
    }
    return {
        allowed: false,
        mode: "live_read",
        requestedMode,
        reason: "production live mode requested but Stripe live-read is not implemented",
        warnings: [
            ...warnings,
            "configure STUDIO_BRAIN_STRIPE_READER_MODE=stub plus STUDIO_BRAIN_ALLOW_STRIPE_STUB=true for explicit temporary fallback",
        ],
    };
}
// P0: read-only scaffold. No direct Stripe secret use in local brain.
// Cloud (Functions) remains authoritative for payment state.
async function readStripeModel() {
    const startedAt = Date.now();
    const policy = resolveStripeReaderPolicy();
    if (!policy.allowed) {
        throw new Error(`stripe reader blocked: ${policy.reason}`);
    }
    return {
        readAt: new Date().toISOString(),
        unsettledPayments: 0,
        durationMs: Date.now() - startedAt,
        mode: policy.mode,
        requestedMode: policy.requestedMode,
        warnings: policy.warnings,
    };
}
