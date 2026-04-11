import Stripe from "stripe";
import { z } from "zod";

import { db, safeString } from "./shared";
import { getStripeSecretKey, type StripeMode } from "./stripeSecrets";

export const STRIPE_CONFIG_DOC_PATH = "config/stripe";

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
  const client = new Stripe(getStripeSecretKey(mode));
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
