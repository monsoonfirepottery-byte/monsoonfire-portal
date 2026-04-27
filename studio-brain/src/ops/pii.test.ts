import test from "node:test";
import assert from "node:assert/strict";
import { decryptOpsPiiJson, encryptOpsPiiJson, redactMemberAuditPayload } from "./pii";
import type { OpsMemberAuditRecord } from "./contracts";

function withPatchedEnv(patch: Record<string, string | undefined>, run: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    original[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("ops pii helper encrypts and decrypts envelopes with a dedicated key", () => {
  withPatchedEnv(
    {
      STUDIO_BRAIN_OPS_PII_ENCRYPTION_KEY: "ops-pii-test-key",
      STUDIO_BRAIN_ADMIN_TOKEN: undefined,
    },
    () => {
      const envelope = encryptOpsPiiJson({ value: "secret note" });
      assert.ok(envelope);
      const decoded = decryptOpsPiiJson<{ value: string }>(envelope);
      assert.equal(decoded?.value, "secret note");
    },
  );
});

test("ops pii helper redacts member audit payloads before storage", () => {
  const record: OpsMemberAuditRecord = {
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
  const safe = redactMemberAuditPayload(record);
  assert.equal(safe.payload.stripeCustomerId, "cus_...6789");
  assert.equal(safe.payload.defaultPaymentMethodId, "pm_1...6789");
  assert.equal(safe.payload.billingContactEmail, "b***g@example.com");
  assert.equal(safe.payload.billingContactPhone, "***-***-0100");
  assert.match(safe.reason ?? "", /^stored securely \(\d+ chars\)$/);
});
