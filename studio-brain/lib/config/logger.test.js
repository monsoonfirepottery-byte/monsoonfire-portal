"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const logger_1 = require("./logger");
(0, node_test_1.default)("logger redacts common ops pii keys from structured metadata", () => {
    const writes = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk) => {
        writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return true;
    });
    try {
        const logger = (0, logger_1.createLogger)("info");
        logger.info("member update", {
            billingContactEmail: "billing@example.com",
            billingContactPhone: "602-555-0100",
            stripeCustomerId: "cus_123",
            defaultPaymentMethodId: "pm_123",
            staffNotes: "Member prefers pickup texts.",
            safeField: "keep-me",
        });
    }
    finally {
        process.stdout.write = originalWrite;
    }
    strict_1.default.equal(writes.length, 1);
    const payload = JSON.parse(writes[0] ?? "{}");
    strict_1.default.equal(payload.meta?.billingContactEmail, "[redacted]");
    strict_1.default.equal(payload.meta?.billingContactPhone, "[redacted]");
    strict_1.default.equal(payload.meta?.stripeCustomerId, "[redacted]");
    strict_1.default.equal(payload.meta?.defaultPaymentMethodId, "[redacted]");
    strict_1.default.equal(payload.meta?.staffNotes, "[redacted]");
    strict_1.default.equal(payload.meta?.safeField, "keep-me");
});
