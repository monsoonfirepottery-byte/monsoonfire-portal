import test from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";

import {
  buildStripePaymentAuditDetails,
  classifyStripeWebhookReplayState,
  deriveOrderLifecycleStatusFromWebhookTransition,
  derivePaymentUpdateFromStripeEvent,
  getStripeWebhookEventContract,
  mergePaymentStatus,
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

  const paymentFailed = getStripeWebhookEventContract("payment_intent.payment_failed");
  assert.equal(paymentFailed?.paymentStatus, "payment_failed");
  assert.equal(paymentFailed?.orderStatus, "payment_failed");

  const invoiceFailed = getStripeWebhookEventContract("invoice.payment_failed");
  assert.equal(invoiceFailed?.paymentStatus, "invoice_payment_failed");
  assert.equal(invoiceFailed?.orderStatus, "payment_failed");

  const dispute = getStripeWebhookEventContract("charge.dispute.created");
  assert.equal(dispute?.paymentStatus, "charge_disputed");
  assert.equal(dispute?.orderStatus, "disputed");

  const disputeClosed = getStripeWebhookEventContract("charge.dispute.closed");
  assert.equal(disputeClosed?.paymentStatus, "charge_disputed");
  assert.equal(disputeClosed?.orderStatus, "disputed");

  const refunded = getStripeWebhookEventContract("charge.refunded");
  assert.equal(refunded?.paymentStatus, "charge_refunded");
  assert.equal(refunded?.orderStatus, "refunded");
});

test("derivePaymentUpdateFromStripeEvent maps payment failure payloads", () => {
  const paymentIntentEvent = {
    id: "evt_pi_failed",
    type: "payment_intent.payment_failed",
    livemode: false,
    data: {
      object: {
        id: "pi_123",
        amount: 2400,
        currency: "usd",
        metadata: {
          uid: "owner-1",
          orderId: "order-1",
          reservationId: "reservation-1",
          checkoutSessionId: "cs_123",
        },
      },
    },
  } as unknown as Stripe.Event;

  const out = derivePaymentUpdateFromStripeEvent(paymentIntentEvent);
  assert.ok(out);
  assert.equal(out?.status, "payment_failed");
  assert.equal(out?.paymentId, "pi_123");
  assert.equal(out?.paymentIntentId, "pi_123");
  assert.equal(out?.orderId, "order-1");
  assert.equal(out?.sourceEventType, "payment_intent.payment_failed");
});

test("derivePaymentUpdateFromStripeEvent maps invoice payment failure payloads", () => {
  const invoiceEvent = {
    id: "evt_invoice_failed",
    type: "invoice.payment_failed",
    livemode: false,
    data: {
      object: {
        id: "in_123",
        amount_due: 3600,
        currency: "usd",
        payment_intent: "pi_123",
        metadata: {
          uid: "owner-1",
          orderId: "order-1",
          reservationId: "reservation-1",
          checkoutSessionId: "cs_123",
        },
      },
    },
  } as unknown as Stripe.Event;

  const out = derivePaymentUpdateFromStripeEvent(invoiceEvent);
  assert.ok(out);
  assert.equal(out?.status, "invoice_payment_failed");
  assert.equal(out?.paymentId, "in_123");
  assert.equal(out?.paymentIntentId, "pi_123");
  assert.equal(out?.invoiceId, "in_123");
  assert.equal(out?.sourceEventType, "invoice.payment_failed");
});

test("derivePaymentUpdateFromStripeEvent maps dispute and refund payloads", () => {
  const disputeEvent = {
    id: "evt_dispute",
    type: "charge.dispute.created",
    livemode: false,
    data: {
      object: {
        id: "dp_123",
        amount: 5000,
        currency: "usd",
        charge: "ch_123",
        payment_intent: "pi_123",
        metadata: {
          uid: "owner-1",
          orderId: "order-1",
        },
      },
    },
  } as unknown as Stripe.Event;

  const refundEvent = {
    id: "evt_refund",
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: "ch_123",
        amount: 5000,
        amount_refunded: 5000,
        currency: "usd",
        payment_intent: "pi_123",
        metadata: {
          uid: "owner-1",
          orderId: "order-1",
          reservationId: "reservation-1",
          checkoutSessionId: "cs_123",
        },
      },
    },
  } as unknown as Stripe.Event;

  const disputeOut = derivePaymentUpdateFromStripeEvent(disputeEvent);
  assert.ok(disputeOut);
  assert.equal(disputeOut?.status, "charge_disputed");
  assert.equal(disputeOut?.paymentIntentId, "pi_123");
  assert.equal(disputeOut?.orderId, "order-1");
  assert.equal(disputeOut?.disputeLifecycle, "opened");
  assert.equal(disputeOut?.disputeStatus, null);

  const disputeClosedEvent = {
    id: "evt_dispute_closed",
    type: "charge.dispute.closed",
    livemode: false,
    data: {
      object: {
        id: "dp_123",
        amount: 5000,
        currency: "usd",
        charge: "ch_123",
        payment_intent: "pi_123",
        status: "won",
        metadata: {
          uid: "owner-1",
          orderId: "order-1",
        },
      },
    },
  } as unknown as Stripe.Event;

  const disputeClosedOut = derivePaymentUpdateFromStripeEvent(disputeClosedEvent);
  assert.ok(disputeClosedOut);
  assert.equal(disputeClosedOut?.status, "charge_disputed");
  assert.equal(disputeClosedOut?.sourceEventType, "charge.dispute.closed");
  assert.equal(disputeClosedOut?.disputeLifecycle, "closed");
  assert.equal(disputeClosedOut?.disputeStatus, "won");

  const refundOut = derivePaymentUpdateFromStripeEvent(refundEvent);
  assert.ok(refundOut);
  assert.equal(refundOut?.status, "charge_refunded");
  assert.equal(refundOut?.paymentId, "ch_123");
  assert.equal(refundOut?.amountTotal, 5000);
  assert.equal(refundOut?.sourceEventType, "charge.refunded");
  assert.equal(refundOut?.disputeLifecycle, null);
  assert.equal(refundOut?.disputeStatus, null);
});

test("mergePaymentStatus is deterministic for out-of-order negative events", () => {
  assert.equal(mergePaymentStatus("invoice_paid", "payment_failed"), "invoice_paid");
  assert.equal(mergePaymentStatus("payment_succeeded", "charge_disputed"), "charge_disputed");
  assert.equal(mergePaymentStatus("charge_disputed", "charge_refunded"), "charge_refunded");
  assert.equal(mergePaymentStatus("charge_refunded", "invoice_paid"), "charge_refunded");
});

test("derivePaymentUpdateFromStripeEvent keeps partial refund amounts deterministic", () => {
  const refundEvent = {
    id: "evt_refund_partial",
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: "ch_partial",
        amount: 5000,
        amount_refunded: 1200,
        currency: "usd",
        payment_intent: "pi_123",
        metadata: {
          uid: "owner-1",
          orderId: "order-1",
        },
      },
    },
  } as unknown as Stripe.Event;

  const out = derivePaymentUpdateFromStripeEvent(refundEvent);
  assert.ok(out);
  assert.equal(out?.status, "charge_refunded");
  assert.equal(out?.amountTotal, 1200);
});

test("deriveOrderLifecycleStatusFromWebhookTransition maps negative outcomes to actionable order status", () => {
  assert.equal(deriveOrderLifecycleStatusFromWebhookTransition("payment_pending"), "payment_pending");
  assert.equal(deriveOrderLifecycleStatusFromWebhookTransition("paid"), "paid");
  assert.equal(deriveOrderLifecycleStatusFromWebhookTransition("payment_failed"), "payment_required");
  assert.equal(deriveOrderLifecycleStatusFromWebhookTransition("disputed"), "exception");
  assert.equal(deriveOrderLifecycleStatusFromWebhookTransition("refunded"), "refunded");
});

test("buildStripePaymentAuditDetails includes dispute lifecycle metadata for triage", () => {
  const out = buildStripePaymentAuditDetails({
    orderId: "order_1",
    paymentStatus: "disputed",
    sourceEventType: "charge.dispute.closed",
    eventId: "evt_1",
    disputeStatus: "won",
    disputeLifecycle: "closed",
  });

  assert.deepEqual(out, {
    orderId: "order_1",
    paymentStatus: "disputed",
    sourceEventType: "charge.dispute.closed",
    eventId: "evt_1",
    disputeStatus: "won",
    disputeLifecycle: "closed",
  });
});
