"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const pii_1 = require("./pii");
function withPatchedEnv(patch, run) {
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
        run();
    }
    finally {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined)
                delete process.env[key];
            else
                process.env[key] = value;
        }
    }
}
(0, node_test_1.default)("ops pii helper encrypts and decrypts envelopes with a dedicated key", () => {
    withPatchedEnv({
        STUDIO_BRAIN_OPS_PII_ENCRYPTION_KEY: "ops-pii-test-key",
        STUDIO_BRAIN_ADMIN_TOKEN: undefined,
    }, () => {
        const envelope = (0, pii_1.encryptOpsPiiJson)({ value: "secret note" });
        strict_1.default.ok(envelope);
        const decoded = (0, pii_1.decryptOpsPiiJson)(envelope);
        strict_1.default.equal(decoded?.value, "secret note");
    });
});
(0, node_test_1.default)("ops pii helper redacts member audit payloads before storage", () => {
    const record = {
        id: "audit-billing-redact",
        uid: "member-1",
        kind: "billing",
        actorId: "staff-1",
        summary: "Billing updated.",
        reason: "Collected updated billing contact details.",
        createdAt: "2026-04-18T01:00:00.000Z",
        payload: {
            stripeCustomerId: "cus_123456789",
            defaultPaymentMethodId: "pm_123456789",
            cardBrand: "Visa",
            cardLast4: "4242",
            billingContactName: "Monsoon Fire Member",
            billingContactEmail: "billing@example.com",
            billingContactPhone: "602-555-0100",
            storageMode: "encrypted_at_rest",
        },
    };
    const safe = (0, pii_1.redactMemberAuditPayload)(record);
    strict_1.default.equal(safe.payload.stripeCustomerId, "cus_...6789");
    strict_1.default.equal(safe.payload.defaultPaymentMethodId, "pm_1...6789");
    strict_1.default.equal(safe.payload.billingContactEmail, "b***g@example.com");
    strict_1.default.equal(safe.payload.billingContactPhone, "***-***-0100");
    strict_1.default.match(safe.reason ?? "", /^stored securely \(\d+ chars\)$/);
});
