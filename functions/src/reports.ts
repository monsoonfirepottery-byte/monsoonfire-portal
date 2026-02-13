import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { createHash } from "crypto";
import { z } from "zod";
import {
  applyCors,
  db,
  enforceRateLimit,
  nowTs,
  parseBody,
  requireAdmin,
  requireAuthUid,
} from "./shared";
import { enforceAppCheckIfEnabled } from "./authz";

const REGION = "us-central1";

const REPORTS_COL = "communityReports";
const REPORT_APPEALS_COL = "communityReportAppeals";
const REPORT_AUDIT_COL = "communityReportAuditLogs";
const FEED_OVERRIDES_COL = "communityFeedOverrides";
const POLICY_CONFIG_PATH = "config/moderationPolicy";
const POLICY_VERSIONS_COL = "moderationPolicyVersions";
const REPORT_DEDUPE_COL = "communityReportDedupe";
const REPORT_SIGNALS_COL = "communityReportTargetSignals";
const REPORTS_HOUSEKEEPING_COL = "communityReportHousekeeping";
const REPORT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const COORDINATION_SIGNAL_WINDOW_MS = 60 * 60 * 1000;
const COORDINATION_SIGNAL_REPORT_THRESHOLD = 6;
const COORDINATION_SIGNAL_UNIQUE_REPORTER_THRESHOLD = 4;

const reportCategorySchema = z.enum([
  "broken_link",
  "incorrect_info",
  "spam",
  "safety",
  "harassment_hate",
  "copyright",
  "other",
]);
const reportSeveritySchema = z.enum(["low", "medium", "high"]);
const reportTargetTypeSchema = z.enum(["youtube_video", "blog_post", "studio_update", "event"]);

const reportSnapshotSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url().optional().nullable(),
  source: z.string().max(80).optional().nullable(),
  author: z.string().max(120).optional().nullable(),
  publishedAtMs: z.number().int().nonnegative().optional().nullable(),
});

const createReportSchema = z.object({
  targetType: reportTargetTypeSchema,
  targetRef: z.object({
    id: z.string().min(1).max(180),
    url: z.string().url().optional().nullable(),
    videoId: z.string().max(120).optional().nullable(),
    slug: z.string().max(180).optional().nullable(),
  }),
  category: reportCategorySchema,
  severity: reportSeveritySchema.optional(),
  note: z.string().max(1200).optional().nullable(),
  targetSnapshot: reportSnapshotSchema,
});

const listReportsSchema = z.object({
  status: z.enum(["all", "open", "triaged", "actioned", "resolved", "dismissed"]).optional(),
  category: reportCategorySchema.or(z.literal("all")).optional(),
  severity: reportSeveritySchema.or(z.literal("all")).optional(),
  targetType: reportTargetTypeSchema.or(z.literal("all")).optional(),
  createdAfterMs: z.number().int().nonnegative().optional(),
  createdBeforeMs: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const listMyReportsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  includeClosed: z.boolean().optional(),
});

const updateReportStatusSchema = z.object({
  reportId: z.string().min(1),
  status: z.enum(["open", "triaged", "actioned", "resolved", "dismissed"]),
  policyVersion: z.string().min(1).max(80),
  ruleId: z.string().min(1).max(80),
  reasonCode: z.string().min(1).max(120),
  resolutionCode: z.string().max(120).optional().nullable(),
});

const addInternalNoteSchema = z.object({
  reportId: z.string().min(1),
  note: z.string().min(1).max(2400),
});

const takeContentActionSchema = z.object({
  reportId: z.string().min(1),
  policyVersion: z.string().min(1).max(80),
  ruleId: z.string().min(1).max(80),
  reasonCode: z.string().min(1).max(120),
  actionType: z.enum(["unpublish", "replace_link", "flag_for_review", "disable_from_feed"]),
  reason: z.string().max(400).optional().nullable(),
  replacementUrl: z.string().url().optional().nullable(),
});

const createReportAppealSchema = z.object({
  reportId: z.string().min(1),
  note: z.string().min(1).max(2000),
});

const listReportAppealsSchema = z.object({
  status: z.enum(["all", "open", "in_review", "upheld", "reversed", "rejected"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const listMyReportAppealsSchema = z.object({
  status: z.enum(["all", "open", "in_review", "upheld", "reversed", "rejected"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const updateReportAppealSchema = z.object({
  appealId: z.string().min(1),
  status: z.enum(["open", "in_review", "upheld", "reversed", "rejected"]),
  decisionReasonCode: z.string().max(120).optional().nullable(),
  decisionNote: z.string().max(2000).optional().nullable(),
});

function safeString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeNullableString(v: string | null | undefined): string | null {
  const value = safeString(v);
  return value.length ? value : null;
}

function dedupeKey(uid: string, targetType: string, targetId: string) {
  return createHash("sha256")
    .update(`${uid}::${targetType}::${targetId}`)
    .digest("hex")
    .slice(0, 40);
}

function targetSignalKey(targetType: string, targetId: string) {
  return createHash("sha256")
    .update(`${targetType}::${targetId}`)
    .digest("hex")
    .slice(0, 40);
}

async function enforceReportAppCheck(req: any, res: any): Promise<boolean> {
  const appCheck = await enforceAppCheckIfEnabled(req);
  if (!appCheck.ok) {
    res.status(appCheck.httpStatus).json({ ok: false, message: appCheck.message, code: appCheck.code });
    return false;
  }
  return true;
}

export function normalizeReportSeverity(
  category: z.infer<typeof reportCategorySchema>,
  requestedSeverity?: z.infer<typeof reportSeveritySchema>
): z.infer<typeof reportSeveritySchema> {
  return category === "safety" ? "high" : (requestedSeverity ?? "low");
}

export function isDuplicateReportWithinWindow(params: {
  existingCreatedAtMs?: number;
  nowMs: number;
  windowMs?: number;
}): boolean {
  const createdAtMs =
    typeof params.existingCreatedAtMs === "number" && Number.isFinite(params.existingCreatedAtMs)
      ? params.existingCreatedAtMs
      : 0;
  if (createdAtMs <= 0) return false;
  const windowMs =
    typeof params.windowMs === "number" && Number.isFinite(params.windowMs) && params.windowMs > 0
      ? params.windowMs
      : REPORT_DEDUPE_WINDOW_MS;
  return params.nowMs - createdAtMs < windowMs;
}

export function shouldRaiseCoordinationSignal(params: {
  windowStartMs: number;
  nowMs: number;
  reportCount: number;
  uniqueReporterCount: number;
}): boolean {
  const inWindow =
    params.windowStartMs > 0 && params.nowMs - params.windowStartMs < COORDINATION_SIGNAL_WINDOW_MS;
  return (
    inWindow &&
    params.reportCount >= COORDINATION_SIGNAL_REPORT_THRESHOLD &&
    params.uniqueReporterCount >= COORDINATION_SIGNAL_UNIQUE_REPORTER_THRESHOLD
  );
}

type ActivePolicy = {
  version: string;
  rules: Array<{ id: string }>;
};

async function readActivePolicy(): Promise<ActivePolicy | null> {
  const configSnap = await db.doc(POLICY_CONFIG_PATH).get();
  const version = safeString(configSnap.data()?.activeVersion);
  if (!version) return null;
  const policySnap = await db.collection(POLICY_VERSIONS_COL).doc(version).get();
  if (!policySnap.exists) return null;
  const data = policySnap.data() as { rules?: unknown } | undefined;
  const rules = Array.isArray(data?.rules)
    ? data.rules
        .map((entry) => {
          const row = entry as { id?: unknown };
          return { id: safeString(row.id) };
        })
        .filter((entry) => entry.id.length > 0)
    : [];
  return { version, rules };
}

async function writeAudit(params: {
  actorUid: string;
  actorRole: "user" | "staff";
  action: string;
  reportId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  category?: string | null;
  severity?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const payload = {
    actorUid: params.actorUid,
    actorRole: params.actorRole,
    action: params.action,
    reportId: params.reportId ?? null,
    targetType: params.targetType ?? null,
    targetId: params.targetId ?? null,
    category: params.category ?? null,
    severity: params.severity ?? null,
    metadata: params.metadata ?? null,
    createdAt: nowTs(),
  };
  await db.collection(REPORT_AUDIT_COL).add(payload);
}

export const createReport = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!(await enforceReportAppCheck(req, res))) return;

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const parsed = parseBody(createReportSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const uid = auth.uid;
  const payload = parsed.data;
  const targetId = safeString(payload.targetRef.id);
  const targetType = payload.targetType;
  const category = payload.category;
  const severity = normalizeReportSeverity(category, payload.severity);

  const limitResult = await enforceRateLimit({
    req,
    key: "community_reports_create_per_uid",
    max: 5,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (!limitResult.ok) {
    await writeAudit({
      actorUid: uid,
      actorRole: "user",
      action: "create_report_denied",
      targetType,
      targetId,
      category,
      severity,
      metadata: { reason: "rate_limited", retryAfterMs: limitResult.retryAfterMs },
    });
    res.status(429).json({ ok: false, message: "Rate limit exceeded. Try again later." });
    return;
  }

  const dedupeId = dedupeKey(uid, targetType, targetId);
  const targetSignalId = targetSignalKey(targetType, targetId);
  const dedupeRef = db.collection(REPORT_DEDUPE_COL).doc(dedupeId);
  const signalRef = db.collection(REPORT_SIGNALS_COL).doc(targetSignalId);
  const reportRef = db.collection(REPORTS_COL).doc();
  const nowMs = Date.now();
  let coordinationSignal = false;
  let coordinationReportCount = 0;
  let coordinationUniqueReporterCount = 0;
  let coordinationWindowStartMs = nowMs;

  try {
    await db.runTransaction(async (tx) => {
      const dedupeSnap = await tx.get(dedupeRef);
      if (dedupeSnap.exists) {
        const existing = dedupeSnap.data() as { createdAtMs?: number; reportId?: string } | undefined;
        const createdAtMs = typeof existing?.createdAtMs === "number" ? existing.createdAtMs : 0;
        if (
          isDuplicateReportWithinWindow({
            existingCreatedAtMs: createdAtMs,
            nowMs,
            windowMs: REPORT_DEDUPE_WINDOW_MS,
          })
        ) {
          const err = new Error("duplicate_report");
          (err as Error & { code?: string }).code = "duplicate_report";
          throw err;
        }
      }

      const signalSnap = await tx.get(signalRef);
      const signalData = signalSnap.data() as
        | { windowStartMs?: unknown; reportCount?: unknown; reporterUids?: unknown[] }
        | undefined;
      const currentWindowStartMsRaw = typeof signalData?.windowStartMs === "number" ? signalData.windowStartMs : 0;
      const withinWindow = currentWindowStartMsRaw > 0 && nowMs - currentWindowStartMsRaw < COORDINATION_SIGNAL_WINDOW_MS;
      const windowStartMs = withinWindow ? currentWindowStartMsRaw : nowMs;
      const existingReportCountRaw = typeof signalData?.reportCount === "number" ? signalData.reportCount : 0;
      const existingReportCount = withinWindow ? existingReportCountRaw : 0;
      const existingReporterUids = withinWindow
        ? Array.isArray(signalData?.reporterUids)
          ? signalData.reporterUids.filter((entry): entry is string => typeof entry === "string").slice(-40)
          : []
        : [];
      const reporterUidSet = new Set(existingReporterUids);
      reporterUidSet.add(uid);
      const reporterUids = Array.from(reporterUidSet).slice(-40);

      coordinationReportCount = existingReportCount + 1;
      coordinationUniqueReporterCount = reporterUids.length;
      coordinationWindowStartMs = windowStartMs;
      coordinationSignal = shouldRaiseCoordinationSignal({
        windowStartMs,
        nowMs,
        reportCount: coordinationReportCount,
        uniqueReporterCount: coordinationUniqueReporterCount,
      });

      tx.set(
        signalRef,
        {
          targetType,
          targetId,
          windowStartMs,
          reportCount: coordinationReportCount,
          uniqueReporterCount: coordinationUniqueReporterCount,
          reporterUids,
          lastReportedAtMs: nowMs,
          lastSignalAtMs: coordinationSignal ? nowMs : null,
          updatedAt: nowTs(),
        },
        { merge: true }
      );

      tx.set(reportRef, {
        reporterUid: uid,
        status: "open",
        assigneeUid: null,
        resolutionCode: null,
        resolvedAt: null,
        category,
        severity,
        note: normalizeNullableString(payload.note),
        targetType,
        targetRef: payload.targetRef,
        targetSnapshot: payload.targetSnapshot,
        dedupeKey: dedupeId,
        coordinationSignal,
        coordinationWindowStartMs,
        coordinationReportCount,
        coordinationUniqueReporterCount,
        createdAt: nowTs(),
        updatedAt: nowTs(),
      });
      tx.set(dedupeRef, {
        reporterUid: uid,
        targetType,
        targetId,
        reportId: reportRef.id,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + REPORT_DEDUPE_WINDOW_MS,
        updatedAt: nowTs(),
      });
    });
  } catch (error: unknown) {
    const code =
      error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "";
    if (code === "duplicate_report") {
      await writeAudit({
        actorUid: uid,
        actorRole: "user",
        action: "create_report_denied",
        targetType,
        targetId,
        category,
        severity,
        metadata: { reason: "duplicate_report" },
      });
      res.status(409).json({ ok: false, message: "You already reported this item in the last 24 hours." });
      return;
    }
    logger.error("createReport failed", error);
    res.status(500).json({ ok: false, message: "Failed to create report" });
    return;
  }

  await writeAudit({
    actorUid: uid,
    actorRole: "user",
    action: "create_report",
    reportId: reportRef.id,
    targetType,
    targetId,
    category,
    severity,
    metadata: {
      coordinationSignal,
      coordinationReportCount,
      coordinationUniqueReporterCount,
    },
  });

  if (coordinationSignal) {
    await writeAudit({
      actorUid: uid,
      actorRole: "user",
      action: "report_coordination_signal",
      reportId: reportRef.id,
      targetType,
      targetId,
      category,
      severity,
      metadata: {
        coordinationWindowStartMs,
        coordinationReportCount,
        coordinationUniqueReporterCount,
      },
    });
  }

  res.status(200).json({ ok: true, reportId: reportRef.id, status: "open" });
});

export const listReports = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!(await enforceReportAppCheck(req, res))) return;
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

  const parsed = parseBody(listReportsSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const {
    status = "all",
    category = "all",
    severity = "all",
    targetType = "all",
    createdAfterMs,
    createdBeforeMs,
    limit = 80,
  } = parsed.data;
  const snap = await db.collection(REPORTS_COL).orderBy("createdAt", "desc").limit(limit).get();
  let reports: Array<Record<string, unknown>> = snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Record<string, unknown>),
  }));
  reports = reports.filter((row) => {
    if (status !== "all" && safeString(row.status) !== status) return false;
    if (category !== "all" && safeString(row.category) !== category) return false;
    if (severity !== "all" && safeString(row.severity) !== severity) return false;
    if (targetType !== "all" && safeString(row.targetType) !== targetType) return false;
    const createdAtRaw = row.createdAt as { toMillis?: () => number; seconds?: unknown } | undefined;
    let createdAtMs = 0;
    if (createdAtRaw && typeof createdAtRaw.toMillis === "function") {
      createdAtMs = Number(createdAtRaw.toMillis() || 0);
    } else if (createdAtRaw) {
      createdAtMs = Number(createdAtRaw.seconds ?? 0) * 1000;
    }
    if (typeof createdAfterMs === "number" && createdAfterMs > 0 && createdAtMs > 0 && createdAtMs < createdAfterMs) return false;
    if (typeof createdBeforeMs === "number" && createdBeforeMs > 0 && createdAtMs > createdBeforeMs) return false;
    return true;
  });

  await writeAudit({
    actorUid: auth.uid,
    actorRole: "staff",
    action: "list_reports",
    metadata: { status, category, severity, targetType, createdAfterMs, createdBeforeMs, limit },
  });
  res.status(200).json({ ok: true, reports });
});

export const listMyReports = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!(await enforceReportAppCheck(req, res))) return;
  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const parsed = parseBody(listMyReportsSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const { limit = 12, includeClosed = true } = parsed.data;
  const scanLimit = Math.min(Math.max(limit * 3, limit), 200);

  const snap = await db.collection(REPORTS_COL).where("reporterUid", "==", auth.uid).limit(scanLimit).get();
  let reports: Array<Record<string, unknown>> = snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Record<string, unknown>),
  }));

  if (!includeClosed) {
    reports = reports.filter((row) => {
      const status = safeString(row.status);
      return status === "open" || status === "triaged" || status === "actioned";
    });
  }

  reports.sort((a, b) => {
    const aSeconds = Number((a.createdAt as { seconds?: unknown } | undefined)?.seconds ?? 0);
    const bSeconds = Number((b.createdAt as { seconds?: unknown } | undefined)?.seconds ?? 0);
    return bSeconds - aSeconds;
  });

  await writeAudit({
    actorUid: auth.uid,
    actorRole: "user",
    action: "list_my_reports",
    metadata: { limit, includeClosed, returned: reports.length },
  });

  res.status(200).json({ ok: true, reports: reports.slice(0, limit) });
});

export const updateReportStatus = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!(await enforceReportAppCheck(req, res))) return;
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

  const parsed = parseBody(updateReportStatusSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }
  const { reportId, status, policyVersion, ruleId, reasonCode, resolutionCode } = parsed.data;
  const activePolicy = await readActivePolicy();
  if (!activePolicy) {
    res.status(412).json({ ok: false, message: "No active moderation policy is published." });
    return;
  }
  if (activePolicy.version !== policyVersion) {
    res.status(400).json({
      ok: false,
      message: `Policy mismatch. Active policy is ${activePolicy.version}. Refresh and retry.`,
    });
    return;
  }
  const normalizedRuleId = safeString(ruleId).trim().toLowerCase();
  const allowedRuleIds = new Set(
    activePolicy.rules.map((entry) => safeString(entry.id).trim().toLowerCase())
  );
  if (!allowedRuleIds.has(normalizedRuleId)) {
    res.status(400).json({ ok: false, message: "Rule ID is not valid for active policy." });
    return;
  }

  const ref = db.collection(REPORTS_COL).doc(reportId);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ ok: false, message: "Report not found" });
    return;
  }
  const row = snap.data() as Record<string, unknown>;
  await ref.set(
    {
      status,
      resolutionCode: normalizeNullableString(resolutionCode),
      lastPolicyVersion: policyVersion,
      lastRuleId: normalizedRuleId,
      lastReasonCode: safeString(reasonCode).trim(),
      assigneeUid: auth.uid,
      resolvedAt: status === "resolved" || status === "dismissed" ? nowTs() : null,
      updatedAt: nowTs(),
    },
    { merge: true }
  );
  await writeAudit({
    actorUid: auth.uid,
    actorRole: "staff",
    action: "update_report_status",
    reportId,
    targetType: safeString(row.targetType),
    targetId: safeString((row.targetRef as { id?: unknown } | undefined)?.id),
    category: safeString(row.category),
    severity: safeString(row.severity),
    metadata: {
      status,
      resolutionCode: normalizeNullableString(resolutionCode),
      policyVersion,
      ruleId: normalizedRuleId,
      reasonCode: safeString(reasonCode).trim(),
    },
  });
  res.status(200).json({ ok: true });
});

export const addInternalNote = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!(await enforceReportAppCheck(req, res))) return;
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

  const parsed = parseBody(addInternalNoteSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }
  const { reportId, note } = parsed.data;
  const reportRef = db.collection(REPORTS_COL).doc(reportId);
  const reportSnap = await reportRef.get();
  if (!reportSnap.exists) {
    res.status(404).json({ ok: false, message: "Report not found" });
    return;
  }
  const noteRef = reportRef.collection("internalNotes").doc();
  await noteRef.set({
    authorUid: auth.uid,
    note: safeString(note),
    createdAt: nowTs(),
  });
  await reportRef.set({ updatedAt: nowTs() }, { merge: true });
  await writeAudit({
    actorUid: auth.uid,
    actorRole: "staff",
    action: "add_internal_note",
    reportId,
    metadata: { noteId: noteRef.id },
  });
  res.status(200).json({ ok: true, noteId: noteRef.id });
});

export const takeContentAction = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!(await enforceReportAppCheck(req, res))) return;
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

  const parsed = parseBody(takeContentActionSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }
  const { reportId, policyVersion, ruleId, reasonCode, actionType, reason, replacementUrl } = parsed.data;
  const activePolicy = await readActivePolicy();
  if (!activePolicy) {
    res.status(412).json({ ok: false, message: "No active moderation policy is published." });
    return;
  }
  if (activePolicy.version !== policyVersion) {
    res.status(400).json({
      ok: false,
      message: `Policy mismatch. Active policy is ${activePolicy.version}. Refresh and retry.`,
    });
    return;
  }
  const normalizedRuleId = safeString(ruleId).trim().toLowerCase();
  const allowedRuleIds = new Set(
    activePolicy.rules.map((entry) => safeString(entry.id).trim().toLowerCase())
  );
  if (!allowedRuleIds.has(normalizedRuleId)) {
    res.status(400).json({ ok: false, message: "Rule ID is not valid for active policy." });
    return;
  }

  const reportRef = db.collection(REPORTS_COL).doc(reportId);
  const reportSnap = await reportRef.get();
  if (!reportSnap.exists) {
    res.status(404).json({ ok: false, message: "Report not found" });
    return;
  }
  const report = reportSnap.data() as Record<string, unknown>;
  const targetType = safeString(report.targetType);
  const targetRef = (report.targetRef as { id?: unknown; url?: unknown; videoId?: unknown } | undefined) ?? {};
  const targetId = safeString(targetRef.id);
  const priorReportStatus = safeString(report.status) || "open";
  const priorLastActionType = safeString(report.lastActionType);
  const priorTargetUrl = safeString(targetRef.url) || safeString((report.targetSnapshot as { url?: unknown } | undefined)?.url);
  const normalizedReason = normalizeNullableString(reason);
  const normalizedReplacementUrl = normalizeNullableString(replacementUrl);

  if (targetType === "youtube_video" && !["disable_from_feed", "replace_link", "flag_for_review"].includes(actionType)) {
    res.status(400).json({ ok: false, message: "Action not supported for youtube_video" });
    return;
  }
  if (targetType !== "youtube_video" && !["unpublish", "replace_link", "flag_for_review"].includes(actionType)) {
    res.status(400).json({ ok: false, message: "Action not supported for internal content" });
    return;
  }

  const actionRef = reportRef.collection("actions").doc();
  let feedOverrideBefore: Record<string, unknown> | null = null;
  let feedOverrideAfter: Record<string, unknown> | null = null;

  if (targetType === "youtube_video") {
    const feedId = safeString(targetRef.videoId) || targetId;
    const overrideRef = db.collection(FEED_OVERRIDES_COL).doc(`youtube_video:${feedId}`);
    const overrideSnap = await overrideRef.get();
    const existingOverride =
      (overrideSnap.exists ? (overrideSnap.data() as Record<string, unknown> | undefined) : undefined) ?? {};
    feedOverrideBefore = {
      disabled: Boolean(existingOverride.disabled),
      flaggedForReview: Boolean(existingOverride.flaggedForReview),
      replacementUrl: normalizeNullableString(safeString(existingOverride.replacementUrl)),
      reason: normalizeNullableString(safeString(existingOverride.reason)),
    };
    feedOverrideAfter = {
      disabled: actionType === "disable_from_feed",
      flaggedForReview: actionType === "flag_for_review",
      replacementUrl: normalizedReplacementUrl,
      reason: normalizedReason,
    };
    await overrideRef.set(
      {
        targetType: "youtube_video",
        targetId: feedId,
        disabled: feedOverrideAfter.disabled,
        replacementUrl: feedOverrideAfter.replacementUrl,
        flaggedForReview: feedOverrideAfter.flaggedForReview,
        reason: feedOverrideAfter.reason,
        updatedBy: auth.uid,
        updatedAt: nowTs(),
      },
      { merge: true }
    );
  }

  await actionRef.set({
    actorUid: auth.uid,
    actionType,
    reason: normalizedReason,
    replacementUrl: normalizedReplacementUrl,
    before: {
      reportStatus: priorReportStatus,
      lastActionType: normalizeNullableString(priorLastActionType),
      targetUrl: normalizeNullableString(priorTargetUrl),
      feedOverride: feedOverrideBefore,
    },
    after: {
      reportStatus: "actioned",
      lastActionType: actionType,
      targetUrl: normalizedReplacementUrl ?? normalizeNullableString(priorTargetUrl),
      feedOverride: feedOverrideAfter,
    },
    createdAt: nowTs(),
  });

  await reportRef.set(
    {
      status: "actioned",
      lastActionType: actionType,
      lastPolicyVersion: policyVersion,
      lastRuleId: normalizedRuleId,
      lastReasonCode: safeString(reasonCode).trim(),
      assigneeUid: auth.uid,
      updatedAt: nowTs(),
    },
    { merge: true }
  );

  await writeAudit({
    actorUid: auth.uid,
    actorRole: "staff",
    action: "take_content_action",
    reportId,
    targetType,
    targetId,
    category: safeString(report.category),
    severity: safeString(report.severity),
    metadata: {
      actionType,
      reason: normalizedReason,
      replacementUrl: normalizedReplacementUrl,
      policyVersion,
      ruleId: normalizedRuleId,
      reasonCode: safeString(reasonCode).trim(),
      before: {
        reportStatus: priorReportStatus,
        lastActionType: normalizeNullableString(priorLastActionType),
        targetUrl: normalizeNullableString(priorTargetUrl),
        feedOverride: feedOverrideBefore,
      },
      after: {
        reportStatus: "actioned",
        lastActionType: actionType,
        targetUrl: normalizedReplacementUrl ?? normalizeNullableString(priorTargetUrl),
        feedOverride: feedOverrideAfter,
      },
    },
  });
  res.status(200).json({ ok: true, actionId: actionRef.id });
});

export const createReportAppeal = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!(await enforceReportAppCheck(req, res))) return;
  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const parsed = parseBody(createReportAppealSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const { reportId, note } = parsed.data;
  const reportRef = db.collection(REPORTS_COL).doc(reportId);
  const reportSnap = await reportRef.get();
  if (!reportSnap.exists) {
    res.status(404).json({ ok: false, message: "Report not found" });
    return;
  }

  const report = reportSnap.data() as Record<string, unknown>;
  const reporterUid = safeString(report.reporterUid);
  if (reporterUid !== auth.uid) {
    res.status(403).json({ ok: false, message: "Only the original reporter can file an appeal." });
    return;
  }

  const reportStatus = safeString(report.status);
  if (reportStatus === "open" || reportStatus === "triaged") {
    res.status(409).json({
      ok: false,
      message: "Appeals are available after a final moderation outcome is recorded.",
    });
    return;
  }

  const existingAppealsSnap = await db
    .collection(REPORT_APPEALS_COL)
    .where("reportId", "==", reportId)
    .where("reporterUid", "==", auth.uid)
    .limit(40)
    .get();

  const hasOpenAppeal = existingAppealsSnap.docs.some((docSnap) => {
    const row = docSnap.data() as Record<string, unknown>;
    const status = safeString(row.status);
    return status === "open" || status === "in_review";
  });
  if (hasOpenAppeal) {
    res.status(409).json({ ok: false, message: "An appeal is already in progress for this report." });
    return;
  }

  const appealRef = db.collection(REPORT_APPEALS_COL).doc();
  await appealRef.set({
    reportId,
    reporterUid: auth.uid,
    status: "open",
    note: safeString(note).trim(),
    reportStatusAtAppeal: reportStatus,
    createdAt: nowTs(),
    updatedAt: nowTs(),
    reviewedByUid: null,
    reviewedAt: null,
    decisionReasonCode: null,
    decisionNote: null,
  });

  await writeAudit({
    actorUid: auth.uid,
    actorRole: "user",
    action: "create_report_appeal",
    reportId,
    targetType: safeString(report.targetType),
    targetId: safeString((report.targetRef as { id?: unknown } | undefined)?.id),
    category: safeString(report.category),
    severity: safeString(report.severity),
    metadata: { appealId: appealRef.id },
  });

  res.status(200).json({ ok: true, appealId: appealRef.id });
});

export const listReportAppeals = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!(await enforceReportAppCheck(req, res))) return;
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

  const parsed = parseBody(listReportAppealsSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const { status = "all", limit = 80 } = parsed.data;
  const snap = await db.collection(REPORT_APPEALS_COL).orderBy("createdAt", "desc").limit(limit).get();
  let appeals: Array<Record<string, unknown>> = snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Record<string, unknown>),
  }));
  if (status !== "all") {
    appeals = appeals.filter((row) => safeString(row.status) === status);
  }

  await writeAudit({
    actorUid: auth.uid,
    actorRole: "staff",
    action: "list_report_appeals",
    metadata: { status, limit },
  });

  res.status(200).json({ ok: true, appeals });
});

export const listMyReportAppeals = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!(await enforceReportAppCheck(req, res))) return;
  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const parsed = parseBody(listMyReportAppealsSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const { status = "all", limit = 60 } = parsed.data;
  const scanLimit = Math.min(Math.max(limit * 3, limit), 200);

  const snap = await db.collection(REPORT_APPEALS_COL).where("reporterUid", "==", auth.uid).limit(scanLimit).get();
  let appeals: Array<Record<string, unknown>> = snap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() as Record<string, unknown>),
  }));

  if (status !== "all") {
    appeals = appeals.filter((row) => safeString(row.status) === status);
  }

  appeals.sort((a, b) => {
    const aSeconds = Number((a.createdAt as { seconds?: unknown } | undefined)?.seconds ?? 0);
    const bSeconds = Number((b.createdAt as { seconds?: unknown } | undefined)?.seconds ?? 0);
    return bSeconds - aSeconds;
  });

  await writeAudit({
    actorUid: auth.uid,
    actorRole: "user",
    action: "list_my_report_appeals",
    metadata: { status, limit, returned: appeals.length },
  });

  res.status(200).json({ ok: true, appeals: appeals.slice(0, limit) });
});

export const updateReportAppeal = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }
  if (!(await enforceReportAppCheck(req, res))) return;
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

  const parsed = parseBody(updateReportAppealSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const { appealId, status, decisionReasonCode, decisionNote } = parsed.data;
  const appealRef = db.collection(REPORT_APPEALS_COL).doc(appealId);
  const appealSnap = await appealRef.get();
  if (!appealSnap.exists) {
    res.status(404).json({ ok: false, message: "Appeal not found" });
    return;
  }

  const appeal = appealSnap.data() as Record<string, unknown>;
  const reportId = safeString(appeal.reportId);
  if (!reportId) {
    res.status(400).json({ ok: false, message: "Appeal is missing report linkage." });
    return;
  }

  if (status === "upheld" || status === "reversed" || status === "rejected") {
    if (!safeString(decisionReasonCode).trim()) {
      res.status(400).json({ ok: false, message: "decisionReasonCode is required for final appeal outcomes." });
      return;
    }
  }

  const reportRef = db.collection(REPORTS_COL).doc(reportId);
  const reportSnap = await reportRef.get();
  if (!reportSnap.exists) {
    res.status(404).json({ ok: false, message: "Linked report not found." });
    return;
  }
  const report = reportSnap.data() as Record<string, unknown>;
  const lastAssignee = safeString(report.assigneeUid);
  if ((status === "upheld" || status === "reversed" || status === "rejected") && lastAssignee && lastAssignee === auth.uid) {
    res.status(409).json({
      ok: false,
      message: "Final appeal review must be completed by a different staff member than the original moderator.",
    });
    return;
  }

  await appealRef.set(
    {
      status,
      reviewedByUid: auth.uid,
      reviewedAt: status === "open" ? null : nowTs(),
      decisionReasonCode: safeString(decisionReasonCode).trim() || null,
      decisionNote: normalizeNullableString(decisionNote),
      updatedAt: nowTs(),
    },
    { merge: true }
  );

  if (status === "reversed") {
    await reportRef.set(
      {
        status: "open",
        assigneeUid: null,
        resolvedAt: null,
        reopenedByAppealId: appealId,
        updatedAt: nowTs(),
      },
      { merge: true }
    );
  }

  await writeAudit({
    actorUid: auth.uid,
    actorRole: "staff",
    action: "update_report_appeal",
    reportId,
    targetType: safeString(report.targetType),
    targetId: safeString((report.targetRef as { id?: unknown } | undefined)?.id),
    category: safeString(report.category),
    severity: safeString(report.severity),
    metadata: {
      appealId,
      status,
      decisionReasonCode: safeString(decisionReasonCode).trim() || null,
    },
  });

  res.status(200).json({ ok: true });
});

async function cleanupNumericThreshold(
  collectionName: string,
  fieldName: string,
  threshold: number,
  label: string
): Promise<number> {
  const snap = await db
    .collection(collectionName)
    .where(fieldName, "<", threshold)
    .limit(300)
    .get();

  if (snap.empty) return 0;

  const batch = db.batch();
  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
  }
  await batch.commit();
  logger.info("community report cleanup batch", { label, deleted: snap.size, threshold });
  return snap.size;
}

export const cleanupCommunityReportArtifacts = onSchedule(
  {
    region: REGION,
    schedule: "every day 03:20",
    timeZone: "Etc/UTC",
    timeoutSeconds: 540,
    memory: "256MiB",
  },
  async () => {
    const nowMs = Date.now();
    const dedupeThreshold = nowMs - 2 * 24 * 60 * 60 * 1000;
    const signalThreshold = nowMs - 10 * 24 * 60 * 60 * 1000;

    let deletedDedupe = 0;
    let deletedSignals = 0;

    for (let i = 0; i < 8; i += 1) {
      const deleted = await cleanupNumericThreshold(
        REPORT_DEDUPE_COL,
        "expiresAtMs",
        dedupeThreshold,
        "report_dedupe"
      );
      deletedDedupe += deleted;
      if (deleted === 0) break;
    }

    for (let i = 0; i < 8; i += 1) {
      const deleted = await cleanupNumericThreshold(
        REPORT_SIGNALS_COL,
        "lastReportedAtMs",
        signalThreshold,
        "report_signal"
      );
      deletedSignals += deleted;
      if (deleted === 0) break;
    }

    await db.collection(REPORTS_HOUSEKEEPING_COL).add({
      type: "cleanup_report_artifacts",
      deletedDedupe,
      deletedSignals,
      dedupeThreshold,
      signalThreshold,
      createdAt: nowTs(),
    });

    logger.info("cleanupCommunityReportArtifacts complete", {
      deletedDedupe,
      deletedSignals,
      dedupeThreshold,
      signalThreshold,
    });
  }
);
