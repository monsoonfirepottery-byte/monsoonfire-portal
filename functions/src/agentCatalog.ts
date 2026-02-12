import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  applyCors,
  db,
  nowTs,
  parseBody,
  requireAdmin,
  requireAuthContext,
  requireAuthUid,
  safeString,
} from "./shared";

const REGION = "us-central1";
const CATALOG_CONFIG_PATH = "config/agentServiceCatalog";
const CATALOG_AUDIT_COL = "agentServiceCatalogAuditLogs";

const CATEGORY_VALUES = ["kiln", "consult", "x1c", "other"] as const;
const RISK_VALUES = ["low", "medium", "high"] as const;
const PRICING_MODE_VALUES = ["test", "live"] as const;

export type AgentServiceCatalogItem = {
  id: string;
  title: string;
  category: (typeof CATEGORY_VALUES)[number];
  enabled: boolean;
  basePriceCents: number;
  currency: string;
  priceId: string | null;
  productId: string | null;
  leadTimeDays: number;
  maxQuantity: number;
  riskLevel: (typeof RISK_VALUES)[number];
  requiresManualReview: boolean;
  notes: string | null;
};

export type AgentServiceCatalogConfig = {
  pricingMode: (typeof PRICING_MODE_VALUES)[number];
  defaultCurrency: string;
  featureFlags: {
    quoteEnabled: boolean;
    reserveEnabled: boolean;
    payEnabled: boolean;
    statusEnabled: boolean;
  };
  services: AgentServiceCatalogItem[];
  updatedAt: FirebaseFirestore.Timestamp | null;
  updatedByUid: string | null;
};

const serviceSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  category: z.enum(CATEGORY_VALUES),
  enabled: z.boolean(),
  basePriceCents: z.number().int().min(0).max(50_000_000),
  currency: z.string().min(3).max(8).optional(),
  priceId: z.string().max(120).optional().nullable(),
  productId: z.string().max(120).optional().nullable(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  maxQuantity: z.number().int().min(1).max(10_000).optional(),
  riskLevel: z.enum(RISK_VALUES).optional(),
  requiresManualReview: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
});

const staffUpdateCatalogSchema = z.object({
  pricingMode: z.enum(PRICING_MODE_VALUES).optional(),
  defaultCurrency: z.string().min(3).max(8).optional(),
  featureFlags: z
    .object({
      quoteEnabled: z.boolean().optional(),
      reserveEnabled: z.boolean().optional(),
      payEnabled: z.boolean().optional(),
      statusEnabled: z.boolean().optional(),
    })
    .optional(),
  services: z.array(serviceSchema).max(200).optional(),
});

const listCatalogSchema = z.object({
  includeDisabled: z.boolean().optional(),
});

function normalizeService(row: Record<string, unknown>): AgentServiceCatalogItem {
  return {
    id: safeString(row.id).trim(),
    title: safeString(row.title).trim(),
    category: (safeString(row.category, "other") as AgentServiceCatalogItem["category"]),
    enabled: row.enabled === true,
    basePriceCents:
      typeof row.basePriceCents === "number" && Number.isFinite(row.basePriceCents)
        ? Math.max(0, Math.trunc(row.basePriceCents))
        : 0,
    currency: safeString(row.currency || "USD", "USD").trim().toUpperCase(),
    priceId: safeString(row.priceId).trim() || null,
    productId: safeString(row.productId).trim() || null,
    leadTimeDays:
      typeof row.leadTimeDays === "number" && Number.isFinite(row.leadTimeDays)
        ? Math.max(0, Math.trunc(row.leadTimeDays))
        : 0,
    maxQuantity:
      typeof row.maxQuantity === "number" && Number.isFinite(row.maxQuantity)
        ? Math.max(1, Math.trunc(row.maxQuantity))
        : 1,
    riskLevel: (safeString(row.riskLevel, "medium") as AgentServiceCatalogItem["riskLevel"]),
    requiresManualReview: row.requiresManualReview === true,
    notes: safeString(row.notes).trim() || null,
  };
}

function uniqueById(items: AgentServiceCatalogItem[]): AgentServiceCatalogItem[] {
  const byId = new Map<string, AgentServiceCatalogItem>();
  for (const item of items) {
    if (!item.id) continue;
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function buildDefaultCatalog(): AgentServiceCatalogConfig {
  return {
    pricingMode: "test",
    defaultCurrency: "USD",
    featureFlags: {
      quoteEnabled: true,
      reserveEnabled: true,
      payEnabled: true,
      statusEnabled: true,
    },
    services: [
      {
        id: "kiln-bisque-half-shelf",
        title: "Bisque Firing · Half Shelf",
        category: "kiln",
        enabled: true,
        basePriceCents: 4500,
        currency: "USD",
        priceId: null,
        productId: null,
        leadTimeDays: 7,
        maxQuantity: 4,
        riskLevel: "medium",
        requiresManualReview: false,
        notes: "Standard cone profile."
      },
      {
        id: "expert-glaze-consult-30m",
        title: "Expert Glaze Consult · 30 min",
        category: "consult",
        enabled: true,
        basePriceCents: 8000,
        currency: "USD",
        priceId: null,
        productId: null,
        leadTimeDays: 3,
        maxQuantity: 2,
        riskLevel: "low",
        requiresManualReview: false,
        notes: "Bounded advisory package."
      },
      {
        id: "x1c-print-small-batch",
        title: "X1C Print Job · Small Batch",
        category: "x1c",
        enabled: true,
        basePriceCents: 6500,
        currency: "USD",
        priceId: null,
        productId: null,
        leadTimeDays: 5,
        maxQuantity: 10,
        riskLevel: "high",
        requiresManualReview: true,
        notes: "Validation required for files/material profile."
      },
    ],
    updatedAt: null,
    updatedByUid: null,
  };
}

export async function getAgentServiceCatalogConfig(): Promise<AgentServiceCatalogConfig> {
  const snap = await db.doc(CATALOG_CONFIG_PATH).get();
  if (!snap.exists) {
    const defaults = buildDefaultCatalog();
    await db.doc(CATALOG_CONFIG_PATH).set(
      {
        pricingMode: defaults.pricingMode,
        defaultCurrency: defaults.defaultCurrency,
        featureFlags: defaults.featureFlags,
        services: defaults.services,
        createdAt: nowTs(),
        updatedAt: nowTs(),
      },
      { merge: true }
    );
    return {
      ...defaults,
      updatedAt: nowTs(),
    };
  }

  const data = snap.data() as Record<string, unknown>;
  const servicesRaw = Array.isArray(data.services)
    ? data.services.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    : [];

  const services = uniqueById(servicesRaw.map((entry) => normalizeService(entry))).sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  return {
    pricingMode: (safeString(data.pricingMode, "test") as AgentServiceCatalogConfig["pricingMode"]),
    defaultCurrency: safeString(data.defaultCurrency, "USD").toUpperCase(),
    featureFlags: {
      quoteEnabled:
        (data.featureFlags as { quoteEnabled?: unknown } | undefined)?.quoteEnabled !== false,
      reserveEnabled:
        (data.featureFlags as { reserveEnabled?: unknown } | undefined)?.reserveEnabled !== false,
      payEnabled: (data.featureFlags as { payEnabled?: unknown } | undefined)?.payEnabled !== false,
      statusEnabled:
        (data.featureFlags as { statusEnabled?: unknown } | undefined)?.statusEnabled !== false,
    },
    services,
    updatedAt:
      data.updatedAt && typeof data.updatedAt === "object" ? (data.updatedAt as FirebaseFirestore.Timestamp) : null,
    updatedByUid: safeString(data.updatedByUid) || null,
  };
}

async function writeCatalogAudit(params: {
  actorUid: string;
  action: string;
  metadata?: Record<string, unknown>;
}) {
  await db.collection(CATALOG_AUDIT_COL).add({
    actorUid: params.actorUid,
    action: params.action,
    metadata: params.metadata ?? null,
    createdAt: nowTs(),
  });
}

export const staffGetAgentServiceCatalog = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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
    res.status(403).json({ ok: false, message: admin.message });
    return;
  }

  const config = await getAgentServiceCatalogConfig();
  const auditSnap = await db.collection(CATALOG_AUDIT_COL).limit(40).get();
  const auditRows: Array<Record<string, unknown>> = auditSnap.docs.map((docSnap) => {
    const row = docSnap.data() as Record<string, unknown>;
    return { id: docSnap.id, ...row };
  });
  const audit = auditRows
    .sort((a, b) => {
      const aSec = Number((((a["createdAt"] as { seconds?: unknown } | undefined)?.seconds) ?? 0));
      const bSec = Number((((b["createdAt"] as { seconds?: unknown } | undefined)?.seconds) ?? 0));
      return bSec - aSec;
    })
    .slice(0, 20);

  await writeCatalogAudit({
    actorUid: auth.uid,
    action: "read_agent_service_catalog",
    metadata: { servicesCount: config.services.length },
  });

  res.status(200).json({ ok: true, config, audit });
});

export const staffUpdateAgentServiceCatalog = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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
    res.status(403).json({ ok: false, message: admin.message });
    return;
  }

  const parsed = parseBody(staffUpdateCatalogSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const current = await getAgentServiceCatalogConfig();
  const patch = parsed.data;

  const nextPricingMode = patch.pricingMode ?? current.pricingMode;
  const nextDefaultCurrency = (patch.defaultCurrency ?? current.defaultCurrency).toUpperCase();
  const nextFeatureFlags = {
    quoteEnabled: patch.featureFlags?.quoteEnabled ?? current.featureFlags.quoteEnabled,
    reserveEnabled: patch.featureFlags?.reserveEnabled ?? current.featureFlags.reserveEnabled,
    payEnabled: patch.featureFlags?.payEnabled ?? current.featureFlags.payEnabled,
    statusEnabled: patch.featureFlags?.statusEnabled ?? current.featureFlags.statusEnabled,
  };

  const nextServices = patch.services
    ? uniqueById(patch.services.map((entry) => normalizeService(entry as unknown as Record<string, unknown>))).sort((a, b) =>
        a.id.localeCompare(b.id)
      )
    : current.services;

  await db.doc(CATALOG_CONFIG_PATH).set(
    {
      pricingMode: nextPricingMode,
      defaultCurrency: nextDefaultCurrency,
      featureFlags: nextFeatureFlags,
      services: nextServices,
      updatedAt: nowTs(),
      updatedByUid: auth.uid,
    },
    { merge: true }
  );

  await writeCatalogAudit({
    actorUid: auth.uid,
    action: "update_agent_service_catalog",
    metadata: {
      pricingMode: nextPricingMode,
      defaultCurrency: nextDefaultCurrency,
      servicesCount: nextServices.length,
      featureFlags: nextFeatureFlags,
    },
  });

  const refreshed = await getAgentServiceCatalogConfig();
  res.status(200).json({ ok: true, config: refreshed });
});

export const getAgentServiceCatalog = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Use POST" });
    return;
  }

  const auth = await requireAuthContext(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const parsed = parseBody(listCatalogSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const config = await getAgentServiceCatalogConfig();
  const includeDisabled = parsed.data.includeDisabled === true;
  const services = includeDisabled ? config.services : config.services.filter((entry) => entry.enabled);

  res.status(200).json({
    ok: true,
    pricingMode: config.pricingMode,
    defaultCurrency: config.defaultCurrency,
    featureFlags: config.featureFlags,
    services,
    updatedAt: config.updatedAt,
  });
});
