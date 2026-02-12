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
import {
  STRIPE_SECRET_PARAMS,
  type StripeMode,
  getStripeSecretKey,
  getStripeWebhookSecret,
} from "./stripeSecrets";

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

type PaymentStatus = "checkout_created" | "checkout_completed" | "payment_succeeded" | "invoice_paid";

type PaymentUpdate = {
  paymentId: string;
  status: PaymentStatus;
  uid: string | null;
  sessionId: string | null;
  paymentIntentId: string | null;
  invoiceId: string | null;
  amountTotal: number | null;
  currency: string | null;
  sourceEventType: string;
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

function getWebhookEndpointUrl(req: any): string {
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
  if (status === "invoice_paid") return 4;
  if (status === "payment_succeeded") return 3;
  if (status === "checkout_completed") return 2;
  return 1;
}

function mergePaymentStatus(current: string | null | undefined, next: PaymentStatus): PaymentStatus {
  if (!current) return next;
  const currentStatus = current as PaymentStatus;
  if (paymentStatusRank(next) > paymentStatusRank(currentStatus)) return next;
  return currentStatus;
}

function parseCheckoutSessionPayload(session: Stripe.Checkout.Session): PaymentUpdate {
  const amountTotal = typeof session.amount_total === "number" ? session.amount_total : null;
  const currency = typeof session.currency === "string" ? session.currency : null;
  const sessionId = typeof session.id === "string" ? session.id : null;
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
  const uid = safeString(session.metadata?.uid) || safeString(session.client_reference_id) || null;
  return {
    paymentId: sessionId || paymentIntentId || `checkout_${Date.now()}`,
    status: "checkout_completed",
    uid,
    sessionId,
    paymentIntentId,
    invoiceId: null,
    amountTotal,
    currency,
    sourceEventType: "checkout.session.completed",
  };
}

function parsePaymentIntentPayload(intent: Stripe.PaymentIntent): PaymentUpdate {
  const amountTotal = typeof intent.amount_received === "number" ? intent.amount_received : null;
  const currency = typeof intent.currency === "string" ? intent.currency : null;
  const uid = safeString(intent.metadata?.uid) || null;
  return {
    paymentId: intent.id,
    status: "payment_succeeded",
    uid,
    sessionId: safeString(intent.metadata?.checkoutSessionId) || null,
    paymentIntentId: intent.id,
    invoiceId: null,
    amountTotal,
    currency,
    sourceEventType: "payment_intent.succeeded",
  };
}

function parseInvoicePayload(invoice: Stripe.Invoice): PaymentUpdate {
  const amountTotal = typeof invoice.amount_paid === "number" ? invoice.amount_paid : null;
  const currency = typeof invoice.currency === "string" ? invoice.currency : null;
  const uid = safeString(invoice.metadata?.uid) || null;
  return {
    paymentId: invoice.id,
    status: "invoice_paid",
    uid,
    sessionId: safeString(invoice.metadata?.checkoutSessionId) || null,
    paymentIntentId: typeof invoice.payment_intent === "string" ? invoice.payment_intent : null,
    invoiceId: invoice.id,
    amountTotal,
    currency,
    sourceEventType: "invoice.paid",
  };
}

function getPaymentUpdateFromEvent(event: Stripe.Event): PaymentUpdate | null {
  if (event.type === "checkout.session.completed") {
    return parseCheckoutSessionPayload(event.data.object as Stripe.Checkout.Session);
  }
  if (event.type === "payment_intent.succeeded") {
    return parsePaymentIntentPayload(event.data.object as Stripe.PaymentIntent);
  }
  if (event.type === "invoice.paid") {
    return parseInvoicePayload(event.data.object as Stripe.Invoice);
  }
  return null;
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

export function constructWebhookEventWithMode(params: {
  rawBody: Buffer;
  signature: string;
  construct: ConstructEventFn;
  secretByMode: (mode: StripeMode) => string;
}): { event: Stripe.Event; mode: StripeMode } {
  const { rawBody, signature, construct, secretByMode } = params;
  const attempts: Array<{ mode: StripeMode; message: string }> = [];
  for (const mode of ["test", "live"] as StripeMode[]) {
    try {
      const event = construct(rawBody, signature, secretByMode(mode));
      return { event, mode };
    } catch (err) {
      attempts.push({ mode, message: err instanceof Error ? err.message : String(err) });
    }
  }
  throw new Error(`Unable to verify Stripe webhook signature (${attempts.map((entry) => `${entry.mode}: ${entry.message}`).join(" | ")})`);
}

export const staffGetStripeConfig = onRequest(
  { region: REGION, cors: true, secrets: STRIPE_SECRET_PARAMS },
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
      webhookEndpointUrl: getWebhookEndpointUrl(req),
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
  { region: REGION, cors: true, secrets: STRIPE_SECRET_PARAMS },
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
  { region: REGION, cors: true, secrets: STRIPE_SECRET_PARAMS },
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
  { region: REGION, cors: true, secrets: STRIPE_SECRET_PARAMS },
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
  { region: REGION, cors: true, secrets: STRIPE_SECRET_PARAMS },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const auth = await requireAuthContext(req);
    if (!auth.ok) {
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
    if (orderUid !== auth.ctx.uid && !isStaff) {
      res.status(403).json({ ok: false, message: "Forbidden" });
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
            agentOrderId: orderId,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("createAgentCheckoutSession failed", { message, orderId });
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
  const paymentRef = db.collection("payments").doc(update.paymentId);
  const now = nowTs();

  await db.runTransaction(async (tx) => {
    const paymentSnap = await tx.get(paymentRef);
    const current = paymentSnap.exists ? (paymentSnap.data() as Record<string, unknown>) : null;
    const mergedStatus = mergePaymentStatus(safeString(current?.status) || null, update.status);
    const nextPayload: Record<string, unknown> = {
      uid: update.uid ?? safeString(current?.uid) || null,
      mode,
      status: mergedStatus,
      source: "stripe_webhook",
      checkoutSessionId: update.sessionId ?? safeString(current?.checkoutSessionId) || null,
      stripePaymentIntentId: update.paymentIntentId ?? safeString(current?.stripePaymentIntentId) || null,
      stripeInvoiceId: update.invoiceId ?? safeString(current?.stripeInvoiceId) || null,
      amountTotal: typeof update.amountTotal === "number" ? update.amountTotal : (typeof current?.amountTotal === "number" ? current.amountTotal : null),
      currency: update.currency ?? safeString(current?.currency) || null,
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
  if (checkoutSessionId) {
    const orderMatches = await db
      .collection("agentOrders")
      .where("stripeCheckoutSessionId", "==", checkoutSessionId)
      .limit(5)
      .get();
    if (orderMatches.empty) return;

    const orderStatus =
      update.status === "payment_succeeded" || update.status === "invoice_paid"
        ? "paid"
        : update.status === "checkout_completed"
          ? "payment_pending"
          : "payment_pending";
    const fulfillmentStatus =
      update.status === "payment_succeeded" || update.status === "invoice_paid"
        ? "scheduled"
        : "queued";
    const batch = db.batch();
    for (const docSnap of orderMatches.docs) {
      batch.set(
        docSnap.ref,
        {
          paymentStatus: orderStatus,
          status: orderStatus === "paid" ? "paid" : "payment_pending",
          fulfillmentStatus,
          stripeCheckoutSessionId: checkoutSessionId,
          stripePaymentIntentId: update.paymentIntentId ?? null,
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
        orderId: docSnap.id,
        paymentId: update.paymentId,
        status: orderStatus,
        sourceEventType: eventType,
        eventId,
        createdAt: now,
      });
    }
    await batch.commit();
  }
}

export const stripePortalWebhook = onRequest(
  { region: REGION, timeoutSeconds: 60, secrets: STRIPE_SECRET_PARAMS },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Use POST");
      return;
    }

    const signature = req.headers["stripe-signature"];
    const signatureValue = typeof signature === "string" ? signature : Array.isArray(signature) ? String(signature[0]) : "";
    if (!signatureValue) {
      res.status(400).send("Missing stripe-signature header");
      return;
    }

    try {
      const constructed = constructWebhookEventWithMode({
        rawBody: req.rawBody,
        signature: signatureValue,
        construct: (rawBody, sig, secret) => new Stripe("sk_test_placeholder").webhooks.constructEvent(rawBody, sig, secret),
        secretByMode: (mode) => getStripeWebhookSecret(mode),
      });
      const { event, mode } = constructed;

      const eventRef = db.collection("stripeWebhookEvents").doc(event.id);
      const existing = await eventRef.get();
      if (existing.exists && existing.data()?.processedAt) {
        logger.info("stripePortalWebhook duplicate", { eventId: event.id, type: event.type, mode });
        res.status(200).json({ received: true, duplicate: true });
        return;
      }

      await eventRef.set({
        id: event.id,
        type: event.type,
        mode,
        livemode: event.livemode === true,
        receivedAt: nowTs(),
        processedAt: null,
      }, { merge: true });

      const update = getPaymentUpdateFromEvent(event);
      if (!update) {
        await eventRef.set({ processedAt: nowTs(), ignored: true }, { merge: true });
        logger.info("stripePortalWebhook ignored event", { eventId: event.id, type: event.type, mode });
        res.status(200).json({ received: true, ignored: true });
        return;
      }

      await applyPaymentUpdate({
        update,
        mode,
        eventId: event.id,
        eventType: event.type,
      });

      await eventRef.set({
        processedAt: nowTs(),
        uid: update.uid,
        paymentId: update.paymentId,
        status: update.status,
      }, { merge: true });

      logger.info("stripePortalWebhook processed", {
        eventId: event.id,
        type: event.type,
        uid: update.uid,
        mode,
      });

      res.status(200).json({ received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("stripePortalWebhook failed", { message });
      res.status(400).send("Webhook error");
    }
  }
);
