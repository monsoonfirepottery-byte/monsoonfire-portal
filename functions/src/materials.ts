/* eslint-disable @typescript-eslint/no-explicit-any */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import {
  applyCors,
  asInt,
  db,
  nowTs,
  requireAdmin,
  requireAuthUid,
  safeString,
  adminAuth,
  enforceRateLimit,
  parseBody,
} from "./shared";
import { z } from "zod";

const REGION = "us-central1";
const PRODUCTS_COL = "materialsProducts";
const ORDERS_COL = "materialsOrders";

const listMaterialsSchema = z.object({
  includeInactive: z.boolean().optional(),
});

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1)
    .max(50),
  pickupNotes: z.string().optional().nullable(),
});

const seedCatalogSchema = z.object({
  force: z.boolean().optional(),
});

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  if (!stripeClient) {
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

function getPortalBaseUrl(req: any): string {
  const configured = (process.env.PORTAL_BASE_URL ?? "").trim();
  if (configured) return configured.replace(/\/+$/, "");

  const origin = typeof req.headers?.origin === "string" ? req.headers.origin : "";
  if (origin) return origin.replace(/\/+$/, "");

  const referer = typeof req.headers?.referer === "string" ? req.headers.referer : "";
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin.replace(/\/+$/, "");
    } catch {
      // ignore
    }
  }

  return "";
}

type MaterialProductDoc = {
  name?: string;
  description?: string | null;
  category?: string | null;
  sku?: string | null;
  priceCents?: number;
  currency?: string;
  stripePriceId?: string | null;
  imageUrl?: string | null;
  trackInventory?: boolean;
  inventoryOnHand?: number;
  inventoryReserved?: number;
  active?: boolean;
};

type MaterialOrderItem = {
  productId: string;
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  currency: string;
  trackInventory: boolean;
};

function normalizeCurrency(value: string | undefined) {
  const raw = safeString(value).trim();
  if (!raw) return "USD";
  return raw.toUpperCase();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export const listMaterialsProducts = onRequest({ region: REGION, cors: true }, async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Use POST" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const parsed = parseBody(listMaterialsSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = enforceRateLimit({
    req,
    key: "listMaterialsProducts",
    max: 30,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const includeInactive = parsed.data.includeInactive === true;
  if (includeInactive) {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }
  }

  try {
    const snap = await db.collection(PRODUCTS_COL).get();

    const products = snap.docs
      .map((docSnap) => {
        const data = (docSnap.data() as MaterialProductDoc) ?? {};
        const active = data.active !== false;
        const trackInventory = data.trackInventory === true;
        const inventoryOnHand = trackInventory ? asInt(data.inventoryOnHand, 0) : null;
        const inventoryReserved = trackInventory ? asInt(data.inventoryReserved, 0) : null;
        const inventoryAvailable =
          trackInventory && inventoryOnHand !== null && inventoryReserved !== null
            ? Math.max(inventoryOnHand - inventoryReserved, 0)
            : null;

        return {
          id: docSnap.id,
          name: safeString(data.name),
          description: data.description ?? null,
          category: data.category ?? null,
          sku: data.sku ?? null,
          priceCents: asInt(data.priceCents, 0),
          currency: normalizeCurrency(data.currency),
          stripePriceId: data.stripePriceId ?? null,
          imageUrl: data.imageUrl ?? null,
          trackInventory,
          inventoryOnHand,
          inventoryReserved,
          inventoryAvailable,
          active,
        };
      })
      .filter((product) => (includeInactive ? true : product.active));

    res.status(200).json({ ok: true, products });
  } catch (err: any) {
    logger.error("listMaterialsProducts failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});

export const seedMaterialsCatalog = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Use POST" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const admin = await requireAdmin(req);
  if (!admin.ok) {
    res.status(403).json({ ok: false, message: "Forbidden" });
    return;
  }

  const parsed = parseBody(seedCatalogSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = enforceRateLimit({
    req,
    key: "seedMaterialsCatalog",
    max: 5,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const sampleProducts = [
    {
      sku: "DAY_PASS",
      name: "Day Pass",
      description: "Full day of studio access with tools, wheels, and glaze stations.",
      category: "Studio Access",
      priceCents: 4000,
      trackInventory: false,
    },
    {
      sku: "LAGUNA_BMIX_5_25",
      name: "Laguna WC-401 B-Mix Cone 5/6 (25 lb)",
      description: "Smooth, white body for mid-fire porcelain-style work.",
      category: "Clays",
      priceCents: 4000,
      trackInventory: true,
      inventoryOnHand: 40,
    },
    {
      sku: "LAGUNA_BMIX_10_25",
      name: "Laguna WC-401 B-Mix Cone 10 (25 lb)",
      description: "High-fire version of B-Mix for cone 10 workflows.",
      category: "Clays",
      priceCents: 4000,
      trackInventory: true,
      inventoryOnHand: 28,
    },
    {
      sku: "LAGUNA_BMIX_SPECKS_5_25",
      name: "Laguna B-Mix w/ Specks Cone 5/6 (25 lb)",
      description: "Mid-fire speckled body with warm texture.",
      category: "Clays",
      priceCents: 4500,
      trackInventory: true,
      inventoryOnHand: 24,
    },
    {
      sku: "RECYCLED_CLAY_MIDFIRE",
      name: "Recycled Clay - Mixed Midfire (per lb)",
      description: "Recycled midfire clay for practice and tests.",
      category: "Clays",
      priceCents: 100,
      trackInventory: true,
      inventoryOnHand: 300,
    },
    {
      sku: "MAYCO_WAX_RESIST_PINT",
      name: "Mayco AC-302 Wax Resist (pint)",
      description: "Water-based wax resist for clean glaze breaks.",
      category: "Glaze Supplies",
      priceCents: 800,
      trackInventory: true,
      inventoryOnHand: 18,
    },
    {
      sku: "LOCKER_ACCESS_MONTH",
      name: "Locker Access - One Month",
      description: "Small locker for tools and personal items.",
      category: "Studio Add-ons",
      priceCents: 500,
      trackInventory: false,
    },
    {
      sku: "GLAZES_TAKE_HOME_SET",
      name: "Glazes (Take Home) - Starter Set",
      description: "Curated glaze selection ready to take home.",
      category: "Glaze Supplies",
      priceCents: 4000,
      trackInventory: true,
      inventoryOnHand: 12,
    },
  ];

  const t = nowTs();
  const refs = sampleProducts.map((product) =>
    db.collection(PRODUCTS_COL).doc(slugify(product.sku))
  );

  const snaps = await db.getAll(...refs);
  const batch = db.batch();
  let created = 0;
  let updated = 0;

  snaps.forEach((snap, index) => {
    const sample = sampleProducts[index];
    const exists = snap.exists;

    const doc = {
      name: sample.name,
      description: sample.description ?? null,
      category: sample.category ?? null,
      sku: sample.sku,
      priceCents: sample.priceCents,
      currency: "USD",
      stripePriceId: null,
      imageUrl: null,
      trackInventory: sample.trackInventory,
      inventoryOnHand: sample.trackInventory ? sample.inventoryOnHand ?? 0 : null,
      inventoryReserved: sample.trackInventory ? 0 : null,
      active: true,
      createdAt: exists ? snap.data()?.createdAt ?? t : t,
      updatedAt: t,
    };

    batch.set(refs[index], doc, { merge: true });

    if (exists) {
      updated += 1;
    } else {
      created += 1;
    }
  });

  await batch.commit();

  res.status(200).json({
    ok: true,
    created,
    updated,
    total: sampleProducts.length,
  });
});

export const createMaterialsCheckoutSession = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;

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

    const rate = enforceRateLimit({
      req,
      key: "materialsCheckout",
      max: 8,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const rawItems = Array.isArray(parsed.data.items) ? parsed.data.items : [];
    const pickupNotes = safeString(parsed.data.pickupNotes).trim();

    const itemMap = new Map<string, number>();
    rawItems.forEach((item: any) => {
      const productId = safeString(item?.productId).trim();
      if (!productId) return;
      const quantity = Math.max(asInt(item?.quantity, 0), 0);
      if (quantity <= 0) return;
      itemMap.set(productId, (itemMap.get(productId) ?? 0) + quantity);
    });

    if (itemMap.size === 0) {
      res.status(400).json({ ok: false, message: "Cart is empty" });
      return;
    }

    const productRefs = Array.from(itemMap.keys()).map((id) =>
      db.collection(PRODUCTS_COL).doc(id)
    );

    try {
      const productSnaps = await db.getAll(...productRefs);
      const productById = new Map<string, MaterialProductDoc>();

      productSnaps.forEach((snap) => {
        if (!snap.exists) return;
        productById.set(snap.id, snap.data() as MaterialProductDoc);
      });

      const missing = Array.from(itemMap.keys()).filter((id) => !productById.has(id));
      if (missing.length) {
        res.status(404).json({
          ok: false,
          message: `Missing products: ${missing.join(", ")}`,
        });
        return;
      }

      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      const orderItems: MaterialOrderItem[] = [];
      let currency = "USD";
      let totalCents = 0;

      for (const [productId, quantity] of itemMap.entries()) {
        const product = productById.get(productId) ?? {};
        if (product.active === false) {
          res.status(400).json({ ok: false, message: `Product inactive: ${productId}` });
          return;
        }

        const name = safeString(product.name).trim();
        if (!name) {
          res.status(400).json({ ok: false, message: `Product missing name: ${productId}` });
          return;
        }

        const priceCents = asInt(product.priceCents, 0);
        if (priceCents <= 0) {
          res.status(400).json({ ok: false, message: `Invalid price for ${name}` });
          return;
        }

        const productCurrency = normalizeCurrency(product.currency);
        if (!currency) currency = productCurrency;
        if (currency !== productCurrency) {
          res.status(400).json({ ok: false, message: "Mixed currencies not supported" });
          return;
        }

        const trackInventory = product.trackInventory === true;
        if (trackInventory) {
          const onHand = asInt(product.inventoryOnHand, 0);
          const reserved = asInt(product.inventoryReserved, 0);
          const available = onHand - reserved;
          if (available < quantity) {
            res.status(409).json({
              ok: false,
              message: `Insufficient inventory for ${name} (available ${Math.max(available, 0)})`,
            });
            return;
          }
        }

        if (product.stripePriceId) {
          lineItems.push({ price: product.stripePriceId, quantity });
        } else {
          const productData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData.ProductData = {
            name,
          };
          if (product.description) productData.description = product.description;
          if (product.imageUrl) productData.images = [product.imageUrl];

          lineItems.push({
            price_data: {
              currency: productCurrency.toLowerCase(),
              unit_amount: priceCents,
              product_data: productData,
            },
            quantity,
          });
        }

        orderItems.push({
          productId,
          name,
          sku: product.sku ?? null,
          quantity,
          unitPrice: priceCents,
          currency: productCurrency,
          trackInventory,
        });

        totalCents += priceCents * quantity;
      }

      const uid = auth.uid;
      let email: string | null = null;
      let displayName: string | null = null;
      try {
        const user = await adminAuth.getUser(uid);
        email = user.email ?? null;
        displayName = user.displayName ?? null;
      } catch {
        // ignore missing user info
      }

      const baseUrl = getPortalBaseUrl(req);
      if (!baseUrl) {
        res.status(500).json({
          ok: false,
          message: "PORTAL_BASE_URL not configured and origin header missing",
        });
        return;
      }

      const orderRef = db.collection(ORDERS_COL).doc();
      const orderId = orderRef.id;

      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: lineItems,
        success_url: `${baseUrl}/materials?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/materials?status=cancel`,
        customer_email: email ?? undefined,
        phone_number_collection: { enabled: true },
        billing_address_collection: "auto",
        automatic_tax: { enabled: true },
        client_reference_id: orderId,
        metadata: {
          orderId,
          uid,
          fulfillment: "pickup",
        },
      });

      const t = nowTs();
      await orderRef.set({
        uid,
        displayName,
        email,
        items: orderItems,
        status: "checkout_pending",
        createdAt: t,
        updatedAt: t,
        totalCents,
        currency,
        stripeSessionId: session.id ?? null,
        stripePaymentIntentId: null,
        checkoutUrl: session.url ?? null,
        pickupNotes: pickupNotes || null,
      });

      res.status(200).json({
        ok: true,
        orderId,
        checkoutUrl: session.url,
      });
    } catch (err: any) {
      logger.error("createMaterialsCheckoutSession failed", err);
      res.status(500).json({ ok: false, message: err?.message ?? String(err) });
    }
  }
);

export const stripeWebhook = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    res.status(400).send("Missing Stripe signature");
    return;
  }

  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!webhookSecret) {
    res.status(500).send("STRIPE_WEBHOOK_SECRET not configured");
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
  } catch (err: any) {
    logger.error("stripeWebhook signature verification failed", err);
    res.status(400).send(`Webhook Error: ${err?.message ?? "Invalid signature"}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.orderId;

    if (!orderId) {
      logger.warn("stripeWebhook missing orderId", { sessionId: session.id });
      res.status(200).json({ ok: true });
      return;
    }

    const orderRef = db.collection(ORDERS_COL).doc(orderId);

    try {
      await db.runTransaction(async (tx) => {
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) {
          logger.warn("stripeWebhook order not found", { orderId });
          return;
        }

        const order = orderSnap.data() as any;
        if (order.status === "paid") return;

        const items = Array.isArray(order.items) ? order.items : [];
        const t = nowTs();

        tx.set(
          orderRef,
          {
            status: "paid",
            updatedAt: t,
            paidAt: t,
            stripePaymentIntentId: session.payment_intent ?? null,
          },
          { merge: true }
        );

        for (const item of items) {
          const productId = safeString(item?.productId).trim();
          const quantity = Math.max(asInt(item?.quantity, 0), 0);
          if (!productId || quantity <= 0) continue;

          const productRef = db.collection(PRODUCTS_COL).doc(productId);
          const productSnap = await tx.get(productRef);
          if (!productSnap.exists) continue;

          const product = productSnap.data() as MaterialProductDoc;
          if (product.trackInventory !== true) continue;

          const onHand = asInt(product.inventoryOnHand, 0);
          const reserved = asInt(product.inventoryReserved, 0);
          const nextOnHand = Math.max(onHand - quantity, 0);

          tx.set(
            productRef,
            {
              inventoryOnHand: nextOnHand,
              inventoryReserved: reserved,
              updatedAt: t,
            },
            { merge: true }
          );
        }
      });
    } catch (err) {
      logger.error("stripeWebhook processing failed", err);
    }
  }

  res.status(200).json({ ok: true });
});
