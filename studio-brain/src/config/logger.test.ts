import test from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "./logger";

test("logger redacts common ops pii keys from structured metadata", () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  try {
    const logger = createLogger("info");
    logger.info("member update", {
      billingContactEmail: "billing@example.com",
      billingContactPhone: "602-555-0100",
      stripeCustomerId: "cus_123",
      defaultPaymentMethodId: "pm_123",
      staffNotes: "Member prefers pickup texts.",
      safeField: "keep-me",
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(writes.length, 1);
  const payload = JSON.parse(writes[0] ?? "{}") as { meta?: Record<string, unknown> };
  assert.equal(payload.meta?.billingContactEmail, "[redacted]");
  assert.equal(payload.meta?.billingContactPhone, "[redacted]");
  assert.equal(payload.meta?.stripeCustomerId, "[redacted]");
  assert.equal(payload.meta?.defaultPaymentMethodId, "[redacted]");
  assert.equal(payload.meta?.staffNotes, "[redacted]");
  assert.equal(payload.meta?.safeField, "keep-me");
});
