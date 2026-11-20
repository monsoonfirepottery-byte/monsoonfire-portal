import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";

import { Timestamp, db, safeString } from "./shared";
import { getStripeWebhookSecret, type StripeMode } from "./stripeSecrets";
import {
  evaluateStripeWebhookEndpointReadiness,
  getStripeClient,
  getStripeWebhookApiVersion,
  getWebhookEndpointUrl,
  STRIPE_PORTAL_WEBHOOK_ENABLED_EVENTS,
  STRIPE_STUDIO_ACCOUNT_ID,
  type StripeWebhookEndpointReadiness,
  validateStripeWebhookSecret,
} from "./stripeRuntime";

export const STRIPE_WEBHOOK_ATTESTATIONS_COLLECTION = "stripeWebhookAttestations";
export const STRIPE_WEBHOOK_ATTESTATION_SCHEMA_VERSION = 1;
export const STRIPE_WEBHOOK_ATTESTATION_MAX_AGE_MS = 28 * 24 * 60 * 60 * 1000;

export class StripeWebhookAttestationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 409,
  ) {
    super(message);
    this.name = "StripeWebhookAttestationError";
  }
}

export type StripeWebhookAttestationBinding = {
  mode: StripeMode;
  stripeAccountId: string;
  endpointId: string;
  endpointUrl: string;
  endpointApiVersion: string;
  enabledEventsHash: string;
};

export type StripeWebhookAttestationRecord = StripeWebhookAttestationBinding & {
  schemaVersion: 1;
  status: "verified";
  livemode: boolean;
  bindingHash: string;
  proofEventId: string;
  proofEventType: string;
  proofEventCreated: number;
  signatureVerifiedAt: Timestamp;
  stripeEventRetrievedAt: Timestamp;
  attestedAt: Timestamp;
  expiresAt: Timestamp;
};

export function stripeWebhookEventsHash(): string {
  return createHash("sha256")
    .update(JSON.stringify([...STRIPE_PORTAL_WEBHOOK_ENABLED_EVENTS].sort()))
    .digest("hex");
}

export function stripeWebhookBindingHash(
  binding: StripeWebhookAttestationBinding,
  secret: string,
): string {
  const payload = JSON.stringify({
    schemaVersion: STRIPE_WEBHOOK_ATTESTATION_SCHEMA_VERSION,
    contract: "monsoonfire:stripe-webhook-attestation:v1",
    ...binding,
  });
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === "object" && "toMillis" in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") {
      const out = Number(toMillis.call(value));
      return Number.isFinite(out) ? out : null;
    }
  }
  return null;
}

export function validateStripeWebhookAttestation(params: {
  data: Record<string, unknown> | null | undefined;
  binding: StripeWebhookAttestationBinding;
  secret: string;
  nowMs?: number;
}): { ready: true } | { ready: false; reason: string } {
  const data = params.data ?? {};
  const nowMs = params.nowMs ?? Date.now();
  const expiresAtMs = timestampMillis(data.expiresAt);
  const attestedAtMs = timestampMillis(data.attestedAt);
  const expectedHash = stripeWebhookBindingHash(params.binding, params.secret);
  const actualHash = safeString(data.bindingHash);
  const matches =
    data.schemaVersion === STRIPE_WEBHOOK_ATTESTATION_SCHEMA_VERSION &&
    data.status === "verified" &&
    data.mode === params.binding.mode &&
    data.livemode === (params.binding.mode === "live") &&
    data.stripeAccountId === params.binding.stripeAccountId &&
    data.endpointId === params.binding.endpointId &&
    data.endpointUrl === params.binding.endpointUrl &&
    data.endpointApiVersion === params.binding.endpointApiVersion &&
    data.enabledEventsHash === params.binding.enabledEventsHash &&
    Boolean(actualHash) &&
    secureEqual(actualHash, expectedHash);
  if (!matches) return { ready: false, reason: "binding_mismatch" };
  if (expiresAtMs === null || expiresAtMs <= nowMs) {
    return { ready: false, reason: "expired" };
  }
  if (
    attestedAtMs === null ||
    attestedAtMs > nowMs + 5 * 60 * 1000 ||
    expiresAtMs - attestedAtMs > STRIPE_WEBHOOK_ATTESTATION_MAX_AGE_MS
  ) {
    return { ready: false, reason: "invalid_lifetime" };
  }
  if (!safeString(data.proofEventId) || !safeString(data.proofEventType)) {
    return { ready: false, reason: "missing_proof_event" };
  }
  return { ready: true };
}

export function buildStripeWebhookAttestation(params: {
  mode: StripeMode;
  secret: string;
  signedEvent: Pick<Stripe.Event, "id" | "type" | "livemode" | "created">;
  retrievedEvent: Pick<Stripe.Event, "id" | "type" | "livemode" | "created">;
  stripeAccountId: string;
  webhook: StripeWebhookEndpointReadiness;
  endpointUrl: string;
  now?: Timestamp;
}): StripeWebhookAttestationRecord {
  const signed = params.signedEvent;
  const retrieved = params.retrievedEvent;
  if (
    signed.id !== retrieved.id ||
    signed.type !== retrieved.type ||
    signed.livemode !== retrieved.livemode ||
    signed.created !== retrieved.created
  ) {
    throw new StripeWebhookAttestationError(
      "STRIPE_WEBHOOK_EVENT_BINDING_MISMATCH",
      "The signed webhook event did not match the event retrieved from Stripe.",
      503,
    );
  }
  if (
    signed.livemode !== (params.mode === "live") ||
    !STRIPE_PORTAL_WEBHOOK_ENABLED_EVENTS.includes(signed.type)
  ) {
    throw new StripeWebhookAttestationError(
      "STRIPE_WEBHOOK_EVENT_NOT_ELIGIBLE",
      "This Stripe event cannot attest the active webhook mode and contract.",
    );
  }
  if (params.stripeAccountId !== STRIPE_STUDIO_ACCOUNT_ID) {
    throw new StripeWebhookAttestationError(
      "STRIPE_ACCOUNT_MISMATCH",
      "The active Stripe key is not connected to the Monsoon Fire studio account.",
    );
  }
  if (!params.webhook.ready || !params.webhook.endpointId) {
    throw new StripeWebhookAttestationError(
      "STRIPE_WEBHOOK_ENDPOINT_NOT_READY",
      "The Stripe webhook destination does not match the required contract.",
    );
  }

  const now = params.now ?? Timestamp.now();
  const binding: StripeWebhookAttestationBinding = {
    mode: params.mode,
    stripeAccountId: params.stripeAccountId,
    endpointId: params.webhook.endpointId,
    endpointUrl: params.endpointUrl,
    endpointApiVersion: getStripeWebhookApiVersion(params.mode),
    enabledEventsHash: stripeWebhookEventsHash(),
  };
  return {
    schemaVersion: STRIPE_WEBHOOK_ATTESTATION_SCHEMA_VERSION,
    status: "verified",
    livemode: params.mode === "live",
    ...binding,
    bindingHash: stripeWebhookBindingHash(binding, params.secret),
    proofEventId: signed.id,
    proofEventType: signed.type,
    proofEventCreated: signed.created,
    signatureVerifiedAt: now,
    stripeEventRetrievedAt: now,
    attestedAt: now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + STRIPE_WEBHOOK_ATTESTATION_MAX_AGE_MS),
  };
}

export async function attestStripeWebhookDelivery(params: {
  mode: StripeMode;
  secret: string;
  event: Stripe.Event;
}): Promise<StripeWebhookAttestationRecord> {
  const stripe = getStripeClient(params.mode);
  const endpointUrl = getWebhookEndpointUrl();
  const [retrievedEvent, endpoints] = await Promise.all([
    stripe.events.retrieve(params.event.id),
    stripe.webhookEndpoints.list({ limit: 100 }),
  ]);
  const webhook = evaluateStripeWebhookEndpointReadiness({
    endpoints: endpoints.data,
    expectedUrl: endpointUrl,
    mode: params.mode,
  });
  const record = buildStripeWebhookAttestation({
    mode: params.mode,
    secret: params.secret,
    signedEvent: params.event,
    retrievedEvent,
    stripeAccountId: STRIPE_STUDIO_ACCOUNT_ID,
    webhook,
    endpointUrl,
  });
  await db.collection(STRIPE_WEBHOOK_ATTESTATIONS_COLLECTION).doc(params.mode).set(record);
  return record;
}

export async function requireCurrentStripeWebhookAttestation(params: {
  mode: StripeMode;
  secret: string;
  stripeAccountId: string;
  webhook: StripeWebhookEndpointReadiness;
  endpointUrl: string;
}): Promise<string> {
  if (!params.webhook.ready || !params.webhook.endpointId) {
    throw new StripeWebhookAttestationError(
      "STRIPE_WEBHOOK_ENDPOINT_NOT_READY",
      "The Stripe webhook destination does not match the required contract.",
    );
  }
  const binding: StripeWebhookAttestationBinding = {
    mode: params.mode,
    stripeAccountId: params.stripeAccountId,
    endpointId: params.webhook.endpointId,
    endpointUrl: params.endpointUrl,
    endpointApiVersion: getStripeWebhookApiVersion(params.mode),
    enabledEventsHash: stripeWebhookEventsHash(),
  };
  const snap = await db
    .collection(STRIPE_WEBHOOK_ATTESTATIONS_COLLECTION)
    .doc(params.mode)
    .get();
  const result = validateStripeWebhookAttestation({
    data: snap.exists ? (snap.data() as Record<string, unknown>) : null,
    binding,
    secret: params.secret,
  });
  if (!result.ready) {
    throw new StripeWebhookAttestationError(
      "STRIPE_WEBHOOK_ATTESTATION_REQUIRED",
      "A current signed Stripe webhook proof is required before billing writes.",
    );
  }
  return params.webhook.endpointId;
}

export async function requireActiveStripeWebhookWriteReadiness(
  mode: StripeMode,
): Promise<{
  stripeAccountId: string;
  endpointId: string;
  endpointUrl: string;
}> {
  let secret = "";
  try {
    secret = getStripeWebhookSecret(mode);
  } catch {
    throw new StripeWebhookAttestationError(
      "STRIPE_WEBHOOK_SECRET_UNAVAILABLE",
      `The ${mode} Stripe webhook signing secret is unavailable.`,
    );
  }
  const secretValidation = validateStripeWebhookSecret({ mode, secret });
  if (!secretValidation.ok) {
    throw new StripeWebhookAttestationError(
      secretValidation.reasonCode,
      secretValidation.message,
    );
  }

  const stripe = getStripeClient(mode);
  let endpoints: Stripe.ApiList<Stripe.WebhookEndpoint>;
  try {
    endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  } catch {
    throw new StripeWebhookAttestationError(
      "STRIPE_WEBHOOK_VALIDATION_FAILED",
      "Stripe webhook readiness could not be verified. No billing write was attempted.",
      503,
    );
  }
  const endpointUrl = getWebhookEndpointUrl();
  const webhook = evaluateStripeWebhookEndpointReadiness({
    endpoints: endpoints.data,
    expectedUrl: endpointUrl,
    mode,
  });
  const endpointId = await requireCurrentStripeWebhookAttestation({
    mode,
    secret: secretValidation.normalizedSecret,
    stripeAccountId: STRIPE_STUDIO_ACCOUNT_ID,
    webhook,
    endpointUrl,
  });
  return {
    stripeAccountId: STRIPE_STUDIO_ACCOUNT_ID,
    endpointId,
    endpointUrl,
  };
}
