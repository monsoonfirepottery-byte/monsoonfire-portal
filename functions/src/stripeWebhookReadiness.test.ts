import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";

import { Timestamp } from "./shared";
import {
  STRIPE_PORTAL_WEBHOOK_ENABLED_EVENTS,
  STRIPE_STUDIO_ACCOUNT_ID,
  getStripeWebhookApiVersion,
  evaluateStripeWebhookEndpointReadiness,
} from "./stripeRuntime";
import {
  buildStripeWebhookAttestation,
  STRIPE_WEBHOOK_ATTESTATION_MAX_AGE_MS,
  StripeWebhookAttestationError,
  stripeWebhookEventsHash,
  validateStripeWebhookAttestation,
} from "./stripeWebhookReadiness";

const mode = "test" as const;
const secret = "whsec_real_test_contract_value";
const endpointUrl = "https://us-central1-monsoonfire-portal.cloudfunctions.net/stripePortalWebhook";
const event = {
  id: "evt_attestation",
  type: "invoice.paid",
  livemode: false,
  created: 1_784_160_000,
} as Stripe.Event;

function readyWebhook() {
  return evaluateStripeWebhookEndpointReadiness({
    mode,
    expectedUrl: endpointUrl,
    endpoints: [{
      id: "we_attestation",
      api_version: getStripeWebhookApiVersion(mode),
      enabled_events: [...STRIPE_PORTAL_WEBHOOK_ENABLED_EVENTS],
      livemode: false,
      status: "enabled",
      url: endpointUrl,
    }],
  });
}

function buildRecord(nowMs = Date.parse("2026-07-16T01:00:00.000Z")) {
  return buildStripeWebhookAttestation({
    mode,
    secret,
    signedEvent: event,
    retrievedEvent: { ...event },
    stripeAccountId: STRIPE_STUDIO_ACCOUNT_ID,
    webhook: readyWebhook(),
    endpointUrl,
    now: Timestamp.fromMillis(nowMs),
  });
}

function binding() {
  return {
    mode,
    stripeAccountId: STRIPE_STUDIO_ACCOUNT_ID,
    endpointId: "we_attestation",
    endpointUrl,
    endpointApiVersion: getStripeWebhookApiVersion(mode),
    enabledEventsHash: stripeWebhookEventsHash(),
  };
}

test("signed and API-retrieved Stripe event builds a valid 28-day attestation", () => {
  const nowMs = Date.parse("2026-07-16T01:00:00.000Z");
  const record = buildRecord(nowMs);
  assert.equal(record.proofEventId, event.id);
  assert.equal(record.endpointId, "we_attestation");
  assert.equal(record.expiresAt.toMillis() - record.attestedAt.toMillis(), STRIPE_WEBHOOK_ATTESTATION_MAX_AGE_MS);
  assert.deepEqual(
    validateStripeWebhookAttestation({
      data: record as unknown as Record<string, unknown>,
      binding: binding(),
      secret,
      nowMs: nowMs + 1,
    }),
    { ready: true },
  );
});

test("retrieved event mismatch cannot create an attestation", () => {
  assert.throws(
    () => buildStripeWebhookAttestation({
      mode,
      secret,
      signedEvent: event,
      retrievedEvent: { ...event, type: "invoice.voided" },
      stripeAccountId: STRIPE_STUDIO_ACCOUNT_ID,
      webhook: readyWebhook(),
      endpointUrl,
    }),
    (error: unknown) =>
      error instanceof StripeWebhookAttestationError &&
      error.code === "STRIPE_WEBHOOK_EVENT_BINDING_MISMATCH",
  );
});

test("test delivery cannot attest live mode", () => {
  assert.throws(
    () => buildStripeWebhookAttestation({
      mode: "live",
      secret,
      signedEvent: event,
      retrievedEvent: event,
      stripeAccountId: STRIPE_STUDIO_ACCOUNT_ID,
      webhook: { ...readyWebhook(), ready: true },
      endpointUrl,
    }),
    /cannot attest the active webhook mode/i,
  );
});

test("secret rotation or any endpoint binding change invalidates old proof", () => {
  const nowMs = Date.parse("2026-07-16T01:00:00.000Z");
  const record = buildRecord(nowMs);
  assert.deepEqual(
    validateStripeWebhookAttestation({
      data: record as unknown as Record<string, unknown>,
      binding: binding(),
      secret: "whsec_rotated_test_contract_value",
      nowMs: nowMs + 1,
    }),
    { ready: false, reason: "binding_mismatch" },
  );
  assert.deepEqual(
    validateStripeWebhookAttestation({
      data: record as unknown as Record<string, unknown>,
      binding: { ...binding(), endpointId: "we_replaced" },
      secret,
      nowMs: nowMs + 1,
    }),
    { ready: false, reason: "binding_mismatch" },
  );
});

test("attestation expires exactly at its 28-day boundary", () => {
  const nowMs = Date.parse("2026-07-16T01:00:00.000Z");
  const record = buildRecord(nowMs);
  assert.deepEqual(
    validateStripeWebhookAttestation({
      data: record as unknown as Record<string, unknown>,
      binding: binding(),
      secret,
      nowMs: record.expiresAt.toMillis(),
    }),
    { ready: false, reason: "expired" },
  );
});
