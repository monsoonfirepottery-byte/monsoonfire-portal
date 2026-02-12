import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCors, db, nowTs, parseBody, requireAdmin, requireAuthUid, safeString } from "./shared";

const REGION = "us-central1";
const POLICY_CONFIG_PATH = "config/moderationPolicy";
const POLICY_VERSIONS_COL = "moderationPolicyVersions";
const POLICY_AUDIT_COL = "moderationPolicyAuditLogs";

const ruleSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(1200),
  severityHint: z.enum(["low", "medium", "high"]).optional().nullable(),
});

const upsertPolicySchema = z.object({
  version: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  summary: z.string().max(1200).optional().nullable(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  rules: z.array(ruleSchema).min(1).max(80),
});

const publishPolicySchema = z.object({
  version: z.string().min(1).max(80),
});

const listPoliciesSchema = z.object({
  includeArchived: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

async function writePolicyAudit(params: {
  actorUid: string;
  action: "upsert_policy" | "publish_policy" | "list_policies" | "read_current_policy";
  version?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await db.collection(POLICY_AUDIT_COL).add({
    actorUid: params.actorUid,
    action: params.action,
    version: params.version ?? null,
    metadata: params.metadata ?? null,
    createdAt: nowTs(),
  });
}

function normalizeRuleIds(rules: Array<{ id: string }>): string[] {
  return rules.map((rule) => safeString(rule.id).trim().toLowerCase());
}

export const getModerationPolicyCurrent = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const configSnap = await db.doc(POLICY_CONFIG_PATH).get();
  const activeVersion = safeString(configSnap.data()?.activeVersion);
  if (!activeVersion) {
    res.status(200).json({ ok: true, policy: null });
    return;
  }

  const versionSnap = await db.collection(POLICY_VERSIONS_COL).doc(activeVersion).get();
  if (!versionSnap.exists) {
    res.status(200).json({ ok: true, policy: null });
    return;
  }

  const policy = {
    id: versionSnap.id,
    ...(versionSnap.data() as Record<string, unknown>),
  };

  await writePolicyAudit({
    actorUid: auth.uid,
    action: "read_current_policy",
    version: activeVersion,
  });

  res.status(200).json({ ok: true, policy });
});

export const listModerationPolicies = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
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

  const parsed = parseBody(listPoliciesSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const { includeArchived = false, limit = 40 } = parsed.data;
  const snap = await db.collection(POLICY_VERSIONS_COL).orderBy("updatedAt", "desc").limit(limit).get();
  const policies = snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) }))
    .filter((row) => {
      const record = row as Record<string, unknown>;
      return includeArchived || safeString(record.status) !== "archived";
    });

  const configSnap = await db.doc(POLICY_CONFIG_PATH).get();
  const activeVersion = safeString(configSnap.data()?.activeVersion);

  await writePolicyAudit({
    actorUid: auth.uid,
    action: "list_policies",
    version: activeVersion || null,
    metadata: { includeArchived, limit },
  });

  res.status(200).json({ ok: true, activeVersion: activeVersion || null, policies });
});

export const staffUpsertModerationPolicy = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
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

  const parsed = parseBody(upsertPolicySchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const { version, title, summary, status = "draft", rules } = parsed.data;
  const normalizedRuleIds = normalizeRuleIds(rules);
  if (new Set(normalizedRuleIds).size !== normalizedRuleIds.length) {
    res.status(400).json({ ok: false, message: "Rule IDs must be unique." });
    return;
  }

  const policyRef = db.collection(POLICY_VERSIONS_COL).doc(version);
  const existing = await policyRef.get();
  const now = nowTs();

  await policyRef.set(
    {
      version,
      title,
      summary: safeString(summary) || null,
      status,
      rules: rules.map((rule) => ({
        id: safeString(rule.id).trim(),
        title: safeString(rule.title).trim(),
        description: safeString(rule.description).trim(),
        severityHint: safeString(rule.severityHint) || null,
      })),
      updatedAt: now,
      updatedBy: auth.uid,
      createdAt: existing.exists ? existing.data()?.createdAt ?? now : now,
      createdBy: existing.exists ? existing.data()?.createdBy ?? auth.uid : auth.uid,
    },
    { merge: true }
  );

  await writePolicyAudit({
    actorUid: auth.uid,
    action: "upsert_policy",
    version,
    metadata: { status, rulesCount: rules.length },
  });

  res.status(200).json({ ok: true, version });
});

export const staffPublishModerationPolicy = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
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

  const parsed = parseBody(publishPolicySchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const { version } = parsed.data;
  const policyRef = db.collection(POLICY_VERSIONS_COL).doc(version);
  const policySnap = await policyRef.get();
  if (!policySnap.exists) {
    res.status(404).json({ ok: false, message: "Policy version not found" });
    return;
  }

  const policyData = policySnap.data() as Record<string, unknown>;
  const rules = Array.isArray(policyData.rules) ? policyData.rules : [];
  if (!rules.length) {
    res.status(400).json({ ok: false, message: "Policy must include at least one rule before publishing." });
    return;
  }

  const now = nowTs();
  await db.runTransaction(async (tx) => {
    tx.set(
      db.doc(POLICY_CONFIG_PATH),
      {
        activeVersion: version,
        publishedAt: now,
        updatedAt: now,
        updatedBy: auth.uid,
      },
      { merge: true }
    );
    tx.set(
      policyRef,
      {
        status: "published",
        publishedAt: now,
        updatedAt: now,
        updatedBy: auth.uid,
      },
      { merge: true }
    );
  });

  await writePolicyAudit({
    actorUid: auth.uid,
    action: "publish_policy",
    version,
    metadata: { rulesCount: rules.length },
  });

  res.status(200).json({ ok: true, activeVersion: version });
});
