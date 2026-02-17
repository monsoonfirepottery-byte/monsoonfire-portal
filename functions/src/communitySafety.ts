import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCors, db, nowTs, parseBody, requireAdmin, requireAuthUid, safeString } from "./shared";

const REGION = "us-central1";
const COMMUNITY_SAFETY_CONFIG_PATH = "config/communitySafety";
const COMMUNITY_SAFETY_AUDIT_COL = "communitySafetyAuditLogs";

const DEFAULT_BLOCKED_TERMS = ["scam", "counterfeit", "violent threat", "hate group", "doxx"];
const DEFAULT_BLOCKED_URL_HOSTS = ["tinyurl.com", "bit.ly", "t.co"];
const BUILT_IN_HIGH_RISK_PHRASES = ["kill", "shoot", "bomb", "attack", "lynch"];

type CommunitySafetySeverity = "low" | "medium" | "high";

export type CommunitySafetyConfig = {
  enabled: boolean;
  publishKillSwitch: boolean;
  autoFlagEnabled: boolean;
  highSeverityThreshold: number;
  mediumSeverityThreshold: number;
  blockedTerms: string[];
  blockedUrlHosts: string[];
  updatedAtMs: number;
  updatedBy: string | null;
};

type ScanInput = {
  textFields: Array<{ field: string; text: string }>;
  explicitUrls?: string[];
};

type ScanTrigger = {
  type: "blocked_term" | "high_risk_phrase" | "blocked_url_host" | "link_volume";
  field: string;
  value: string;
  scoreDelta: number;
};

export type CommunityRiskResult = {
  score: number;
  severity: CommunitySafetySeverity;
  flagged: boolean;
  triggers: ScanTrigger[];
  inspectedUrlCount: number;
};

const updateCommunitySafetySchema = z.object({
  enabled: z.boolean().optional(),
  publishKillSwitch: z.boolean().optional(),
  autoFlagEnabled: z.boolean().optional(),
  highSeverityThreshold: z.number().int().min(1).max(100).optional(),
  mediumSeverityThreshold: z.number().int().min(1).max(100).optional(),
  blockedTerms: z.array(z.string().min(1).max(80)).max(120).optional(),
  blockedUrlHosts: z.array(z.string().min(1).max(120)).max(120).optional(),
});

const staffScanDraftSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  summary: z.string().max(1000).optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
  policyCopy: z.string().max(2000).optional().nullable(),
  location: z.string().max(240).optional().nullable(),
  urls: z.array(z.string().url()).max(100).optional(),
});

function toLowerList(values: string[]): string[] {
  return values
    .map((entry) => safeString(entry).trim().toLowerCase())
    .filter((entry, index, arr) => entry.length > 0 && arr.indexOf(entry) === index);
}

function parseUrlHost(input: string): string | null {
  try {
    const url = new URL(input);
    return safeString(url.hostname).trim().toLowerCase();
  } catch {
    return null;
  }
}

function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)]+/gi);
  if (!matches) return [];
  return matches.map((entry) => entry.trim());
}

function mergeConfig(data: Record<string, unknown> | undefined): CommunitySafetyConfig {
  const blockedTermsRaw = Array.isArray(data?.blockedTerms)
    ? (data?.blockedTerms as unknown[]).map((entry) => safeString(entry)).filter(Boolean)
    : DEFAULT_BLOCKED_TERMS;
  const blockedHostsRaw = Array.isArray(data?.blockedUrlHosts)
    ? (data?.blockedUrlHosts as unknown[]).map((entry) => safeString(entry)).filter(Boolean)
    : DEFAULT_BLOCKED_URL_HOSTS;

  const highSeverityThreshold =
    typeof data?.highSeverityThreshold === "number" && Number.isFinite(data.highSeverityThreshold)
      ? Math.max(1, Math.min(100, Math.trunc(data.highSeverityThreshold)))
      : 70;
  const mediumSeverityThreshold =
    typeof data?.mediumSeverityThreshold === "number" && Number.isFinite(data.mediumSeverityThreshold)
      ? Math.max(1, Math.min(100, Math.trunc(data.mediumSeverityThreshold)))
      : 35;

  return {
    enabled: data?.enabled !== false,
    publishKillSwitch: data?.publishKillSwitch === true,
    autoFlagEnabled: data?.autoFlagEnabled !== false,
    highSeverityThreshold,
    mediumSeverityThreshold: Math.min(mediumSeverityThreshold, highSeverityThreshold - 1),
    blockedTerms: toLowerList(blockedTermsRaw),
    blockedUrlHosts: toLowerList(blockedHostsRaw),
    updatedAtMs: typeof data?.updatedAtMs === "number" ? data.updatedAtMs : 0,
    updatedBy: safeString(data?.updatedBy) || null,
  };
}

async function writeSafetyAudit(params: {
  actorUid: string;
  action: "get_safety_config" | "update_safety_config" | "scan_draft";
  metadata?: Record<string, unknown>;
}) {
  await db.collection(COMMUNITY_SAFETY_AUDIT_COL).add({
    actorUid: params.actorUid,
    action: params.action,
    metadata: params.metadata ?? null,
    createdAt: nowTs(),
  });
}

export async function getCommunitySafetyConfig(): Promise<CommunitySafetyConfig> {
  const snap = await db.doc(COMMUNITY_SAFETY_CONFIG_PATH).get();
  return mergeConfig((snap.data() as Record<string, unknown> | undefined) ?? undefined);
}

export function evaluateCommunityContentRisk(input: ScanInput, config: CommunitySafetyConfig): CommunityRiskResult {
  if (!config.enabled) {
    return {
      score: 0,
      severity: "low",
      flagged: false,
      triggers: [],
      inspectedUrlCount: 0,
    };
  }

  const triggers: ScanTrigger[] = [];
  let score = 0;

  const blockedTerms = new Set(config.blockedTerms);
  const blockedHosts = new Set(config.blockedUrlHosts);

  const urls = new Set<string>();
  input.textFields.forEach((entry) => {
    extractUrlsFromText(entry.text).forEach((url) => urls.add(url));
  });
  (input.explicitUrls ?? []).forEach((url) => urls.add(url));

  input.textFields.forEach((entry) => {
    const text = safeString(entry.text).toLowerCase();
    if (!text) return;

    blockedTerms.forEach((term) => {
      if (term && text.includes(term)) {
        triggers.push({ type: "blocked_term", field: entry.field, value: term, scoreDelta: 30 });
        score += 30;
      }
    });

    BUILT_IN_HIGH_RISK_PHRASES.forEach((phrase) => {
      if (text.includes(phrase)) {
        triggers.push({ type: "high_risk_phrase", field: entry.field, value: phrase, scoreDelta: 60 });
        score += 60;
      }
    });
  });

  const urlList = Array.from(urls);
  if (urlList.length > 5) {
    triggers.push({ type: "link_volume", field: "urls", value: String(urlList.length), scoreDelta: 15 });
    score += 15;
  }

  urlList.forEach((url) => {
    const host = parseUrlHost(url);
    if (!host) return;
    if (blockedHosts.has(host)) {
      triggers.push({ type: "blocked_url_host", field: "url", value: host, scoreDelta: 25 });
      score += 25;
    }
  });

  const cappedScore = Math.min(score, 100);
  let severity: CommunitySafetySeverity = "low";
  if (cappedScore >= config.highSeverityThreshold) severity = "high";
  else if (cappedScore >= config.mediumSeverityThreshold) severity = "medium";

  return {
    score: cappedScore,
    severity,
    flagged: triggers.length > 0,
    triggers,
    inspectedUrlCount: urlList.length,
  };
}

export const staffGetCommunitySafetyConfig = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const config = await getCommunitySafetyConfig();
  await writeSafetyAudit({ actorUid: auth.uid, action: "get_safety_config" });
  res.status(200).json({ ok: true, config });
});

export const staffUpdateCommunitySafetyConfig = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const parsed = parseBody(updateCommunitySafetySchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const existing = await getCommunitySafetyConfig();
  const patch = parsed.data;

  const next: CommunitySafetyConfig = {
    ...existing,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.publishKillSwitch !== undefined ? { publishKillSwitch: patch.publishKillSwitch } : {}),
    ...(patch.autoFlagEnabled !== undefined ? { autoFlagEnabled: patch.autoFlagEnabled } : {}),
    ...(patch.highSeverityThreshold !== undefined ? { highSeverityThreshold: patch.highSeverityThreshold } : {}),
    ...(patch.mediumSeverityThreshold !== undefined ? { mediumSeverityThreshold: patch.mediumSeverityThreshold } : {}),
    ...(patch.blockedTerms ? { blockedTerms: toLowerList(patch.blockedTerms) } : {}),
    ...(patch.blockedUrlHosts ? { blockedUrlHosts: toLowerList(patch.blockedUrlHosts) } : {}),
    updatedAtMs: Date.now(),
    updatedBy: auth.uid,
  };

  if (next.mediumSeverityThreshold >= next.highSeverityThreshold) {
    res.status(400).json({ ok: false, message: "mediumSeverityThreshold must be lower than highSeverityThreshold." });
    return;
  }

  await db.doc(COMMUNITY_SAFETY_CONFIG_PATH).set(next, { merge: true });

  await writeSafetyAudit({
    actorUid: auth.uid,
    action: "update_safety_config",
    metadata: {
      changedKeys: Object.keys(patch),
      enabled: next.enabled,
      publishKillSwitch: next.publishKillSwitch,
      autoFlagEnabled: next.autoFlagEnabled,
      blockedTermsCount: next.blockedTerms.length,
      blockedUrlHostsCount: next.blockedUrlHosts.length,
    },
  });

  res.status(200).json({ ok: true, config: next });
});

export const staffScanCommunityDraft = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const parsed = parseBody(staffScanDraftSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const config = await getCommunitySafetyConfig();

  const textFields = [
    { field: "title", text: safeString(parsed.data.title).trim() },
    { field: "summary", text: safeString(parsed.data.summary).trim() },
    { field: "description", text: safeString(parsed.data.description).trim() },
    { field: "policyCopy", text: safeString(parsed.data.policyCopy).trim() },
    { field: "location", text: safeString(parsed.data.location).trim() },
  ].filter((entry) => entry.text.length > 0);

  const risk = evaluateCommunityContentRisk({
    textFields,
    explicitUrls: parsed.data.urls ?? [],
  }, config);

  await writeSafetyAudit({
    actorUid: auth.uid,
    action: "scan_draft",
    metadata: {
      severity: risk.severity,
      score: risk.score,
      flagged: risk.flagged,
      triggerCount: risk.triggers.length,
    },
  });

  res.status(200).json({ ok: true, risk, configSnapshot: config });
});
