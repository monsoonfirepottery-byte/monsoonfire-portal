/* eslint-disable @typescript-eslint/no-explicit-any */
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import { z } from "zod";

import {
  FieldValue,
  Timestamp,
  asInt,
  db,
  enforceRateLimit,
  isStaffFromDecoded,
  makeIdempotencyId,
  nowTs,
  parseBody,
  requireAuthContext,
  requireAuthUid,
  safeString,
} from "./shared";
import { assertActorAuthorized, logAuditEvent } from "./authz";
import {
  STRIPE_SECRET_PARAMS,
  type StripeMode,
  getStripeSecretKey,
  getStripeWebhookSecret,
} from "./stripeSecrets";
import { getAgentOpsConfig } from "./agentCommerce";

const REGION = "us-central1";
const CONFIG_DOC_PATH = "config/stripe";
const AUDIT_SUBCOLLECTION = "stripe_audit";

const stripeConfigSchema = z.object({
  mode: z.enum(["test", "live"]).default("test"),
  publishableKeys: z.object({
    test: z.string().trim().default(""),
    live: z.string().trim().default(""),
  }).default({ test: "", live: "" }),
  priceIds: z.record(z.string(), z.string().trim()).default({}),
  productIds: z.record(z.string(), z.string().trim()).default({}),
  enabledFeatures: z.object({
    checkout: z.boolean().default(true),
    customerPortal: z.boolean().default(false),
    invoices: z.boolean().default(false),
  }).default({ checkout: true, customerPortal: false, invoices: false }),
  successUrl: z.string().trim().default(""),
  cancelUrl: z.string().trim().default(""),
});

const checkoutSchema = z.object({
  priceId: z.string().trim().optional(),
  priceKey: z.string().trim().optional(),
  quantity: z.number().int().min(1).max(50).optional(),
});

const agentCheckoutSchema = z.object({
  orderId: z.string().trim().min(1),
});

type StripeConfigInput = z.infer<typeof stripeConfigSchema>;

type StripeAuditRow = {
  id: string;
  changedPaths: string[];
  summary: string;
  updatedAt: string;
  updatedByUid: string;
  updatedByEmail: string | null;
};

type StripeConfigResponse = {
  mode: StripeMode;
  publishableKeys: { test: string; live: string };
  activePublishableKey: string;
  priceIds: Record<string, string>;
  productIds: Record<string, string>;
  enabledFeatures: { checkout: boolean; customerPortal: boolean; invoices: boolean };
  successUrl: string;
  cancelUrl: string;
  updatedAt: string | null;
  updatedByUid: string | null;
  updatedByEmail: string | null;
};

type PaymentStatus =
  | "checkout_created"
  | "checkout_completed"
  | "payment_succeeded"
  | "invoice_paid"
  | "payment_failed"
  | "invoice_payment_failed"
  | "charge_disputed"
  | "charge_refunded";

type PaymentUpdate = {
  paymentId: string;
  status: PaymentStatus;
  uid: string | null;
  sessionId: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  orderId: string | null;
  reservationId: string | null;
  amountTotal: number | null;
  currency: string | null;
  sourceEventType: string;
  disputeStatus: string | null;
  disputeLifecycle: "opened" | "closed" | null;
};

type StripeWebhookModeSource = "env_override" | "config_doc" | "default_test";
type StripeWebhookSecretSource = "secret_manager";
type StripeWebhookReplayState = "process" | "duplicate_processed" | "duplicate_inflight";
type SupportedStripeWebhookEventType =
  | "checkout.session.completed"
  | "payment_intent.succeeded"
  | "invoice.paid"
  | "payment_intent.payment_failed"
  | "invoice.payment_failed"
  | "charge.dispute.created"
  | "charge.dispute.closed"
  | "charge.refunded";

type StripeWebhookEventContract = {
  paymentStatus: PaymentStatus;
  orderStatus: "payment_pending" | "paid" | "payment_failed" | "disputed" | "refunded";
  fulfillmentStatus: "queued" | "scheduled" | "on_hold";
  requestStatus: "accepted" | "in_progress" | "ready";
};

type StripeWebhookModeResolution =
  | {
    ok: true;
    mode: StripeMode;
    modeSource: StripeWebhookModeSource;
    envModeRaw: string;
    configModeRaw: string;
  }
  | {
    ok: false;
    code: 500;
    reasonCode: "WEBHOOK_MODE_INVALID";
    message: string;
    envModeRaw: string;
  };

type StripeWebhookSecretValidation =
  | { ok: true; normalizedSecret: string }
  | {
    ok: false;
    code: 500;
    reasonCode:
      | "WEBHOOK_SECRET_MISSING"
      | "WEBHOOK_SECRET_FORMAT_INVALID"
      | "WEBHOOK_SECRET_PLACEHOLDER";
    message: string;
  };

type StripeWebhookVerifyContext = {
  mode: StripeMode;
  modeSource: StripeWebhookModeSource;
  secretSource: StripeWebhookSecretSource;
  secret: string;
};

type StripeWebhookVerifyResult =
  | {
    ok: true;
    event: Stripe.Event;
    mode: StripeMode;
    modeSource: StripeWebhookModeSource;
    secretSource: StripeWebhookSecretSource;
  }
  | {
    ok: false;
    code: number;
    reasonCode:
      | "WEBHOOK_SIGNATURE_INVALID"
      | "WEBHOOK_LIVEMODE_MISMATCH";
    message: string;
    mode: StripeMode;
    modeSource: StripeWebhookModeSource;
    secretSource: StripeWebhookSecretSource;
    eventLivemode: boolean | null;
    expectedLivemode: boolean;
  };

type StripeWebhookContextResult =
  | { ok: true; context: StripeWebhookVerifyContext }
  | {
    ok: false;
    code: number;
    reasonCode:
      | "WEBHOOK_MODE_INVALID"
      | "WEBHOOK_SECRET_MISSING"
      | "WEBHOOK_SECRET_FORMAT_INVALID"
      | "WEBHOOK_SECRET_PLACEHOLDER"
      | "WEBHOOK_SECRET_UNAVAILABLE";
    message: string;
    mode: StripeMode | null;
    modeSource: StripeWebhookModeSource | null;
    secretSource: StripeWebhookSecretSource | null;
    envModeRaw: string;
    configModeRaw: string;
  };

const STRIPE_WEBHOOK_MODE_ENV = "STRIPE_WEBHOOK_MODE";
const PLACEHOLDER_SECRET_MARKERS = ["placeholder", "changeme", "replace", "example", "todo"];
const WEBHOOK_PROCESSING_LOCK_TTL_MS = 15 * 60 * 1000;

const STRIPE_WEBHOOK_EVENT_CONTRACTS: Record<
SupportedStripeWebhookEventType,
StripeWebhookEventContract
> = {
  "checkout.session.completed": {
    paymentStatus: "checkout_completed",
    orderStatus: "payment_pending",
    fulfillmentStatus: "queued",
    requestStatus: "accepted",
  },
  "payment_intent.succeeded": {
    paymentStatus: "payment_succeeded",
    orderStatus: "paid",
    fulfillmentStatus: "scheduled",
    requestStatus: "in_progress",
  },
  "invoice.paid": {
    paymentStatus: "invoice_paid",
    orderStatus: "paid",
    fulfillmentStatus: "scheduled",
    requestStatus: "in_progress",
  },
  "payment_intent.payment_failed": {
    paymentStatus: "payment_failed",
    orderStatus: "payment_failed",
    fulfillmentStatus: "queued",
    requestStatus: "accepted",
  },
  "invoice.payment_failed": {
    paymentStatus: "invoice_payment_failed",
    orderStatus: "payment_failed",
    fulfillmentStatus: "queued",
    requestStatus: "accepted",
  },
  "charge.dispute.created": {
    paymentStatus: "charge_disputed",
    orderStatus: "disputed",
    fulfillmentStatus: "on_hold",
    requestStatus: "in_progress",
  },
  "charge.dispute.closed": {
    paymentStatus: "charge_disputed",
    orderStatus: "disputed",
    fulfillmentStatus: "on_hold",
    requestStatus: "in_progress",
  },
  "charge.refunded": {
    paymentStatus: "charge_refunded",
    orderStatus: "refunded",
    fulfillmentStatus: "queued",
    requestStatus: "accepted",
  },
};

const STRIPE_CLIENTS: Partial<Record<StripeMode, Stripe>> = {};

function getStripeClient(mode: StripeMode): Stripe {
  const cached = STRIPE_CLIENTS[mode];
  if (cached) return cached;
  const client = new Stripe(getStripeSecretKey(mode));
  STRIPE_CLIENTS[mode] = client;
  return client;
}

function parseStringMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const k = key.trim();
    const v = safeString(value).trim();
    if (!k || !v) continue;
    out[k] = v;
  }
  return out;
}

function maybeIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof (value as { toDate?: () => Date }).toDate === "function") {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function getWebhookEndpointUrl(): string {
  const configured = safeString(process.env.STRIPE_WEBHOOK_PUBLIC_URL).trim();
  if (configured) return configured;
  const projectId = safeString(process.env.GCLOUD_PROJECT).trim();
  if (!projectId) return `/${REGION}/stripePortalWebhook`;
  return `https://${REGION}-${projectId}.cloudfunctions.net/stripePortalWebhook`;
}

function normalizeStripeConfig(data: Record<string, unknown> | null | undefined): StripeConfigInput {
  return stripeConfigSchema.parse({
    mode: safeString(data?.mode, "test"),
    publishableKeys: {
      test: safeString((data?.publishableKeys as Record<string, unknown> | undefined)?.test),
      live: safeString((data?.publishableKeys as Record<string, unknown> | undefined)?.live),
    },
    priceIds: parseStringMap(data?.priceIds),
    productIds: parseStringMap(data?.productIds),
    enabledFeatures: {
      checkout: (data?.enabledFeatures as Record<string, unknown> | undefined)?.checkout === true,
      customerPortal: (data?.enabledFeatures as Record<string, unknown> | undefined)?.customerPortal === true,
      invoices: (data?.enabledFeatures as Record<string, unknown> | undefined)?.invoices === true,
    },
    successUrl: safeString(data?.successUrl),
    cancelUrl: safeString(data?.cancelUrl),
  });
}

function validatePublishableKeys(config: StripeConfigInput) {
  if (config.publishableKeys.test && !config.publishableKeys.test.startsWith("pk_test_")) {
    throw new Error("publishableKeys.test must start with pk_test_");
  }
  if (config.publishableKeys.live && !config.publishableKeys.live.startsWith("pk_live_")) {
    throw new Error("publishableKeys.live must start with pk_live_");
  }
}

function validateUrlField(label: string, value: string) {
  if (!value) throw new Error(`${label} is required`);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
}

export function validateStripeConfigForPersist(input: unknown): StripeConfigInput {
  const parsed = stripeConfigSchema.parse(input);
  validatePublishableKeys(parsed);
  validateUrlField("successUrl", parsed.successUrl);
  validateUrlField("cancelUrl", parsed.cancelUrl);
  return parsed;
}

function toPublicConfigResponse(raw: Record<string, unknown>): StripeConfigResponse {
  const cfg = normalizeStripeConfig(raw);
  const mode: StripeMode = cfg.mode;
  return {
    mode,
    publishableKeys: cfg.publishableKeys,
    activePublishableKey: mode === "live" ? cfg.publishableKeys.live : cfg.publishableKeys.test,
    priceIds: cfg.priceIds,
    productIds: cfg.productIds,
    enabledFeatures: cfg.enabledFeatures,
    successUrl: cfg.successUrl,
    cancelUrl: cfg.cancelUrl,
    updatedAt: maybeIso(raw.updatedAt),
    updatedByUid: safeString(raw.updatedByUid) || null,
    updatedByEmail: safeString(raw.updatedByEmail) || null,
  };
}

function summarizeConfigChanges(before: StripeConfigInput, after: StripeConfigInput): { changedPaths: string[]; summary: string } {
  const changed: string[] = [];
  if (before.mode !== after.mode) changed.push("mode");
  if (JSON.stringify(before.publishableKeys) !== JSON.stringify(after.publishableKeys)) changed.push("publishableKeys");
  if (JSON.stringify(before.priceIds) !== JSON.stringify(after.priceIds)) changed.push("priceIds");
  if (JSON.stringify(before.productIds) !== JSON.stringify(after.productIds)) changed.push("productIds");
  if (JSON.stringify(before.enabledFeatures) !== JSON.stringify(after.enabledFeatures)) changed.push("enabledFeatures");
  if (before.successUrl !== after.successUrl) changed.push("successUrl");
  if (before.cancelUrl !== after.cancelUrl) changed.push("cancelUrl");
  return {
    changedPaths: changed,
    summary: changed.length ? `Updated: ${changed.join(", ")}` : "No config change",
  };
}

async function requireStaffUid(req: any): Promise<{ ok: true; uid: string; email: string | null } | { ok: false; code: number; message: string }> {
  const auth = await requireAuthUid(req);
  if (!auth.ok) return { ok: false, code: 401, message: auth.message };
  const isStaff = auth.decoded.staff === true || (Array.isArray((auth.decoded as any).roles) && (auth.decoded as any).roles.includes("staff"));
  if (!isStaff) return { ok: false, code: 403, message: "Staff access required" };
  return { ok: true, uid: auth.uid, email: safeString(auth.decoded.email) || null };
}

async function readStripeAudit(limitRows: number): Promise<StripeAuditRow[]> {
  const snap = await db
    .doc(CONFIG_DOC_PATH)
    .collection(AUDIT_SUBCOLLECTION)
    .orderBy("updatedAt", "desc")
    .limit(limitRows)
    .get();
  return snap.docs.map((row) => {
    const data = row.data() as Record<string, unknown>;
    const changedPaths = Array.isArray(data.changedPaths)
      ? data.changedPaths.map((entry) => safeString(entry)).filter(Boolean)
      : [];
    return {
      id: row.id,
      changedPaths,
      summary: safeString(data.summary, changedPaths.length ? changedPaths.join(", ") : "Update"),
      updatedAt: maybeIso(data.updatedAt) ?? "",
      updatedByUid: safeString(data.updatedByUid),
      updatedByEmail: safeString(data.updatedByEmail) || null,
    };
  });
}

function paymentStatusRank(status: PaymentStatus): number {
  if (status === "charge_refunded") return 80;
  if (status === "charge_disputed") return 70;
  if (status === "invoice_paid") return 60;
  if (status === "payment_succeeded") return 50;
  if (status === "checkout_completed") return 40;
  if (status === "invoice_payment_failed") return 30;
  if (status === "payment_failed") return 20;
  return 10;
}

export function mergePaymentStatus(current: string | null | undefined, next: PaymentStatus): PaymentStatus {
  if (!current) return next;
  const currentStatus = current as PaymentStatus;
  if (paymentStatusRank(next) > paymentStatusRank(currentStatus)) return next;
  return currentStatus;
}

export function deriveOrderLifecycleStatusFromWebhookTransition(
  orderStatus: StripeWebhookEventContract["orderStatus"]
): "payment_pending" | "paid" | "payment_required" | "exception" | "refunded" {
  if (orderStatus === "paid") return "paid";
  if (orderStatus === "payment_failed") return "payment_required";
  if (orderStatus === "disputed") return "exception";
  if (orderStatus === "refunded") return "refunded";
  return "payment_pending";
}

export function buildStripePaymentAuditDetails(params: {
  orderId: string;
  paymentStatus: StripeWebhookEventContract["orderStatus"];
  sourceEventType: string;
  eventId: string;
  disputeStatus: string | null;
  disputeLifecycle: "opened" | "closed" | null;
}): {
  orderId: string;
  paymentStatus: StripeWebhookEventContract["orderStatus"];
  sourceEventType: string;
  eventId: string;
  disputeStatus: string | null;
  disputeLifecycle: "opened" | "closed" | null;
} {
  return {
    orderId: safeString(params.orderId),
    paymentStatus: params.paymentStatus,
    sourceEventType: safeString(params.sourceEventType),
    eventId: safeString(params.eventId),
    disputeStatus: safeString(params.disputeStatus) || null,
    disputeLifecycle:
      params.disputeLifecycle === "opened" || params.disputeLifecycle === "closed"
        ? params.disputeLifecycle
        : null,
  };
}

function parseCheckoutSessionPayload(session: Stripe.Checkout.Session): PaymentUpdate {
  const amountTotal = typeof session.amount_total === "number" ? session.amount_total : null;
  const currency = typeof session.currency === "string" ? session.currency : null;
  const sessionId = typeof session.id === "string" ? session.id : null;
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
  const uid = safeString(session.metadata?.uid) || safeString(session.client_reference_id) || null;
  const orderId =
    safeString(session.metadata?.orderId) ||
    safeString(session.metadata?.agentOrderId) ||
    null;
  const reservationId =
    safeString(session.metadata?.reservationId) ||
    safeString(session.metadata?.agentReservationId) ||
    null;
  return {
    paymentId: sessionId || paymentIntentId || `checkout_${Date.now()}`,
    status: "checkout_completed",
    uid,
    sessionId,
    paymentIntentId,
    invoiceId: null,
    orderId,
    reservationId,
    amountTotal,
    currency,
    sourceEventType: "checkout.session.completed",
    disputeStatus: null,
    disputeLifecycle: null,
  };
}

function parsePaymentIntentPayload(intent: Stripe.PaymentIntent): PaymentUpdate {
  const amountTotal = typeof intent.amount_received === "number" ? intent.amount_received : null;
  const currency = typeof intent.currency === "string" ? intent.currency : null;
  const uid = safeString(intent.metadata?.uid) || null;
  const orderId =
    safeString(intent.metadata?.orderId) ||
    safeString(intent.metadata?.agentOrderId) ||
    null;
  const reservationId =
    safeString(intent.metadata?.reservationId) ||
    safeString(intent.metadata?.agentReservationId) ||
    null;
  return {
    paymentId: intent.id,
    status: "payment_succeeded",
    uid,
    sessionId: safeString(intent.metadata?.checkoutSessionId) || null,
    paymentIntentId: intent.id,
    invoiceId: null,
    orderId,
    reservationId,
    amountTotal,
    currency,
    sourceEventType: "payment_intent.succeeded",
    disputeStatus: null,
    disputeLifecycle: null,
  };
}

function parseInvoicePayload(invoice: Stripe.Invoice): PaymentUpdate {
  const amountTotal = typeof invoice.amount_paid === "number" ? invoice.amount_paid : null;
  const currency = typeof invoice.currency === "string" ? invoice.currency : null;
  const uid = safeString(invoice.metadata?.uid) || null;
  const orderId =
    safeString(invoice.metadata?.orderId) ||
    safeString(invoice.metadata?.agentOrderId) ||
    null;
  const reservationId =
    safeString(invoice.metadata?.reservationId) ||
    safeString(invoice.metadata?.agentReservationId) ||
    null;
  return {
    paymentId: invoice.id,
    status: "invoice_paid",
    uid,
    sessionId: safeString(invoice.metadata?.checkoutSessionId) || null,
    paymentIntentId:
      typeof (invoice as unknown as { payment_intent?: unknown }).payment_intent === "string"
        ? ((invoice as unknown as { payment_intent: string }).payment_intent)
        : null,
    invoiceId: invoice.id,
    orderId,
    reservationId,
    amountTotal,
    currency,
    sourceEventType: "invoice.paid",
    disputeStatus: null,
    disputeLifecycle: null,
  };
}

function parsePaymentIntentFailedPayload(intent: Stripe.PaymentIntent): PaymentUpdate {
  const amountTotal = typeof intent.amount === "number" ? intent.amount : null;
  const currency = typeof intent.currency === "string" ? intent.currency : null;
  const uid = safeString(intent.metadata?.uid) || null;
  const orderId =
    safeString(intent.metadata?.orderId) ||
    safeString(intent.metadata?.agentOrderId) ||
    null;
  const reservationId =
    safeString(intent.metadata?.reservationId) ||
    safeString(intent.metadata?.agentReservationId) ||
    null;
  return {
    paymentId: intent.id,
    status: "payment_failed",
    uid,
    sessionId: safeString(intent.metadata?.checkoutSessionId) || null,
    paymentIntentId: intent.id,
    invoiceId: null,
    orderId,
    reservationId,
    amountTotal,
    currency,
    sourceEventType: "payment_intent.payment_failed",
    disputeStatus: null,
    disputeLifecycle: null,
  };
}

function parseInvoiceFailedPayload(invoice: Stripe.Invoice): PaymentUpdate {
  const amountTotal = typeof invoice.amount_due === "number" ? invoice.amount_due : null;
  const currency = typeof invoice.currency === "string" ? invoice.currency : null;
  const uid = safeString(invoice.metadata?.uid) || null;
  const orderId =
    safeString(invoice.metadata?.orderId) ||
    safeString(invoice.metadata?.agentOrderId) ||
    null;
  const reservationId =
    safeString(invoice.metadata?.reservationId) ||
    safeString(invoice.metadata?.agentReservationId) ||
    null;
  return {
    paymentId: invoice.id,
    status: "invoice_payment_failed",
    uid,
    sessionId: safeString(invoice.metadata?.checkoutSessionId) || null,
    paymentIntentId:
      typeof (invoice as unknown as { payment_intent?: unknown }).payment_intent === "string"
        ? ((invoice as unknown as { payment_intent: string }).payment_intent)
        : null,
    invoiceId: invoice.id,
    orderId,
    reservationId,
    amountTotal,
    currency,
    sourceEventType: "invoice.payment_failed",
    disputeStatus: null,
    disputeLifecycle: null,
  };
}

function parseChargeRefundedPayload(charge: Stripe.Charge): PaymentUpdate {
  const amountTotal =
    typeof charge.amount_refunded === "number"
      ? charge.amount_refunded
      : typeof charge.amount === "number"
        ? charge.amount
        : null;
  const currency = typeof charge.currency === "string" ? charge.currency : null;
  const uid = safeString(charge.metadata?.uid) || null;
  const orderId =
    safeString(charge.metadata?.orderId) ||
    safeString(charge.metadata?.agentOrderId) ||
    null;
  const reservationId =
    safeString(charge.metadata?.reservationId) ||
    safeString(charge.metadata?.agentReservationId) ||
    null;
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : typeof charge.payment_intent === "object" && charge.payment_intent && typeof charge.payment_intent.id === "string"
        ? charge.payment_intent.id
        : null;
  return {
    paymentId: charge.id,
    status: "charge_refunded",
    uid,
    sessionId: safeString(charge.metadata?.checkoutSessionId) || null,
    paymentIntentId,
    invoiceId: null,
    orderId,
    reservationId,
    amountTotal,
    currency,
    sourceEventType: "charge.refunded",
    disputeStatus: null,
    disputeLifecycle: null,
  };
}

function parseChargeDisputePayload(
  dispute: Stripe.Dispute,
  sourceEventType: "charge.dispute.created" | "charge.dispute.closed"
): PaymentUpdate {
  const amountTotal = typeof dispute.amount === "number" ? dispute.amount : null;
  const currency = typeof dispute.currency === "string" ? dispute.currency : null;
  const uid = safeString(dispute.metadata?.uid) || null;
  const orderId =
    safeString(dispute.metadata?.orderId) ||
    safeString(dispute.metadata?.agentOrderId) ||
    null;
  const reservationId =
    safeString(dispute.metadata?.reservationId) ||
    safeString(dispute.metadata?.agentReservationId) ||
    null;
  const paymentIntentId =
    typeof (dispute as unknown as { payment_intent?: unknown }).payment_intent === "string"
      ? ((dispute as unknown as { payment_intent: string }).payment_intent)
      : null;
  const disputeStatus = safeString((dispute as unknown as { status?: unknown }).status) || null;
  const disputeLifecycle = sourceEventType === "charge.dispute.closed" ? "closed" : "opened";
  return {
    paymentId: dispute.id || safeString(dispute.charge) || `dispute_${Date.now()}`,
    status: "charge_disputed",
    uid,
    sessionId: safeString(dispute.metadata?.checkoutSessionId) || null,
    paymentIntentId,
    invoiceId: null,
    orderId,
    reservationId,
    amountTotal,
    currency,
    sourceEventType,
    disputeStatus,
    disputeLifecycle,
  };
}

export function getStripeWebhookEventContract(eventType: string): StripeWebhookEventContract | null {
  if (eventType === "checkout.session.completed") {
    return STRIPE_WEBHOOK_EVENT_CONTRACTS["checkout.session.completed"];
  }
  if (eventType === "payment_intent.succeeded") {
    return STRIPE_WEBHOOK_EVENT_CONTRACTS["payment_intent.succeeded"];
  }
  if (eventType === "invoice.paid") {
    return STRIPE_WEBHOOK_EVENT_CONTRACTS["invoice.paid"];
  }
  if (eventType === "payment_intent.payment_failed") {
    return STRIPE_WEBHOOK_EVENT_CONTRACTS["payment_intent.payment_failed"];
  }
  if (eventType === "invoice.payment_failed") {
    return STRIPE_WEBHOOK_EVENT_CONTRACTS["invoice.payment_failed"];
  }
  if (eventType === "charge.dispute.created") {
    return STRIPE_WEBHOOK_EVENT_CONTRACTS["charge.dispute.created"];
  }
  if (eventType === "charge.dispute.closed") {
    return STRIPE_WEBHOOK_EVENT_CONTRACTS["charge.dispute.closed"];
  }
  if (eventType === "charge.refunded") {
    return STRIPE_WEBHOOK_EVENT_CONTRACTS["charge.refunded"];
  }
  return null;
}

export function derivePaymentUpdateFromStripeEvent(event: Stripe.Event): PaymentUpdate | null {
  const contract = getStripeWebhookEventContract(event.type);
  if (!contract) return null;
  let update: PaymentUpdate;
  if (event.type === "checkout.session.completed") {
    update = parseCheckoutSessionPayload(event.data.object as Stripe.Checkout.Session);
  } else if (event.type === "payment_intent.succeeded") {
    update = parsePaymentIntentPayload(event.data.object as Stripe.PaymentIntent);
  } else if (event.type === "payment_intent.payment_failed") {
    update = parsePaymentIntentFailedPayload(event.data.object as Stripe.PaymentIntent);
  } else if (event.type === "invoice.payment_failed") {
    update = parseInvoiceFailedPayload(event.data.object as Stripe.Invoice);
  } else if (event.type === "charge.dispute.created") {
    update = parseChargeDisputePayload(
      event.data.object as Stripe.Dispute,
      "charge.dispute.created"
    );
  } else if (event.type === "charge.dispute.closed") {
    update = parseChargeDisputePayload(
      event.data.object as Stripe.Dispute,
      "charge.dispute.closed"
    );
  } else if (event.type === "charge.refunded") {
    update = parseChargeRefundedPayload(event.data.object as Stripe.Charge);
  } else {
    update = parseInvoicePayload(event.data.object as Stripe.Invoice);
  }
  if (update.status !== contract.paymentStatus) {
    throw new Error(
      `Stripe event contract mismatch (${event.type} expected ${contract.paymentStatus} got ${update.status})`
    );
  }
  return update;
}

function requirePayScopeForContext(
  ctx: { mode: "firebase" | "pat" | "delegated"; scopes: string[] | null }
): { ok: true } | { ok: false; message: string } {
  if (ctx.mode === "firebase") return { ok: true };
  const scopes = ctx.scopes ?? [];
  return scopes.includes("pay:write")
    ? { ok: true }
    : { ok: false, message: "Missing scope(s): pay:write" };
}

type ConstructEventFn = (rawBody: Buffer, signature: string, secret: string) => Stripe.Event;

function normalizeModeInput(value: unknown): string {
  return safeString(value).trim().toLowerCase();
}

export function resolveStripeWebhookMode(params: {
  envModeRaw: string | null | undefined;
  configModeRaw: string | null | undefined;
}): StripeWebhookModeResolution {
  const envModeRaw = normalizeModeInput(params.envModeRaw);
  const configModeRaw = normalizeModeInput(params.configModeRaw);
  if (envModeRaw) {
    if (envModeRaw !== "test" && envModeRaw !== "live") {
      return {
        ok: false,
        code: 500,
        reasonCode: "WEBHOOK_MODE_INVALID",
        message: `${STRIPE_WEBHOOK_MODE_ENV} must be "test" or "live"`,
        envModeRaw,
      };
    }
    return {
      ok: true,
      mode: envModeRaw as StripeMode,
      modeSource: "env_override",
      envModeRaw,
      configModeRaw,
    };
  }
  if (configModeRaw === "test" || configModeRaw === "live") {
    return {
      ok: true,
      mode: configModeRaw as StripeMode,
      modeSource: "config_doc",
      envModeRaw,
      configModeRaw,
    };
  }
  return {
    ok: true,
    mode: "test",
    modeSource: "default_test",
    envModeRaw,
    configModeRaw,
  };
}

export function validateStripeWebhookSecret(params: {
  mode: StripeMode;
  secret: string;
}): StripeWebhookSecretValidation {
  const secret = safeString(params.secret).trim();
  if (!secret) {
    return {
      ok: false,
      code: 500,
      reasonCode: "WEBHOOK_SECRET_MISSING",
      message: `Stripe webhook secret missing for mode ${params.mode}`,
    };
  }
  if (!secret.startsWith("whsec_") || secret.length < 12) {
    return {
      ok: false,
      code: 500,
      reasonCode: "WEBHOOK_SECRET_FORMAT_INVALID",
      message: `Stripe webhook secret format invalid for mode ${params.mode}`,
    };
  }
  const lowered = secret.toLowerCase();
  if (PLACEHOLDER_SECRET_MARKERS.some((marker) => lowered.includes(marker))) {
    return {
      ok: false,
      code: 500,
      reasonCode: "WEBHOOK_SECRET_PLACEHOLDER",
      message: `Stripe webhook secret appears to be a placeholder for mode ${params.mode}`,
    };
  }
  return { ok: true, normalizedSecret: secret };
}

async function resolveStripeWebhookVerifyContext(): Promise<StripeWebhookContextResult> {
  const envModeRaw = safeString(process.env[STRIPE_WEBHOOK_MODE_ENV]).trim();
  let configModeRaw = "";
  if (!envModeRaw) {
    try {
      const configSnap = await db.doc(CONFIG_DOC_PATH).get();
      const configData = (configSnap.data() ?? {}) as Record<string, unknown>;
      configModeRaw = safeString(configData.mode).trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        code: 500,
        reasonCode: "WEBHOOK_MODE_INVALID",
        message: `Unable to read webhook mode from ${CONFIG_DOC_PATH}: ${message}`,
        mode: null,
        modeSource: null,
        secretSource: null,
        envModeRaw,
        configModeRaw,
      };
    }
  }
  const modeResolution = resolveStripeWebhookMode({ envModeRaw, configModeRaw });
  if (!modeResolution.ok) {
    return {
      ok: false,
      code: modeResolution.code,
      reasonCode: modeResolution.reasonCode,
      message: modeResolution.message,
      mode: null,
      modeSource: null,
      secretSource: null,
      envModeRaw: modeResolution.envModeRaw,
      configModeRaw,
    };
  }
  const { mode, modeSource } = modeResolution;
  let secret: string;
  try {
    secret = getStripeWebhookSecret(mode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: 500,
      reasonCode: "WEBHOOK_SECRET_UNAVAILABLE",
      message,
      mode,
      modeSource,
      secretSource: "secret_manager",
      envModeRaw: modeResolution.envModeRaw,
      configModeRaw: modeResolution.configModeRaw,
    };
  }
  const secretValidation = validateStripeWebhookSecret({ mode, secret });
  if (!secretValidation.ok) {
    return {
      ok: false,
      code: secretValidation.code,
      reasonCode: secretValidation.reasonCode,
      message: secretValidation.message,
      mode,
      modeSource,
      secretSource: "secret_manager",
      envModeRaw: modeResolution.envModeRaw,
      configModeRaw: modeResolution.configModeRaw,
    };
  }
  return {
    ok: true,
    context: {
      mode,
      modeSource,
      secretSource: "secret_manager",
      secret: secretValidation.normalizedSecret,
    },
  };
}

export function verifyStripeWebhookEvent(params: {
  rawBody: Buffer;
  signature: string;
  context: StripeWebhookVerifyContext;
  construct?: ConstructEventFn;
}): StripeWebhookVerifyResult {
  const construct = params.construct ?? ((rawBody, signature, secret) => Stripe.webhooks.constructEvent(rawBody, signature, secret));
  let event: Stripe.Event;
  try {
    event = construct(params.rawBody, params.signature, params.context.secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: 400,
      reasonCode: "WEBHOOK_SIGNATURE_INVALID",
      message,
      mode: params.context.mode,
      modeSource: params.context.modeSource,
      secretSource: params.context.secretSource,
      eventLivemode: null,
      expectedLivemode: params.context.mode === "live",
    };
  }

  const eventLivemode = event.livemode === true;
  const expectedLivemode = params.context.mode === "live";
  if (eventLivemode !== expectedLivemode) {
    return {
      ok: false,
      code: 400,
      reasonCode: "WEBHOOK_LIVEMODE_MISMATCH",
      message: `Stripe event livemode=${eventLivemode} does not match expected mode=${params.context.mode}`,
      mode: params.context.mode,
      modeSource: params.context.modeSource,
      secretSource: params.context.secretSource,
      eventLivemode,
      expectedLivemode,
    };
  }

  return {
    ok: true,
    event,
    mode: params.context.mode,
    modeSource: params.context.modeSource,
    secretSource: params.context.secretSource,
  };
}

export function classifyStripeWebhookReplayState(
  existingEventData: Record<string, unknown> | null | undefined
): StripeWebhookReplayState {
  if (!existingEventData) return "process";
  if (existingEventData.processedAt) return "duplicate_processed";
  if (existingEventData.processingStartedAt) {
    const startedAtRaw = existingEventData.processingStartedAt;
    let startedAtMs: number | null = null;
    if (typeof startedAtRaw === "string") {
      const parsed = Date.parse(startedAtRaw);
      startedAtMs = Number.isFinite(parsed) ? parsed : null;
    } else if (
      typeof startedAtRaw === "object" &&
      startedAtRaw &&
      typeof (startedAtRaw as { toMillis?: () => number }).toMillis === "function"
    ) {
      try {
        startedAtMs = (startedAtRaw as { toMillis: () => number }).toMillis();
      } catch {
        startedAtMs = null;
      }
    }
    if (startedAtMs !== null && Date.now() - startedAtMs > WEBHOOK_PROCESSING_LOCK_TTL_MS) {
      return "process";
    }
    return "duplicate_inflight";
  }
  return "process";
}

export const staffGetStripeConfig = onRequest(
  { region: REGION, cors: true, secrets: [...STRIPE_SECRET_PARAMS] },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const staff = await requireStaffUid(req);
    if (!staff.ok) {
      res.status(staff.code).json({ ok: false, message: staff.message });
      return;
    }

    const configSnap = await db.doc(CONFIG_DOC_PATH).get();
    const configData = (configSnap.data() ?? {}) as Record<string, unknown>;
    const config = toPublicConfigResponse(configData);
    const audit = await readStripeAudit(20);
    res.status(200).json({
      ok: true,
      config,
      audit,
      webhookEndpointUrl: getWebhookEndpointUrl(),
      safeFields: [
        "mode",
        "publishableKeys",
        "priceIds",
        "productIds",
        "enabledFeatures",
        "successUrl",
        "cancelUrl",
      ],
      restrictedFields: [
        "STRIPE_TEST_SECRET_KEY",
        "STRIPE_LIVE_SECRET_KEY",
        "STRIPE_TEST_WEBHOOK_SECRET",
        "STRIPE_LIVE_WEBHOOK_SECRET",
      ],
    });
  }
);

export const staffUpdateStripeConfig = onRequest(
  { region: REGION, cors: true, secrets: [...STRIPE_SECRET_PARAMS] },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const staff = await requireStaffUid(req);
    if (!staff.ok) {
      res.status(staff.code).json({ ok: false, message: staff.message });
      return;
    }

    const parsed = parseBody(stripeConfigSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    try {
      const nextConfig = validateStripeConfigForPersist(parsed.data);

      const configRef = db.doc(CONFIG_DOC_PATH);
      const currentSnap = await configRef.get();
      const currentData = (currentSnap.data() ?? {}) as Record<string, unknown>;
      const current = normalizeStripeConfig(currentData);
      const diff = summarizeConfigChanges(current, nextConfig);

      const ts = nowTs();
      await configRef.set({
        ...nextConfig,
        updatedAt: ts,
        updatedByUid: staff.uid,
        updatedByEmail: staff.email,
      }, { merge: true });

      await configRef.collection(AUDIT_SUBCOLLECTION).add({
        changedPaths: diff.changedPaths,
        summary: diff.summary,
        updatedAt: ts,
        updatedByUid: staff.uid,
        updatedByEmail: staff.email,
      });

      const latest = toPublicConfigResponse({
        ...nextConfig,
        updatedAt: ts,
        updatedByUid: staff.uid,
        updatedByEmail: staff.email,
      });

      res.status(200).json({ ok: true, config: latest, changedPaths: diff.changedPaths, summary: diff.summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("staffUpdateStripeConfig failed", { message });
      res.status(400).json({ ok: false, message });
    }
  }
);

export const staffValidateStripeConfig = onRequest(
  { region: REGION, cors: true, secrets: [...STRIPE_SECRET_PARAMS] },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const staff = await requireStaffUid(req);
    if (!staff.ok) {
      res.status(staff.code).json({ ok: false, message: staff.message });
      return;
    }

    try {
      const opsConfig = await getAgentOpsConfig();
      if (!opsConfig.enabled || !opsConfig.allowPayments) {
        res.status(503).json({ ok: false, message: "Agent payments are disabled by staff" });
        return;
      }

      const configSnap = await db.doc(CONFIG_DOC_PATH).get();
      const configData = (configSnap.data() ?? {}) as Record<string, unknown>;
      const config = validateStripeConfigForPersist(normalizeStripeConfig(configData));

      const mode: StripeMode = config.mode;
      const stripe = getStripeClient(mode);
      const account = await stripe.accounts.retrieve();

      const firstPriceEntry = Object.entries(config.priceIds)[0] ?? null;
      let priceCheck: { key: string; id: string; active: boolean; currency: string | null } | null = null;
      if (firstPriceEntry) {
        const [key, priceId] = firstPriceEntry;
        const price = await stripe.prices.retrieve(priceId);
        priceCheck = {
          key,
          id: price.id,
          active: price.active,
          currency: price.currency ?? null,
        };
      }

      res.status(200).json({
        ok: true,
        mode,
        account: {
          id: account.id,
          businessType: account.business_type ?? null,
          country: account.country ?? null,
          defaultCurrency: account.default_currency ?? null,
        },
        activePublishableKeyValid:
          mode === "live" ? config.publishableKeys.live.startsWith("pk_live_") : config.publishableKeys.test.startsWith("pk_test_"),
        webhookSecretConfigured: Boolean(getStripeWebhookSecret(mode)),
        priceCheck,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("staffValidateStripeConfig failed", { message });
      res.status(400).json({ ok: false, message });
    }
  }
);

export const createCheckoutSession = onRequest(
  { region: REGION, cors: true, secrets: [...STRIPE_SECRET_PARAMS] },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }

    const parsed = parseBody(checkoutSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "createCheckoutSession",
      max: 20,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    try {
      const configSnap = await db.doc(CONFIG_DOC_PATH).get();
      const configData = (configSnap.data() ?? {}) as Record<string, unknown>;
      const config = normalizeStripeConfig(configData);

      if (!config.enabledFeatures.checkout) {
        res.status(403).json({ ok: false, message: "Checkout is currently disabled by staff" });
        return;
      }

      validateUrlField("successUrl", config.successUrl);
      validateUrlField("cancelUrl", config.cancelUrl);

      let selectedPriceId = safeString(parsed.data.priceId).trim();
      const priceKey = safeString(parsed.data.priceKey).trim();
      if (!selectedPriceId && priceKey) {
        selectedPriceId = safeString(config.priceIds[priceKey]).trim();
      }
      if (!selectedPriceId) {
        const firstEntry = Object.values(config.priceIds)[0];
        selectedPriceId = safeString(firstEntry).trim();
      }
      if (!selectedPriceId) {
        res.status(400).json({ ok: false, message: "No Stripe priceId configured" });
        return;
      }
      const allowedPriceIds = new Set(Object.values(config.priceIds).map((entry) => safeString(entry).trim()).filter(Boolean));
      if (allowedPriceIds.size > 0 && !allowedPriceIds.has(selectedPriceId)) {
        res.status(400).json({ ok: false, message: "Price is not enabled in Stripe settings" });
        return;
      }

      const mode: StripeMode = config.mode;
      const stripe = getStripeClient(mode);
      const quantity = asInt(parsed.data.quantity, 1);
      const idempotencyHeader = req.headers["idempotency-key"];
      const idempotencyKey = typeof idempotencyHeader === "string" ? idempotencyHeader.trim() : Array.isArray(idempotencyHeader) ? String(idempotencyHeader[0]).trim() : "";

      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [{ price: selectedPriceId, quantity: Math.max(1, quantity) }],
          success_url: config.successUrl,
          cancel_url: config.cancelUrl,
          client_reference_id: auth.uid,
          metadata: {
            uid: auth.uid,
            mode,
            source: "portal",
            priceKey: priceKey || "direct",
          },
        },
        idempotencyKey ? { idempotencyKey } : undefined
      );

      const ts = nowTs();
      const paymentRef = db.collection("payments").doc(session.id);
      const userPaymentRef = db.collection("users").doc(auth.uid).collection("payments").doc(session.id);
      const basePayment = {
        uid: auth.uid,
        mode,
        status: "checkout_created",
        source: "portal_checkout",
        priceId: selectedPriceId,
        checkoutSessionId: session.id,
        stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
        amountTotal: typeof session.amount_total === "number" ? session.amount_total : null,
        currency: typeof session.currency === "string" ? session.currency : null,
        updatedAt: ts,
      };
      await Promise.all([
        paymentRef.set({ ...basePayment, createdAt: ts }, { merge: true }),
        userPaymentRef.set({ ...basePayment, createdAt: ts }, { merge: true }),
      ]);

      logger.info("createCheckoutSession success", {
        uid: auth.uid,
        mode,
        checkoutSessionId: session.id,
        priceId: selectedPriceId,
      });

      res.status(200).json({
        ok: true,
        checkoutUrl: session.url,
        sessionId: session.id,
        mode,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("createCheckoutSession failed", { message });
      res.status(500).json({ ok: false, message: "Unable to create checkout session" });
    }
  }
);

export const createAgentCheckoutSession = onRequest(
  { region: REGION, cors: true, secrets: [...STRIPE_SECRET_PARAMS] },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }
    const requestId =
      (typeof req.headers?.["x-request-id"] === "string" && req.headers["x-request-id"].trim()) ||
      `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    const auth = await requireAuthContext(req);
    if (!auth.ok) {
      await logAuditEvent({
        req,
        requestId,
        action: "agent_checkout_create",
        resourceType: "agent_order",
        result: "deny",
        reasonCode: auth.code,
      });
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const scopeCheck = requirePayScopeForContext(auth.ctx);
    if (!scopeCheck.ok) {
      res.status(403).json({ ok: false, message: scopeCheck.message });
      return;
    }

    const parsed = parseBody(agentCheckoutSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const isStaff = auth.ctx.mode === "firebase" && isStaffFromDecoded(auth.ctx.decoded);
    const orderId = safeString(parsed.data.orderId).trim();
    const orderRef = db.collection("agentOrders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      res.status(404).json({ ok: false, message: "Order not found" });
      return;
    }
    const order = orderSnap.data() as Record<string, unknown>;
    const orderUid = safeString(order.uid).trim();
    if (!orderUid) {
      res.status(500).json({ ok: false, message: "Order missing uid" });
      return;
    }
    const authz = await assertActorAuthorized({
      req,
      ctx: auth.ctx,
      ownerUid: orderUid,
      scope: "pay:write",
      resource: `agent_order:${orderId}`,
      allowStaff: true,
    });
    if (!authz.ok || (orderUid !== auth.ctx.uid && !isStaff)) {
      await logAuditEvent({
        req,
        requestId,
        action: "agent_checkout_create",
        resourceType: "agent_order",
        resourceId: orderId,
        ownerUid: orderUid,
        result: "deny",
        reasonCode: authz.ok ? "FORBIDDEN" : authz.code,
        ctx: auth.ctx,
      });
      res.status(authz.ok ? 403 : authz.httpStatus).json({ ok: false, message: authz.ok ? "Forbidden" : authz.message });
      return;
    }

    const currentPaymentStatus = safeString(order.paymentStatus).trim();
    if (currentPaymentStatus === "paid" || currentPaymentStatus === "payment_succeeded") {
      res.status(200).json({
        ok: true,
        replay: true,
        orderId,
        paymentStatus: currentPaymentStatus,
        checkoutUrl: safeString(order.checkoutUrl) || null,
        sessionId: safeString(order.stripeCheckoutSessionId) || null,
      });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "createAgentCheckoutSession",
      max: 30,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    try {
      const configSnap = await db.doc(CONFIG_DOC_PATH).get();
      const configData = (configSnap.data() ?? {}) as Record<string, unknown>;
      const config = normalizeStripeConfig(configData);
      if (!config.enabledFeatures.checkout) {
        res.status(403).json({ ok: false, message: "Checkout is currently disabled by staff" });
        return;
      }

      validateUrlField("successUrl", config.successUrl);
      validateUrlField("cancelUrl", config.cancelUrl);

      let selectedPriceId = safeString(order.priceId).trim();
      if (!selectedPriceId) {
        selectedPriceId = safeString(config.priceIds["agent_default"]).trim();
      }
      if (!selectedPriceId) {
        res.status(400).json({ ok: false, message: "No Stripe priceId configured for this order" });
        return;
      }
      const allowedPriceIds = new Set(
        Object.values(config.priceIds)
          .map((entry) => safeString(entry).trim())
          .filter(Boolean)
      );
      if (allowedPriceIds.size > 0 && !allowedPriceIds.has(selectedPriceId)) {
        res.status(400).json({ ok: false, message: "Price is not enabled in Stripe settings" });
        return;
      }

      const mode: StripeMode = config.mode;
      const stripe = getStripeClient(mode);
      const quantity = Math.max(1, asInt(order.quantity, 1));
      const idempotencyHeader = req.headers["idempotency-key"];
      const explicitIdempotencyKey =
        typeof idempotencyHeader === "string"
          ? idempotencyHeader.trim()
          : Array.isArray(idempotencyHeader)
            ? String(idempotencyHeader[0]).trim()
            : "";
      const idempotencyKey =
        explicitIdempotencyKey || makeIdempotencyId("agent-checkout", orderUid, orderId);

      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [{ price: selectedPriceId, quantity }],
          success_url: config.successUrl,
          cancel_url: config.cancelUrl,
          client_reference_id: orderUid,
          metadata: {
            uid: orderUid,
            mode,
            source: "agent",
            orderId,
            agentOrderId: orderId,
            reservationId: safeString(order.reservationId) || "",
            agentReservationId: safeString(order.reservationId) || "",
            agentQuoteId: safeString(order.quoteId) || "",
          },
        },
        { idempotencyKey }
      );

      const ts = nowTs();
      const paymentRef = db.collection("payments").doc(session.id);
      const userPaymentRef = db
        .collection("users")
        .doc(orderUid)
        .collection("payments")
        .doc(session.id);
      const basePayment = {
        uid: orderUid,
        mode,
        status: "checkout_created",
        source: "agent_checkout",
        orderId,
        reservationId: safeString(order.reservationId) || null,
        quoteId: safeString(order.quoteId) || null,
        priceId: selectedPriceId,
        checkoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        amountTotal:
          typeof session.amount_total === "number" ? session.amount_total : null,
        currency: typeof session.currency === "string" ? session.currency : null,
        updatedAt: ts,
      };

      await Promise.all([
        paymentRef.set({ ...basePayment, createdAt: ts }, { merge: true }),
        userPaymentRef.set({ ...basePayment, createdAt: ts }, { merge: true }),
        orderRef.set(
          {
            status: "payment_pending",
            paymentStatus: "checkout_created",
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : null,
            checkoutUrl: typeof session.url === "string" ? session.url : null,
            mode,
            updatedAt: ts,
          },
          { merge: true }
        ),
        db.collection("agentAuditLogs").add({
          actorUid: auth.ctx.uid,
          actorMode: auth.ctx.mode,
          action: "agent_checkout_created",
          orderId,
          sessionId: session.id,
          requestId: safeString(req.headers["x-request-id"]) || null,
          createdAt: ts,
        }),
      ]);

      logger.info("createAgentCheckoutSession success", {
        uid: orderUid,
        requesterUid: auth.ctx.uid,
        requesterMode: auth.ctx.mode,
        mode,
        orderId,
        checkoutSessionId: session.id,
      });

      res.status(200).json({
        ok: true,
        orderId,
        checkoutUrl: session.url,
        sessionId: session.id,
        mode,
      });
      await logAuditEvent({
        req,
        requestId,
        action: "agent_checkout_create",
        resourceType: "agent_order",
        resourceId: orderId,
        ownerUid: orderUid,
        result: "allow",
        ctx: auth.ctx,
        metadata: { sessionId: session.id, mode },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("createAgentCheckoutSession failed", { message, orderId });
      await logAuditEvent({
        req,
        requestId,
        action: "agent_checkout_create",
        resourceType: "agent_order",
        resourceId: orderId,
        ownerUid: orderUid,
        result: "error",
        reasonCode: "STRIPE_CHECKOUT_CREATE_FAILED",
        ctx: auth.ctx,
      });
      res.status(500).json({ ok: false, message: "Unable to create agent checkout session" });
    }
  }
);

async function applyPaymentUpdate(params: {
  update: PaymentUpdate;
  mode: StripeMode;
  eventId: string;
  eventType: string;
}) {
  const { update, mode, eventId, eventType } = params;
  const transition = getStripeWebhookEventContract(eventType);
  if (!transition) {
    throw new Error(`Unsupported Stripe webhook event transition (${eventType})`);
  }
  if (update.status !== transition.paymentStatus) {
    throw new Error(
      `Stripe transition mismatch (${eventType} expected ${transition.paymentStatus} got ${update.status})`
    );
  }
  if (update.sourceEventType !== eventType) {
    throw new Error(
      `Stripe event source mismatch (${eventType} expected update source ${update.sourceEventType})`
    );
  }
  const paymentRef = db.collection("payments").doc(update.paymentId);
  const now = nowTs();

  await db.runTransaction(async (tx) => {
    const paymentSnap = await tx.get(paymentRef);
    const current = paymentSnap.exists ? (paymentSnap.data() as Record<string, unknown>) : null;
    const mergedStatus = mergePaymentStatus(safeString(current?.status) || null, update.status);
    const nextPayload: Record<string, unknown> = {
      uid: (update.uid ?? safeString(current?.uid)) || null,
      mode,
      status: mergedStatus,
      source: "stripe_webhook",
      checkoutSessionId: (update.sessionId ?? safeString(current?.checkoutSessionId)) || null,
      stripePaymentIntentId:
        (update.paymentIntentId ?? safeString(current?.stripePaymentIntentId)) || null,
      stripeInvoiceId: (update.invoiceId ?? safeString(current?.stripeInvoiceId)) || null,
      amountTotal: typeof update.amountTotal === "number" ? update.amountTotal : (typeof current?.amountTotal === "number" ? current.amountTotal : null),
      currency: (update.currency ?? safeString(current?.currency)) || null,
      stripeDisputeStatus:
        (update.disputeStatus ?? safeString(current?.stripeDisputeStatus)) || null,
      stripeDisputeLifecycle:
        (update.disputeLifecycle ??
          (safeString(current?.stripeDisputeLifecycle) === "opened" ||
          safeString(current?.stripeDisputeLifecycle) === "closed"
            ? (safeString(current?.stripeDisputeLifecycle) as "opened" | "closed")
            : null)) ||
        null,
      lastEventId: eventId,
      lastEventType: eventType,
      eventIds: FieldValue.arrayUnion(eventId),
      updatedAt: now,
    };
    if (!paymentSnap.exists) {
      nextPayload.createdAt = now;
    }
    tx.set(paymentRef, nextPayload, { merge: true });

    const effectiveUid = safeString(nextPayload.uid);
    if (effectiveUid) {
      const userPaymentRef = db.collection("users").doc(effectiveUid).collection("payments").doc(update.paymentId);
      const userPayload: Record<string, unknown> = {
        status: mergedStatus,
        mode,
        checkoutSessionId: nextPayload.checkoutSessionId ?? null,
        stripePaymentIntentId: nextPayload.stripePaymentIntentId ?? null,
        stripeInvoiceId: nextPayload.stripeInvoiceId ?? null,
        amountTotal: nextPayload.amountTotal ?? null,
        currency: nextPayload.currency ?? null,
        stripeDisputeStatus: nextPayload.stripeDisputeStatus ?? null,
        stripeDisputeLifecycle: nextPayload.stripeDisputeLifecycle ?? null,
        source: "stripe_webhook",
        lastEventId: eventId,
        lastEventType: eventType,
        eventIds: FieldValue.arrayUnion(eventId),
        updatedAt: now,
      };
      tx.set(userPaymentRef, userPayload, { merge: true });
    }
  });

  const checkoutSessionId = safeString(update.sessionId).trim();
  const paymentIntentId = safeString(update.paymentIntentId).trim();
  const hintedOrderId = safeString(update.orderId).trim();

  const candidateOrderIds = new Set<string>();
  if (hintedOrderId) candidateOrderIds.add(hintedOrderId);

  if (checkoutSessionId) {
    const bySessionSnap = await db
      .collection("agentOrders")
      .where("stripeCheckoutSessionId", "==", checkoutSessionId)
      .limit(10)
      .get();
    for (const docSnap of bySessionSnap.docs) candidateOrderIds.add(docSnap.id);
  }

  if (paymentIntentId) {
    const byIntentSnap = await db
      .collection("agentOrders")
      .where("stripePaymentIntentId", "==", paymentIntentId)
      .limit(10)
      .get();
    for (const docSnap of byIntentSnap.docs) candidateOrderIds.add(docSnap.id);
  }

  if (!candidateOrderIds.size) return;

  const orderStatus = transition.orderStatus;
  const fulfillmentStatus = transition.fulfillmentStatus;
  const lifecycleStatus = deriveOrderLifecycleStatusFromWebhookTransition(orderStatus);
  const batch = db.batch();
  for (const orderId of candidateOrderIds) {
    const paymentAuditDetails = buildStripePaymentAuditDetails({
      orderId,
      paymentStatus: orderStatus,
      sourceEventType: eventType,
      eventId,
      disputeStatus: update.disputeStatus,
      disputeLifecycle: update.disputeLifecycle,
    });
    const orderRef = db.collection("agentOrders").doc(orderId);
    batch.set(
      orderRef,
      {
        paymentStatus: orderStatus,
        status: lifecycleStatus,
        fulfillmentStatus,
        stripeCheckoutSessionId: checkoutSessionId || null,
        stripePaymentIntentId: paymentIntentId || null,
        stripeDisputeStatus: paymentAuditDetails.disputeStatus,
        stripeDisputeLifecycle: paymentAuditDetails.disputeLifecycle,
        updatedAt: now,
        lastEventId: eventId,
        lastEventType: eventType,
      },
      { merge: true }
    );
    batch.set(db.collection("agentAuditLogs").doc(), {
      actorUid: null,
      actorMode: "system",
      action: "agent_order_payment_updated",
      orderId,
      paymentId: update.paymentId,
      status: orderStatus,
      sourceEventType: paymentAuditDetails.sourceEventType,
      eventId: paymentAuditDetails.eventId,
      disputeStatus: paymentAuditDetails.disputeStatus,
      disputeLifecycle: paymentAuditDetails.disputeLifecycle,
      createdAt: now,
    });
  }
  await batch.commit();

  for (const orderId of candidateOrderIds) {
    const linkedRequests = await db
      .collection("agentRequests")
      .where("commissionOrderId", "==", orderId)
      .limit(20)
      .get();
    if (linkedRequests.empty) continue;
    const requestBatch = db.batch();
    for (const reqDoc of linkedRequests.docs) {
      const paymentAuditDetails = buildStripePaymentAuditDetails({
        orderId,
        paymentStatus: orderStatus,
        sourceEventType: eventType,
        eventId,
        disputeStatus: update.disputeStatus,
        disputeLifecycle: update.disputeLifecycle,
      });
      const nextRequestStatus = transition.requestStatus;
      requestBatch.set(
        reqDoc.ref,
        {
          commissionPaymentStatus: orderStatus,
          updatedAt: now,
          status: nextRequestStatus,
        },
        { merge: true }
      );
      requestBatch.set(reqDoc.ref.collection("audit").doc(), {
        at: now,
        type: "commission_payment_status_updated",
        actorUid: null,
        actorMode: "system",
        details: paymentAuditDetails,
      });
    }
    await requestBatch.commit();
  }
}

export const stripePortalWebhook = onRequest(
  { region: REGION, timeoutSeconds: 60, secrets: [...STRIPE_SECRET_PARAMS] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Use POST");
      return;
    }

    const signature = req.headers["stripe-signature"];
    const signatureValue = typeof signature === "string" ? signature : Array.isArray(signature) ? String(signature[0]) : "";
    if (!signatureValue) {
      res.status(400).json({
        received: false,
        error: {
          code: "WEBHOOK_SIGNATURE_MISSING",
          message: "Missing stripe-signature header",
        },
      });
      return;
    }

    if (!Buffer.isBuffer(req.rawBody) || !req.rawBody.length) {
      res.status(400).json({
        received: false,
        error: {
          code: "WEBHOOK_RAW_BODY_MISSING",
          message: "Missing raw webhook body",
        },
      });
      return;
    }

    const contextResult = await resolveStripeWebhookVerifyContext();
    if (!contextResult.ok) {
      logger.error("stripePortalWebhook verify-context failed", {
        reasonCode: contextResult.reasonCode,
        message: contextResult.message,
        mode: contextResult.mode,
        modeSource: contextResult.modeSource,
        secretSource: contextResult.secretSource,
        envModeRaw: contextResult.envModeRaw,
        configModeRaw: contextResult.configModeRaw,
      });
      res.status(contextResult.code).json({
        received: false,
        error: {
          code: contextResult.reasonCode,
          message: contextResult.message,
          mode: contextResult.mode,
          modeSource: contextResult.modeSource,
          secretSource: contextResult.secretSource,
        },
      });
      return;
    }

    const verification = verifyStripeWebhookEvent({
      rawBody: req.rawBody,
      signature: signatureValue,
      context: contextResult.context,
    });
    if (!verification.ok) {
      logger.warn("stripePortalWebhook verify rejected", {
        reasonCode: verification.reasonCode,
        message: verification.message,
        mode: verification.mode,
        modeSource: verification.modeSource,
        secretSource: verification.secretSource,
        eventLivemode: verification.eventLivemode,
        expectedLivemode: verification.expectedLivemode,
      });
      res.status(verification.code).json({
        received: false,
        error: {
          code: verification.reasonCode,
          message: verification.message,
          mode: verification.mode,
          modeSource: verification.modeSource,
          secretSource: verification.secretSource,
          livemode: verification.eventLivemode,
          expectedLivemode: verification.expectedLivemode,
        },
      });
      return;
    }

    const { event, mode, modeSource, secretSource } = verification;
    const eventRef = db.collection("stripeWebhookEvents").doc(event.id);
    const replayState = await db.runTransaction(async (tx) => {
      const existing = await tx.get(eventRef);
      const existingData = existing.exists ? (existing.data() as Record<string, unknown>) : null;
      const nextState = classifyStripeWebhookReplayState(existingData);
      if (nextState !== "process") return nextState;
      tx.set(eventRef, {
        id: event.id,
        type: event.type,
        mode,
        modeSource,
        secretSource,
        livemode: event.livemode === true,
        expectedLivemode: mode === "live",
        receivedAt: nowTs(),
        processingStartedAt: nowTs(),
        processedAt: null,
        ignored: false,
        verifyStatus: "verified",
        verifyReasonCode: "WEBHOOK_VERIFY_OK",
      }, { merge: true });
      return nextState;
    });
    if (replayState !== "process") {
      logger.info("stripePortalWebhook duplicate", {
        eventId: event.id,
        type: event.type,
        mode,
        modeSource,
        replayState,
      });
      res.status(200).json({
        received: true,
        duplicate: true,
        replayState,
      });
      return;
    }

    const eventContract = getStripeWebhookEventContract(event.type);
    if (!eventContract) {
      await eventRef.set({
        processedAt: nowTs(),
        processingStartedAt: null,
        ignored: true,
        ignoreReason: "unsupported_event_type",
      }, { merge: true });
      logger.info("stripePortalWebhook ignored event", {
        eventId: event.id,
        type: event.type,
        mode,
        modeSource,
      });
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    let update: PaymentUpdate;
    try {
      const parsed = derivePaymentUpdateFromStripeEvent(event);
      if (!parsed) {
        await eventRef.set({
          processingStartedAt: null,
          failedAt: nowTs(),
          failureCode: "WEBHOOK_EVENT_UNSUPPORTED",
          failureMessage: `Unsupported Stripe event ${event.type}`,
        }, { merge: true });
        res.status(400).json({
          received: false,
          error: {
            code: "WEBHOOK_EVENT_UNSUPPORTED",
            message: `Unsupported Stripe event ${event.type}`,
            mode,
            modeSource,
            secretSource,
          },
        });
        return;
      }
      update = parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("stripePortalWebhook parse failed", {
        eventId: event.id,
        type: event.type,
        mode,
        modeSource,
        message,
      });
      await eventRef.set({
        processingStartedAt: null,
        failedAt: nowTs(),
        failureCode: "WEBHOOK_EVENT_PARSE_FAILED",
        failureMessage: message,
      }, { merge: true });
      res.status(500).json({
        received: false,
        error: {
          code: "WEBHOOK_EVENT_PARSE_FAILED",
          message,
          mode,
          modeSource,
          secretSource,
        },
      });
      return;
    }

    try {
      await applyPaymentUpdate({
        update,
        mode,
        eventId: event.id,
        eventType: event.type,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("stripePortalWebhook apply failed", {
        eventId: event.id,
        type: event.type,
        mode,
        modeSource,
        message,
      });
      await eventRef.set({
        processingStartedAt: null,
        failedAt: nowTs(),
        failureCode: "WEBHOOK_APPLY_UPDATE_FAILED",
        failureMessage: message,
      }, { merge: true });
      res.status(500).json({
        received: false,
        error: {
          code: "WEBHOOK_APPLY_UPDATE_FAILED",
          message,
          mode,
          modeSource,
          secretSource,
        },
      });
      return;
    }

    await eventRef.set({
      processedAt: nowTs(),
      processingStartedAt: null,
      uid: update.uid,
      paymentId: update.paymentId,
      status: update.status,
      disputeStatus: update.disputeStatus,
      disputeLifecycle: update.disputeLifecycle,
      transitionOrderStatus: eventContract.orderStatus,
      transitionFulfillmentStatus: eventContract.fulfillmentStatus,
      transitionRequestStatus: eventContract.requestStatus,
    }, { merge: true });

    logger.info("stripePortalWebhook processed", {
      eventId: event.id,
      type: event.type,
      uid: update.uid,
      mode,
      modeSource,
      secretSource,
      livemode: event.livemode === true,
      expectedLivemode: mode === "live",
    });

    res.status(200).json({ received: true });
  }
);
