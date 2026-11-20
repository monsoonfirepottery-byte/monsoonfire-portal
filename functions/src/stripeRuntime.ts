import Stripe from "stripe";
import { z } from "zod";

import { db, safeString } from "./shared";
import { getStripeSecretKey, type StripeMode } from "./stripeSecrets";

export const STRIPE_CONFIG_DOC_PATH = "config/stripe";
export const STRIPE_API_VERSION = "2025-06-30.basil" as const;
// API requests and webhook payload snapshots are independently versioned, and
// Stripe versions each live/test destination independently. Preserve the two
// contracts that have completed signed-delivery proof instead of assuming one
// account-wide webhook version.
export const STRIPE_WEBHOOK_API_VERSION_BY_MODE = {
  test: "2025-10-29.clover",
  live: "2025-06-30.basil",
} as const;
export const STRIPE_WEBHOOK_API_VERSION = STRIPE_WEBHOOK_API_VERSION_BY_MODE.live;
export function getStripeWebhookApiVersion(mode: StripeMode): string {
  return STRIPE_WEBHOOK_API_VERSION_BY_MODE[mode];
}
export const STRIPE_STUDIO_ACCOUNT_ID = "acct_1RgW2PQ5FSR28Ffn" as const;

export const STRIPE_FIRING_BILLING_WEBHOOK_EVENTS = [
  "invoice.finalization_failed",
  "invoice.finalized",
  "invoice.marked_uncollectible",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.voided",
  "credit_note.created",
  "credit_note.updated",
  "credit_note.voided",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
] as const;

const STRIPE_NON_FIRING_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "payment_intent.succeeded",
  "invoice.paid",
  "payment_intent.payment_failed",
  "invoice.payment_failed",
  "charge.dispute.created",
  "charge.dispute.closed",
  "charge.refunded",
] as const;

export const STRIPE_PORTAL_WEBHOOK_ENABLED_EVENTS: readonly string[] = [
  ...new Set<string>([
    ...STRIPE_NON_FIRING_WEBHOOK_EVENTS,
    ...STRIPE_FIRING_BILLING_WEBHOOK_EVENTS,
  ]),
].sort();

export type StripeWebhookEndpointReadiness = {
  ready: boolean;
  matchingEndpointCount: number;
  endpointId: string | null;
  enabled: boolean;
  livemodeMatches: boolean;
  apiVersionMatches: boolean;
  missingEvents: string[];
  unexpectedEvents: string[];
};

export function evaluateStripeWebhookEndpointReadiness(params: {
  endpoints: Array<Pick<Stripe.WebhookEndpoint, "id" | "api_version" | "enabled_events" | "livemode" | "status" | "url">>;
  expectedUrl: string;
  mode: StripeMode;
}): StripeWebhookEndpointReadiness {
  const expectedEvents = new Set<string>(STRIPE_PORTAL_WEBHOOK_ENABLED_EVENTS);
  const matching = params.endpoints.filter((endpoint) => endpoint.url === params.expectedUrl);
  const endpoint = matching.find((candidate) => candidate.status === "enabled") ?? matching[0] ?? null;
  const actualEvents = new Set<string>(endpoint?.enabled_events ?? []);
  const missingEvents = [...expectedEvents].filter((eventType) => !actualEvents.has(eventType)).sort();
  const unexpectedEvents = [...actualEvents].filter((eventType) => !expectedEvents.has(eventType)).sort();
  const enabled = endpoint?.status === "enabled";
  const livemodeMatches = endpoint?.livemode === (params.mode === "live");
  const apiVersionMatches = endpoint?.api_version === getStripeWebhookApiVersion(params.mode);

  return {
    ready:
      matching.length === 1 &&
      enabled &&
      livemodeMatches &&
      apiVersionMatches &&
      missingEvents.length === 0 &&
      unexpectedEvents.length === 0,
    matchingEndpointCount: matching.length,
    endpointId: endpoint?.id ?? null,
    enabled,
    livemodeMatches,
    apiVersionMatches,
    missingEvents,
    unexpectedEvents,
  };
}

export type StripeWebhookSecretValidation =
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

const PLACEHOLDER_SECRET_MARKERS = ["placeholder", "changeme", "replace", "example", "todo"];

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

export const DEFAULT_FIRING_PICKUP_INSTRUCTIONS =
  "Use the studio access details from your dropoff confirmation. Standard pickup is self-serve, so you do not need to find anyone when you arrive. If you need a fresh copy later, use the Send pickup details again button in your ready email.";

export type StripeConfigInput = z.infer<typeof stripeConfigSchema>;

export const stripeConfigSchema = z.object({
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
  firingBilling: z.object({
    enabled: z.boolean().default(false),
    liveWritesEnabled: z.boolean().default(false),
    daysUntilDue: z.number().int().min(1).max(60).default(14),
    pickupInstructions: z.string().trim().min(1).max(2000)
      .default(DEFAULT_FIRING_PICKUP_INSTRUCTIONS),
    pickupInstructionsVersion: z.string().trim().min(1).max(80).default("2026-07-v1"),
  }).default({
    enabled: false,
    liveWritesEnabled: false,
    daysUntilDue: 14,
    pickupInstructions: DEFAULT_FIRING_PICKUP_INSTRUCTIONS,
    pickupInstructionsVersion: "2026-07-v1",
  }),
  successUrl: z.string().trim().default(""),
  cancelUrl: z.string().trim().default(""),
});

const STRIPE_CLIENTS: Partial<Record<StripeMode, Stripe>> = {};

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

function normalizeMetadata(
  input: Stripe.MetadataParam | Record<string, unknown> | null | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.trim();
    const normalizedValue = safeString(value).trim();
    if (!normalizedKey || !normalizedValue) continue;
    out[normalizedKey] = normalizedValue;
  }
  return out;
}

export function getStripeClient(mode: StripeMode): Stripe {
  const cached = STRIPE_CLIENTS[mode];
  if (cached) return cached;
  const client = new Stripe(getStripeSecretKey(mode), {
    // Stripe's SDK types are generated for its bundled Clover release, while
    // the HTTP API intentionally supports an older explicit Basil pin. Keep
    // that compatibility boundary isolated here; response fields used by the
    // app remain normalized and contract-tested below this client.
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
  });
  STRIPE_CLIENTS[mode] = client;
  return client;
}

export function getWebhookEndpointUrl(): string {
  const configured = safeString(process.env.STRIPE_WEBHOOK_PUBLIC_URL).trim();
  if (configured) return configured;
  const projectId = safeString(process.env.GCLOUD_PROJECT).trim();
  if (!projectId) return "/us-central1/stripePortalWebhook";
  return `https://us-central1-${projectId}.cloudfunctions.net/stripePortalWebhook`;
}

export function normalizeStripeConfig(
  data: Record<string, unknown> | null | undefined
): StripeConfigInput {
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
      customerPortal:
        (data?.enabledFeatures as Record<string, unknown> | undefined)?.customerPortal === true,
      invoices: (data?.enabledFeatures as Record<string, unknown> | undefined)?.invoices === true,
    },
    firingBilling: {
      enabled: (data?.firingBilling as Record<string, unknown> | undefined)?.enabled === true,
      liveWritesEnabled:
        (data?.firingBilling as Record<string, unknown> | undefined)?.liveWritesEnabled === true,
      daysUntilDue:
        typeof (data?.firingBilling as Record<string, unknown> | undefined)?.daysUntilDue === "number"
          ? (data?.firingBilling as Record<string, unknown>).daysUntilDue
          : 14,
      pickupInstructions: safeString(
        (data?.firingBilling as Record<string, unknown> | undefined)?.pickupInstructions,
        DEFAULT_FIRING_PICKUP_INSTRUCTIONS
      ),
      pickupInstructionsVersion: safeString(
        (data?.firingBilling as Record<string, unknown> | undefined)?.pickupInstructionsVersion,
        "2026-07-v1"
      ),
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

export function validateUrlField(label: string, value: string) {
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
  if (parsed.firingBilling.enabled && !parsed.enabledFeatures.invoices) {
    throw new Error("Firing pickup billing requires invoices to be enabled");
  }
  if (parsed.firingBilling.liveWritesEnabled && parsed.mode !== "live") {
    throw new Error("Live firing-billing writes can only be armed while Stripe is in live mode");
  }
  return parsed;
}

export async function loadStripeConfig(): Promise<StripeConfigInput> {
  const configSnap = await db.doc(STRIPE_CONFIG_DOC_PATH).get();
  const configData = (configSnap.data() ?? {}) as Record<string, unknown>;
  return normalizeStripeConfig(configData);
}

export function readStripeIdempotencyKey(
  headers: Record<string, unknown> | undefined,
  fallback = ""
): string {
  const raw = headers?.["idempotency-key"];
  const explicitKey =
    typeof raw === "string" ? raw.trim() : Array.isArray(raw) ? String(raw[0] ?? "").trim() : "";
  return explicitKey || fallback;
}

export async function createConfiguredCheckoutSession(params: {
  headers?: Record<string, unknown>;
  session: Stripe.Checkout.SessionCreateParams;
  fallbackIdempotencyKey?: string;
}) {
  const config = await loadStripeConfig();
  if (!config.enabledFeatures.checkout) {
    throw new Error("Checkout is currently disabled by staff");
  }

  const mode: StripeMode = config.mode;
  const stripe = getStripeClient(mode);
  const idempotencyKey = readStripeIdempotencyKey(
    params.headers,
    safeString(params.fallbackIdempotencyKey).trim()
  );

  const metadata = {
    ...normalizeMetadata(params.session.metadata),
    mode,
  };
  const paymentIntentMetadata = {
    ...metadata,
    ...normalizeMetadata(params.session.payment_intent_data?.metadata),
  };

  const session = await stripe.checkout.sessions.create(
    {
      ...params.session,
      metadata,
      payment_intent_data: {
        ...params.session.payment_intent_data,
        metadata: paymentIntentMetadata,
      },
    },
    idempotencyKey ? { idempotencyKey } : undefined
  );

  return {
    config,
    mode,
    session,
    idempotencyKey,
  };
}

async function resolveChargeReceiptUrl(stripe: Stripe, chargeId: string): Promise<string | null> {
  if (!chargeId) return null;
  const charge = await stripe.charges.retrieve(chargeId);
  return safeString(charge.receipt_url) || null;
}

export async function resolveStripeReceiptUrl(params: {
  mode: StripeMode;
  paymentIntentId?: string | null;
  chargeId?: string | null;
  invoiceId?: string | null;
  receiptUrl?: string | null;
}) {
  const seeded = safeString(params.receiptUrl).trim();
  if (seeded) return seeded;

  const stripe = getStripeClient(params.mode);
  const chargeId = safeString(params.chargeId).trim();
  if (chargeId) {
    try {
      return await resolveChargeReceiptUrl(stripe, chargeId);
    } catch {
      // Ignore direct charge lookup failures and continue to other receipt sources.
    }
  }

  const paymentIntentId = safeString(params.paymentIntentId).trim();
  if (paymentIntentId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge"],
      });
      const latestCharge = intent.latest_charge;
      if (typeof latestCharge === "string") {
        const receiptUrl = await resolveChargeReceiptUrl(stripe, latestCharge);
        if (receiptUrl) return receiptUrl;
      } else if (
        latestCharge &&
        typeof latestCharge === "object" &&
        typeof latestCharge.receipt_url === "string"
      ) {
        const receiptUrl = safeString(latestCharge.receipt_url).trim();
        if (receiptUrl) return receiptUrl;
      }
    } catch {
      // Ignore payment intent lookup failures and continue to invoice fallback.
    }
  }

  const invoiceId = safeString(params.invoiceId).trim();
  if (invoiceId) {
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      return safeString(invoice.hosted_invoice_url) || safeString(invoice.invoice_pdf) || null;
    } catch {
      // Ignore invoice lookup failures.
    }
  }

  return null;
}
