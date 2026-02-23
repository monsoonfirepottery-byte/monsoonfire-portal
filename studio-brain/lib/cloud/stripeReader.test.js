"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const stripeReader_1 = require("./stripeReader");
async function withPatchedEnv(patch, run) {
    const original = {};
    for (const [key, value] of Object.entries(patch)) {
        original[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }
    try {
        await run();
    }
    finally {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
    }
}
(0, node_test_1.default)("readStripeModel stays on stub mode outside production live mode", async () => {
    await withPatchedEnv({
        NODE_ENV: "production",
        STRIPE_MODE: "test",
        STUDIO_BRAIN_ALLOW_STRIPE_STUB: undefined,
        STUDIO_BRAIN_STRIPE_READER_MODE: undefined,
    }, async () => {
        const model = await (0, stripeReader_1.readStripeModel)();
        strict_1.default.equal(model.mode, "stub");
        strict_1.default.equal(model.requestedMode, "auto");
        strict_1.default.equal(model.unsettledPayments, 0);
        strict_1.default.equal(model.warnings?.length, 0);
    });
});
(0, node_test_1.default)("readStripeModel blocks production live mode when stub override is not enabled", async () => {
    await withPatchedEnv({
        NODE_ENV: "production",
        STRIPE_MODE: "live",
        STUDIO_BRAIN_ALLOW_STRIPE_STUB: undefined,
        STUDIO_BRAIN_STRIPE_READER_MODE: "auto",
    }, async () => {
        await strict_1.default.rejects(() => (0, stripeReader_1.readStripeModel)(), /stripe reader blocked/);
    });
});
(0, node_test_1.default)("readStripeModel blocks explicit stub mode in production live mode without override", async () => {
    await withPatchedEnv({
        NODE_ENV: "production",
        STRIPE_MODE: "live",
        STUDIO_BRAIN_STRIPE_READER_MODE: "stub",
        STUDIO_BRAIN_ALLOW_STRIPE_STUB: undefined,
    }, async () => {
        await strict_1.default.rejects(() => (0, stripeReader_1.readStripeModel)(), /stub mode requested in production live mode without override/);
    });
});
(0, node_test_1.default)("readStripeModel allows explicit production stub override", async () => {
    await withPatchedEnv({
        NODE_ENV: "production",
        STRIPE_MODE: "live",
        STUDIO_BRAIN_STRIPE_READER_MODE: "stub",
        STUDIO_BRAIN_ALLOW_STRIPE_STUB: "true",
    }, async () => {
        const model = await (0, stripeReader_1.readStripeModel)();
        strict_1.default.equal(model.mode, "stub");
        strict_1.default.equal(model.requestedMode, "stub");
        strict_1.default.equal(model.warnings?.length, 2);
        strict_1.default.ok(model.warnings?.[0]?.includes("override enabled"));
    });
});
(0, node_test_1.default)("resolveStripeReaderPolicy blocks live_read mode because it is not implemented", () => {
    const policy = (0, stripeReader_1.resolveStripeReaderPolicy)({
        nodeEnv: "production",
        stripeMode: "live",
        readerMode: "live_read",
        allowStubOverride: false,
    });
    strict_1.default.equal(policy.allowed, false);
    strict_1.default.equal(policy.mode, "live_read");
    strict_1.default.equal(policy.requestedMode, "live_read");
});
(0, node_test_1.default)("resolveStripeReaderPolicy falls back to auto mode when configured mode is invalid", () => {
    const policy = (0, stripeReader_1.resolveStripeReaderPolicy)({
        nodeEnv: "development",
        stripeMode: "test",
        readerMode: "invalid_mode",
        allowStubOverride: false,
    });
    strict_1.default.equal(policy.allowed, true);
    strict_1.default.equal(policy.mode, "stub");
    strict_1.default.equal(policy.requestedMode, "auto");
    strict_1.default.equal(policy.warnings.some((entry) => entry.includes("invalid stripe reader mode")), true);
});
