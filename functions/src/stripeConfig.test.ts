import test from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";

import {
  classifyStripeWebhookReplayState,
  getStripeWebhookEventContract,
  resolveStripeWebhookMode,
  validateStripeConfigForPersist,
  validateStripeWebhookSecret,
  verifyStripeWebhookEvent,
} from "./stripeConfig";

test("validateStripeConfigForPersist accepts valid config", () => {
  const config = validateStripeConfigForPersist({
    mode: "test",
    publishableKeys: {
      test: "pk_test_123",
      live: "pk_live_123",
    },
    priceIds: {
      membership: "price_abc",
    },
    productIds: {
      membership: "prod_abc",
    },
    enabledFeatures: {
      checkout: true,
      customerPortal: false,
      invoices: false,
    },
    successUrl: "https://portal.monsoonfire.com/billing?checkout=success",
    cancelUrl: "https://portal.monsoonfire.com/billing?checkout=cancel",
  });

  assert.equal(config.mode, "test");
  assert.equal(config.publishableKeys.test, "pk_test_123");
  assert.equal(config.priceIds.membership, "price_abc");
});

test("validateStripeConfigForPersist rejects invalid publishable key prefix", () => {
  assert.throws(
    () =>
      validateStripeConfigForPersist({
        mode: "test",
        publishableKeys: {
          test: "pk_live_wrong",
          live: "pk_live_123",
        },
        priceIds: {},
        productIds: {},
        enabledFeatures: {
          checkout: true,
          customerPortal: false,
          invoices: false,
        },
        successUrl: "https://portal.monsoonfire.com/success",
        cancelUrl: "https://portal.monsoonfire.com/cancel",
      }),
    /pk_test_/i
  );
});

test("resolveStripeWebhookMode prefers explicit env override", () => {
  const out = resolveStripeWebhookMode({
    envModeRaw: "live",
    configModeRaw: "test",
  });

  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.mode, "live");
  assert.equal(out.modeSource, "env_override");
});

test("resolveStripeWebhookMode rejects invalid env override", () => {
  const out = resolveStripeWebhookMode({
    envModeRaw: "staging",
    configModeRaw: "live",
  });

  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.reasonCode, "WEBHOOK_MODE_INVALID");
});

test("validateStripeWebhookSecret rejects placeholders", () => {
  const out = validateStripeWebhookSecret({
    mode: "live",
    secret: "whsec_placeholder_do_not_use",
  });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.reasonCode, "WEBHOOK_SECRET_PLACEHOLDER");
});

test("verifyStripeWebhookEvent validates single selected mode without probing", () => {
  const fakeEvent = {
    id: "evt_123",
    type: "payment_intent.succeeded",
    livemode: true,
    data: { object: {} },
  } as Stripe.Event;
  const called: string[] = [];

  const out = verifyStripeWebhookEvent({
    rawBody: Buffer.from("{}"),
    signature: "sig_live",
    context: {
      mode: "live",
      modeSource: "env_override",
      secretSource: "secret_manager",
      secret: "whsec_live_contract",
    },
    construct: (_raw, _sig, secret) => {
      called.push(secret);
      return fakeEvent;
    },
  });

  assert.equal(out.ok, true);
  assert.deepEqual(called, ["whsec_live_contract"]);
});

test("verifyStripeWebhookEvent rejects invalid signature", () => {
  const out = verifyStripeWebhookEvent({
    rawBody: Buffer.from("{}"),
    signature: "sig_bad",
    context: {
      mode: "test",
      modeSource: "config_doc",
      secretSource: "secret_manager",
      secret: "whsec_test_contract",
    },
    construct: () => {
      throw new Error("No signatures found matching the expected signature for payload");
    },
  });

  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.reasonCode, "WEBHOOK_SIGNATURE_INVALID");
  assert.equal(out.mode, "test");
});

test("verifyStripeWebhookEvent rejects livemode mismatch", () => {
  const out = verifyStripeWebhookEvent({
    rawBody: Buffer.from("{}"),
    signature: "sig_live",
    context: {
      mode: "live",
      modeSource: "config_doc",
      secretSource: "secret_manager",
      secret: "whsec_live_contract",
    },
    construct: () =>
      ({
        id: "evt_456",
        type: "invoice.paid",
        livemode: false,
        data: { object: {} },
      }) as Stripe.Event,
  });

  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.reasonCode, "WEBHOOK_LIVEMODE_MISMATCH");
  assert.equal(out.expectedLivemode, true);
  assert.equal(out.eventLivemode, false);
});

test("classifyStripeWebhookReplayState classifies processed and in-flight duplicates", () => {
  assert.equal(classifyStripeWebhookReplayState(null), "process");
  assert.equal(
    classifyStripeWebhookReplayState({ processingStartedAt: new Date().toISOString() }),
    "duplicate_inflight"
  );
  assert.equal(
    classifyStripeWebhookReplayState({
      processingStartedAt: new Date().toISOString(),
      processedAt: new Date().toISOString(),
    }),
    "duplicate_processed"
  );
  assert.equal(
    classifyStripeWebhookReplayState({
      processingStartedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    }),
    "process"
  );
});

test("getStripeWebhookEventContract exposes strict event mappings", () => {
  const checkout = getStripeWebhookEventContract("checkout.session.completed");
  assert.equal(checkout?.paymentStatus, "checkout_completed");
  assert.equal(checkout?.orderStatus, "payment_pending");

  const invoice = getStripeWebhookEventContract("invoice.paid");
  assert.equal(invoice?.paymentStatus, "invoice_paid");
  assert.equal(invoice?.orderStatus, "paid");

  assert.equal(getStripeWebhookEventContract("charge.refunded"), null);
});
