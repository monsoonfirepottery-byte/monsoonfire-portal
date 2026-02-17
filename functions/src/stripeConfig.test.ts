import test from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";

import { constructWebhookEventWithMode, validateStripeConfigForPersist } from "./stripeConfig";

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

test("constructWebhookEventWithMode tries test then live mode", () => {
  const fakeEvent = { id: "evt_123", type: "checkout.session.completed" } as Stripe.Event;
  const called: string[] = [];

  const out = constructWebhookEventWithMode({
    rawBody: Buffer.from("{}"),
    signature: "sig",
    construct: (_raw, _sig, secret) => {
      called.push(secret);
      if (secret === "whsec_test") {
        throw new Error("bad test secret");
      }
      return fakeEvent;
    },
    secretByMode: (mode) => (mode === "test" ? "whsec_test" : "whsec_live"),
  });

  assert.equal(out.mode, "live");
  assert.equal(out.event.id, "evt_123");
  assert.deepEqual(called, ["whsec_test", "whsec_live"]);
});

