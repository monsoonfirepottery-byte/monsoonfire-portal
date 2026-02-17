import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  applyCors,
  db,
  enforceRateLimit,
  nowTs,
  parseBody,
  requireAdmin,
  requireAuthUid,
  safeString,
} from "./shared";

const REGION = "us-central1";
const AGENT_CLIENTS_COL = "agentClients";
const AGENT_CLIENT_AUDIT_COL = "agentClientAuditLogs";
const SECURITY_AUDIT_COL = "securityAudit";

const TRUST_TIERS = ["low", "medium", "high"] as const;
const CLIENT_STATUSES = ["active", "suspended", "revoked"] as const;

type TrustTier = (typeof TRUST_TIERS)[number];
type ClientStatus = (typeof CLIENT_STATUSES)[number];

const createAgentClientSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1).max(120)).min(1).max(40),
  trustTier: z.enum(TRUST_TIERS).optional(),
  notes: z.string().max(2000).optional().nullable(),
  rateLimits: z
    .object({
      perMinute: z.number().int().min(1).max(600).optional(),
      perHour: z.number().int().min(1).max(5000).optional(),
    })
    .optional(),
  spendingLimits: z
    .object({
      orderMaxCents: z.number().int().min(100).max(5_000_000).optional(),
      maxOrdersPerHour: z.number().int().min(1).max(2_000).optional(),
    })
    .optional(),
});

const listAgentClientsSchema = z.object({
  includeRevoked: z.boolean().optional(),
  limit: z.number().int().min(1).max(250).optional(),
});

const rotateAgentClientKeySchema = z.object({
  clientId: z.string().min(1).max(120),
  reason: z.string().max(400).optional().nullable(),
});

const updateAgentClientStatusSchema = z.object({
  clientId: z.string().min(1).max(120),
  status: z.enum(CLIENT_STATUSES),
  reason: z.string().max(400).optional().nullable(),
});

const updateAgentClientProfileSchema = z.object({
  clientId: z.string().min(1).max(120),
  name: z.string().min(1).max(120).optional(),
  scopes: z.array(z.string().min(1).max(120)).min(1).max(40).optional(),
  trustTier: z.enum(TRUST_TIERS).optional(),
  notes: z.string().max(2000).optional().nullable(),
  rateLimits: z
    .object({
      perMinute: z.number().int().min(1).max(600).optional(),
      perHour: z.number().int().min(1).max(5000).optional(),
    })
    .optional(),
  spendingLimits: z
    .object({
      orderMaxCents: z.number().int().min(100).max(5_000_000).optional(),
      maxOrdersPerHour: z.number().int().min(1).max(2_000).optional(),
    })
    .optional(),
});

const listAgentClientAuditSchema = z.object({
  clientId: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const clearAgentClientCooldownSchema = z.object({
  clientId: z.string().min(1).max(120),
  reason: z.string().max(400).optional().nullable(),
});

function readPepper(): string {
  const raw = (process.env.AGENT_CLIENT_KEY_PEPPER ?? "").trim();
  if (!raw) throw new Error("AGENT_CLIENT_KEY_PEPPER not configured");
  return raw;
}

function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function normalizeScopes(input: string[]): string[] {
  const set = new Set<string>();
  for (const value of input) {
    const trimmed = value.trim();
    if (trimmed.length) set.add(trimmed);
  }
  return [...set];
}

function hashSecret(secret: string): string {
  return createHmac("sha256", readPepper()).update(secret).digest("hex");
}

function makeApiKey(clientId: string, secret: string): string {
  return `mf_agent_v1.${clientId}.${secret}`;
}

function summarizeClient(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: safeString(row.id),
    ownerUid: safeString(row.ownerUid),
    name: safeString(row.name),
    status: safeString(row.status),
    trustTier: safeString(row.trustTier),
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((entry) => typeof entry === "string") : [],
    notes: typeof row.notes === "string" ? row.notes : null,
    keyPrefix: typeof row.keyPrefix === "string" ? row.keyPrefix : null,
    keyLast4: typeof row.keyLast4 === "string" ? row.keyLast4 : null,
    keyVersion: typeof row.keyVersion === "number" ? row.keyVersion : 1,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
    rotatedAt: row.rotatedAt ?? null,
    revokedAt: row.revokedAt ?? null,
    createdByUid: typeof row.createdByUid === "string" ? row.createdByUid : null,
    updatedByUid: typeof row.updatedByUid === "string" ? row.updatedByUid : null,
    cooldownUntil: row.cooldownUntil ?? null,
    cooldownReason: typeof row.cooldownReason === "string" ? row.cooldownReason : null,
    rateLimits:
      row.rateLimits && typeof row.rateLimits === "object"
        ? {
            perMinute:
              typeof (row.rateLimits as { perMinute?: unknown }).perMinute === "number"
                ? (row.rateLimits as { perMinute: number }).perMinute
                : 60,
            perHour:
              typeof (row.rateLimits as { perHour?: unknown }).perHour === "number"
                ? (row.rateLimits as { perHour: number }).perHour
                : 600,
          }
        : { perMinute: 60, perHour: 600 },
    spendingLimits:
      row.spendingLimits && typeof row.spendingLimits === "object"
        ? {
            orderMaxCents:
              typeof (row.spendingLimits as { orderMaxCents?: unknown }).orderMaxCents === "number"
                ? (row.spendingLimits as { orderMaxCents: number }).orderMaxCents
                : 75_000,
            maxOrdersPerHour:
              typeof (row.spendingLimits as { maxOrdersPerHour?: unknown }).maxOrdersPerHour === "number"
                ? (row.spendingLimits as { maxOrdersPerHour: number }).maxOrdersPerHour
                : 30,
          }
        : { orderMaxCents: 75_000, maxOrdersPerHour: 30 },
  };
}

async function writeAudit(params: {
  actorUid: string;
  action: string;
  clientId: string | null;
  metadata?: Record<string, unknown>;
}) {
  await db.collection(AGENT_CLIENT_AUDIT_COL).add({
    actorUid: params.actorUid,
    action: params.action,
    clientId: params.clientId,
    metadata: params.metadata ?? null,
    createdAt: nowTs(),
  });
}

function generateClientCredentials() {
  const clientId = toBase64Url(randomBytes(12));
  const secret = toBase64Url(randomBytes(32));
  const keyHash = hashSecret(secret);
  const keyPrefix = secret.slice(0, 6);
  const keyLast4 = secret.slice(-4);
  const apiKey = makeApiKey(clientId, secret);
  return { clientId, secret, keyHash, keyPrefix, keyLast4, apiKey };
}

export function verifyAgentClientSecret(secret: string, expectedHash: string): boolean {
  const gotHash = hashSecret(secret);
  const expected = Buffer.from(expectedHash, "hex");
  const got = Buffer.from(gotHash, "hex");
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

export const staffCreateAgentClient = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const parsed = parseBody(createAgentClientSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({ req, key: "staffCreateAgentClient", max: 10, windowMs: 60_000 });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  try {
    const scopes = normalizeScopes(parsed.data.scopes);
    if (scopes.length < 1) {
      res.status(400).json({ ok: false, message: "At least one scope is required." });
      return;
    }

    const credentials = generateClientCredentials();
    const now = nowTs();
    const rateLimits = {
      perMinute: parsed.data.rateLimits?.perMinute ?? 60,
      perHour: parsed.data.rateLimits?.perHour ?? 600,
    };
    const spendingLimits = {
      orderMaxCents: parsed.data.spendingLimits?.orderMaxCents ?? 75_000,
      maxOrdersPerHour: parsed.data.spendingLimits?.maxOrdersPerHour ?? 30,
    };

    const payload = {
      ownerUid: auth.uid,
      name: parsed.data.name.trim(),
      status: "active" as ClientStatus,
      trustTier: parsed.data.trustTier ?? ("medium" as TrustTier),
      scopes,
      notes: parsed.data.notes?.trim() || null,
      rateLimits,
      spendingLimits,
      keyHash: credentials.keyHash,
      keyPrefix: credentials.keyPrefix,
      keyLast4: credentials.keyLast4,
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
      rotatedAt: now,
      revokedAt: null,
      lastUsedAt: null,
      createdByUid: auth.uid,
      updatedByUid: auth.uid,
    };

    await db.collection(AGENT_CLIENTS_COL).doc(credentials.clientId).set(payload, { merge: false });

    await writeAudit({
      actorUid: auth.uid,
      action: "create_agent_client",
      clientId: credentials.clientId,
      metadata: {
        status: "active",
        trustTier: payload.trustTier,
        scopesCount: scopes.length,
      },
    });

    res.status(200).json({
      ok: true,
      client: summarizeClient({ id: credentials.clientId, ...payload }),
      apiKey: credentials.apiKey,
      warning: "Store this key now. It is not retrievable later.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, message });
  }
});

export const staffListAgentClients = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const parsed = parseBody(listAgentClientsSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const includeRevoked = parsed.data.includeRevoked === true;
  const limit = parsed.data.limit ?? 120;

  const snap = await db.collection(AGENT_CLIENTS_COL).limit(limit).get();
  let clients = snap.docs.map((docSnap) => summarizeClient({ id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) }));
  if (!includeRevoked) {
    clients = clients.filter((entry) => safeString(entry.status) !== "revoked");
  }

  clients.sort((a, b) => {
    const aMs = Number(((a.updatedAt as { seconds?: unknown } | null)?.seconds ?? 0));
    const bMs = Number(((b.updatedAt as { seconds?: unknown } | null)?.seconds ?? 0));
    return bMs - aMs;
  });

  await writeAudit({
    actorUid: auth.uid,
    action: "list_agent_clients",
    clientId: null,
    metadata: { includeRevoked, limit, returned: clients.length },
  });

  res.status(200).json({ ok: true, clients });
});

export const staffRotateAgentClientKey = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const parsed = parseBody(rotateAgentClientKeySchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const clientId = parsed.data.clientId.trim();
  const ref = db.collection(AGENT_CLIENTS_COL).doc(clientId);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ ok: false, message: "Agent client not found." });
    return;
  }

  const data = snap.data() as Record<string, unknown>;
  const status = safeString(data.status, "active") as ClientStatus;
  if (status === "revoked") {
    res.status(400).json({ ok: false, message: "Cannot rotate key for revoked client." });
    return;
  }

  const secret = toBase64Url(randomBytes(32));
  const keyHash = hashSecret(secret);
  const keyPrefix = secret.slice(0, 6);
  const keyLast4 = secret.slice(-4);
  const keyVersion = (typeof data.keyVersion === "number" ? data.keyVersion : 1) + 1;
  const now = nowTs();

  await ref.set(
    {
      keyHash,
      keyPrefix,
      keyLast4,
      keyVersion,
      rotatedAt: now,
      updatedAt: now,
      updatedByUid: auth.uid,
    },
    { merge: true }
  );

  await writeAudit({
    actorUid: auth.uid,
    action: "rotate_agent_client_key",
    clientId,
    metadata: {
      keyVersion,
      reason: parsed.data.reason?.trim() || null,
    },
  });

  const next = { ...data, keyPrefix, keyLast4, keyVersion, rotatedAt: now, updatedAt: now, updatedByUid: auth.uid, id: clientId };
  res.status(200).json({
    ok: true,
    client: summarizeClient(next),
    apiKey: makeApiKey(clientId, secret),
    warning: "Store this key now. It is not retrievable later.",
  });
});

export const staffUpdateAgentClientStatus = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const parsed = parseBody(updateAgentClientStatusSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const clientId = parsed.data.clientId.trim();
  const ref = db.collection(AGENT_CLIENTS_COL).doc(clientId);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ ok: false, message: "Agent client not found." });
    return;
  }

  const now = nowTs();
  await ref.set(
    {
      status: parsed.data.status,
      revokedAt: parsed.data.status === "revoked" ? now : null,
      updatedAt: now,
      updatedByUid: auth.uid,
    },
    { merge: true }
  );

  await writeAudit({
    actorUid: auth.uid,
    action: "update_agent_client_status",
    clientId,
    metadata: {
      status: parsed.data.status,
      reason: parsed.data.reason?.trim() || null,
    },
  });

  const next = {
    id: clientId,
    ...(snap.data() as Record<string, unknown>),
    status: parsed.data.status,
    revokedAt: parsed.data.status === "revoked" ? now : null,
    updatedAt: now,
    updatedByUid: auth.uid,
  };

  res.status(200).json({ ok: true, client: summarizeClient(next) });
});

export const staffUpdateAgentClientProfile = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const parsed = parseBody(updateAgentClientProfileSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const clientId = parsed.data.clientId.trim();
  const ref = db.collection(AGENT_CLIENTS_COL).doc(clientId);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ ok: false, message: "Agent client not found." });
    return;
  }

  const patch: Record<string, unknown> = {
    updatedAt: nowTs(),
    updatedByUid: auth.uid,
  };

  if (typeof parsed.data.name === "string") patch.name = parsed.data.name.trim();
  if (Array.isArray(parsed.data.scopes)) {
    const scopes = normalizeScopes(parsed.data.scopes);
    if (!scopes.length) {
      res.status(400).json({ ok: false, message: "At least one scope is required." });
      return;
    }
    patch.scopes = scopes;
  }
  if (parsed.data.trustTier) patch.trustTier = parsed.data.trustTier;
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes?.trim() || null;
  if (parsed.data.rateLimits) {
    patch.rateLimits = {
      perMinute: parsed.data.rateLimits.perMinute ?? 60,
      perHour: parsed.data.rateLimits.perHour ?? 600,
    };
  }
  if (parsed.data.spendingLimits) {
    patch.spendingLimits = {
      orderMaxCents: parsed.data.spendingLimits.orderMaxCents ?? 75_000,
      maxOrdersPerHour: parsed.data.spendingLimits.maxOrdersPerHour ?? 30,
    };
  }

  await ref.set(patch, { merge: true });

  await writeAudit({
    actorUid: auth.uid,
    action: "update_agent_client_profile",
    clientId,
    metadata: {
      changedFields: Object.keys(patch),
    },
  });

  const fresh = await ref.get();
  res.status(200).json({ ok: true, client: summarizeClient({ id: fresh.id, ...(fresh.data() as Record<string, unknown>) }) });
});

export const staffListAgentClientAuditLogs = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const parsed = parseBody(listAgentClientAuditSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const limit = parsed.data.limit ?? 80;
  const clientId = parsed.data.clientId?.trim() || "";

  const snap = await db.collection(AGENT_CLIENT_AUDIT_COL).limit(limit).get();
  let logs: Array<Record<string, unknown>> = snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Record<string, unknown>),
  }));

  const securitySnap = await db.collection(SECURITY_AUDIT_COL).limit(Math.max(limit * 2, 120)).get();
  const securityLogs: Array<Record<string, unknown>> = securitySnap.docs
    .map((docSnap) => {
      const row = docSnap.data() as Record<string, unknown>;
      const mode = safeString(row.mode);
      const tokenId = safeString(row.tokenId);
      const metadata = (row.metadata as Record<string, unknown> | undefined) ?? {};
      const agentClientId = safeString(metadata.agentClientId);
      if (mode !== "delegated" && !agentClientId) return null;
      const resolvedClientId = mode === "delegated" ? tokenId : agentClientId;
      if (!resolvedClientId) return null;
      return {
        id: `security_${docSnap.id}`,
        actorUid: safeString(row.uid),
        action: `security_${safeString(row.type, "event")}`,
        clientId: resolvedClientId,
        createdAt: row.at ?? null,
        metadata: {
          ...(metadata ?? {}),
          source: "securityAudit",
          outcome: safeString(row.outcome),
          code: safeString(row.code),
          mode,
          requestId: safeString(row.requestId),
          path: safeString(row.path),
          ipHash: safeString(row.ipHash),
        },
      } as Record<string, unknown>;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  logs = [...logs, ...securityLogs];

  if (clientId) {
    logs = logs.filter((entry) => safeString(entry.clientId) === clientId);
  }

  logs.sort((a, b) => {
    const aSec = Number(((a.createdAt as { seconds?: unknown } | undefined)?.seconds ?? 0));
    const bSec = Number(((b.createdAt as { seconds?: unknown } | undefined)?.seconds ?? 0));
    return bSec - aSec;
  });

  res.status(200).json({ ok: true, logs: logs.slice(0, limit) });
});

export const staffClearAgentClientCooldown = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const parsed = parseBody(clearAgentClientCooldownSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const clientId = parsed.data.clientId.trim();
  const ref = db.collection(AGENT_CLIENTS_COL).doc(clientId);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ ok: false, message: "Agent client not found." });
    return;
  }

  const now = nowTs();
  await ref.set(
    {
      status: "active",
      cooldownUntil: null,
      cooldownReason: null,
      updatedAt: now,
      updatedByUid: auth.uid,
    },
    { merge: true }
  );

  await writeAudit({
    actorUid: auth.uid,
    action: "clear_agent_client_cooldown",
    clientId,
    metadata: {
      reason: parsed.data.reason?.trim() || null,
    },
  });

  const fresh = await ref.get();
  res.status(200).json({
    ok: true,
    client: summarizeClient({ id: fresh.id, ...(fresh.data() as Record<string, unknown>) }),
  });
});
