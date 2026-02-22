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
    }, async () => {
        const model = await (0, stripeReader_1.readStripeModel)();
        strict_1.default.equal(model.mode, "stub");
        strict_1.default.equal(model.unsettledPayments, 0);
        strict_1.default.equal(model.warnings?.length, 0);
    });
});
(0, node_test_1.default)("readStripeModel blocks production live mode when stub override is not enabled", async () => {
    await withPatchedEnv({
        NODE_ENV: "production",
        STRIPE_MODE: "live",
        STUDIO_BRAIN_ALLOW_STRIPE_STUB: undefined,
    }, async () => {
        await strict_1.default.rejects(() => (0, stripeReader_1.readStripeModel)(), /stub fallback is blocked/);
    });
});
(0, node_test_1.default)("readStripeModel allows explicit production stub override", async () => {
    await withPatchedEnv({
        NODE_ENV: "production",
        STRIPE_MODE: "live",
        STUDIO_BRAIN_ALLOW_STRIPE_STUB: "true",
    }, async () => {
        const model = await (0, stripeReader_1.readStripeModel)();
        strict_1.default.equal(model.mode, "stub");
        strict_1.default.equal(model.warnings?.length, 2);
        strict_1.default.ok(model.warnings?.[0]?.includes("override enabled"));
    });
});
(0, node_test_1.default)("resolveStripeReaderPolicy returns live-read policy when production override is disabled", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
        const policy = (0, stripeReader_1.resolveStripeReaderPolicy)({ stripeMode: "live", allowStubOverride: false });
        strict_1.default.equal(policy.allowed, false);
        strict_1.default.equal(policy.mode, "live_read");
    }
    finally {
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        }
        else {
            process.env.NODE_ENV = originalNodeEnv;
        }
    }
});
