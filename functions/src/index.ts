/* eslint-disable @typescript-eslint/no-explicit-any */

import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

import {
  db,
  applyCors,
  requireAdmin,
  requireAuthUid,
  requireAuthContext,
  nowTs,
  asInt,
  safeString,
  enforceRateLimit,
  parseBody,
  makeIdempotencyId,
  createDelegatedAgentToken as createDelegatedToken,
  FieldValue,
  Timestamp,
} from "./shared";
import { TimelineEventType } from "./timelineEventTypes";
import { z } from "zod";
import { handleApiV1 } from "./apiV1";
import {
  staffGetCommunitySafetyConfig,
  staffScanCommunityDraft,
  staffUpdateCommunitySafetyConfig,
} from "./communitySafety";
import {
  getModerationPolicyCurrent,
  listModerationPolicies,
  staffPublishModerationPolicy,
  staffUpsertModerationPolicy,
} from "./moderationPolicy";
import {
  addInternalNote,
  cleanupCommunityReportArtifacts,
  createReportAppeal,
  createReport,
  listMyReports,
  listMyReportAppeals,
  listReportAppeals,
  listReports,
  takeContentAction,
  updateReportAppeal,
  updateReportStatus,
} from "./reports";
import {
  createIntegrationToken as createIntegrationTokenRecord,
  listIntegrationTokensForOwner,
  normalizeAndValidateScopes,
  revokeIntegrationTokenForOwner,
} from "./integrationTokens";
import {
  staffClearAgentClientCooldown,
  staffCreateAgentClient,
  staffListAgentClientAuditLogs,
  staffListAgentClients,
  staffRotateAgentClientKey,
  staffUpdateAgentClientProfile,
  staffUpdateAgentClientStatus,
} from "./agentClients";
import {
  staffGetAgentServiceCatalog,
  staffUpdateAgentServiceCatalog,
} from "./agentCatalog";
import {
  staffExportAgentDeniedEventsCsv,
  staffListAgentOperations,
  staffGetAgentOpsConfig,
  staffUpdateAgentOrderFulfillment,
  staffReviewAgentReservation,
  staffUpdateAgentOpsConfig,
} from "./agentCommerce";
import { emitIntegrationEvent } from "./integrationEvents";
export {
  registerDeviceToken,
  unregisterDeviceToken,
  runNotificationFailureDrill,
  onKilnFiringUnloaded,
  processNotificationJob,
  processQueuedNotificationJobs,
  aggregateNotificationDeliveryMetrics,
  runNotificationMetricsAggregationNow,
  cleanupStaleDeviceTokens,
} from "./notifications";

// -----------------------------
// Config
// -----------------------------
const REGION = "us-central1";

export const apiV1 = onRequest({ region: REGION, timeoutSeconds: 60 }, handleApiV1);
export {
  createReport,
  listMyReports,
  listMyReportAppeals,
  listReports,
  updateReportStatus,
  addInternalNote,
  takeContentAction,
  createReportAppeal,
  listReportAppeals,
  updateReportAppeal,
  cleanupCommunityReportArtifacts,
};
export {
  getModerationPolicyCurrent,
  listModerationPolicies,
  staffUpsertModerationPolicy,
  staffPublishModerationPolicy,
};
export {
  staffGetCommunitySafetyConfig,
  staffUpdateCommunitySafetyConfig,
  staffScanCommunityDraft,
};
export {
  staffClearAgentClientCooldown,
  staffCreateAgentClient,
  staffListAgentClients,
  staffRotateAgentClientKey,
  staffUpdateAgentClientStatus,
  staffUpdateAgentClientProfile,
  staffListAgentClientAuditLogs,
};
export {
  staffGetAgentServiceCatalog,
  staffUpdateAgentServiceCatalog,
};
export {
  staffExportAgentDeniedEventsCsv,
  staffGetAgentOpsConfig,
  staffListAgentOperations,
  staffUpdateAgentOrderFulfillment,
  staffReviewAgentReservation,
  staffUpdateAgentOpsConfig,
};

/**
 * IMPORTANT:
 * This is the Google Calendar ID for "MF Firings" (the calendar you're syncing from).
 * Keep it EXACT (no whitespace). You already verified it with /debugCalendarId.
 */

const FIRINGS_CALENDAR_ID =
  "a985b8d46f34392d2ad6b520742b95e5e83e0db237980ea87dc690334da0f52f@group.calendar.google.com";

function getGoogleCalendarCredsJson(): string | null {
  const raw = (process.env.GOOGLE_CALENDAR_CREDENTIALS ?? "").trim();
  return raw.length ? raw : null;
}

// -----------------------------
// Types (lightweight)
// -----------------------------
type IntakeMode = "STAFF_HANDOFF" | "SELF_SERVICE";

type BatchState =
  | "DRAFT"
  | "SUBMITTED"
  | "SHELVED"
  | "LOADED"
  | "FIRED"
  | "READY_FOR_PICKUP"
  | "CLOSED_PICKED_UP"
  | "CLOSED_OTHER";

type PieceState =
  | "OK"
  | "DAMAGED_IN_HANDLING"
  | "DESTROYED_IN_HANDLING"
  | "FIRING_ISSUE";

const createBatchSchema = z.object({
  ownerUid: z.string().min(1),
  ownerDisplayName: z.string().optional().nullable(),
  title: z.string().min(1),
  intakeMode: z.string().min(1),
  estimatedCostCents: z.number().int().nonnegative(),
  kilnName: z.string().optional().nullable(),
  estimateNotes: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  clientRequestId: z.string().optional().nullable(),
});

const submitDraftSchema = z.object({
  batchId: z.string().min(1),
  notes: z.string().optional().nullable(),
});

const continueJourneySchema = z.object({
  uid: z.string().min(1),
  fromBatchId: z.string().min(1),
  title: z.string().optional().nullable(),
});

const batchActionSchema = z.object({
  batchId: z.string().min(1),
  notes: z.string().optional().nullable(),
});

const kilnLoadSchema = z.object({
  batchId: z.string().min(1),
  kilnId: z.string().min(1),
  kilnName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  photos: z.array(z.string()).optional(),
});

const kilnUnloadSchema = z.object({
  batchId: z.string().min(1),
  notes: z.string().optional().nullable(),
  photos: z.array(z.string()).optional(),
});

const backfillSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

const createIntegrationTokenSchema = z.object({
  label: z.string().max(60).optional().nullable(),
  scopes: z.array(z.string()).min(1).max(20),
});

const revokeIntegrationTokenSchema = z.object({
  tokenId: z.string().min(1),
});

const createDelegatedAgentTokenSchema = z.object({
  agentClientId: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1).max(120)).min(1).max(20),
  ttlSeconds: z.number().int().min(30).max(600).optional(),
  audience: z.string().min(1).max(120).optional().nullable(),
  principalUid: z.string().min(1).max(128).optional().nullable(),
});

const githubLookupSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
  type: z.enum(["issue", "pr"]),
});

const staffUpdateUserProfileSchema = z.object({
  uid: z.string().min(1),
  reason: z.string().max(240).optional().nullable(),
  patch: z.object({
    displayName: z.string().min(1).max(80).optional().nullable(),
    membershipTier: z.string().min(1).max(60).optional().nullable(),
    kilnPreferences: z.string().max(240).optional().nullable(),
    staffNotes: z.string().max(2000).optional().nullable(),
  }),
});

function batchesCol() {
  return db.collection("batches");
}
function batchDoc(batchId: string) {
  return batchesCol().doc(batchId);
}
function timelineCol(batchId: string) {
  return batchDoc(batchId).collection("timeline");
}

// -----------------------------
// Timeline helper
// -----------------------------
async function addTimelineEvent(params: {
  batchId: string;
  type: TimelineEventType;
  at?: Timestamp;
  actorUid?: string | null;
  actorName?: string | null;
  notes?: string | null;
  kilnId?: string | null;
  kilnName?: string | null;
  photos?: string[];
  pieceState?: PieceState | null;
  extra?: Record<string, any>;
}) {
  const {
    batchId,
    type,
    at = nowTs(),
    actorUid = null,
    actorName = null,
    notes = null,
    kilnId = null,
    kilnName = null,
    photos = [],
    pieceState = null,
    extra = {},
  } = params;

  await timelineCol(batchId).add({
    type,
    at,
    actorUid,
    actorName,
    notes,
    kilnId,
    kilnName,
    photos,
    pieceState,
    ...extra,
  });
}

// -----------------------------
// Google Calendar client (lazy import)
// -----------------------------
async function getCalendarClient() {
  const raw = getGoogleCalendarCredsJson();
  if (!raw) {
    throw new Error("GOOGLE_CALENDAR_CREDENTIALS not configured");
  }

  let creds: any;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_CALENDAR_CREDENTIALS is not valid JSON");
  }

  const { google } = await import("googleapis");

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  const calendar = google.calendar({ version: "v3", auth });
  return { calendar, clientEmail: creds.client_email as string };
}

// -----------------------------
// Public: hello
// -----------------------------
export const hello = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  res.status(200).json({ ok: true, message: "ok" });
});

function readGitHubToken(): string {
  const preferred = (process.env.GITHUB_LOOKUP_TOKEN ?? "").trim();
  if (preferred) return preferred;
  return (process.env.GITHUB_TOKEN ?? "").trim();
}

async function fetchGitHubResource(input: {
  owner: string;
  repo: string;
  number: number;
  type: "issue" | "pr";
}) {
  const path =
    input.type === "issue"
      ? `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.number}`
      : `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.number}`;
  const url = `https://api.github.com${path}`;

  const token = readGitHubToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "monsoonfire-portal-tracker",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { method: "GET", headers });
  const body = (await response.json()) as {
    html_url?: unknown;
    title?: unknown;
    state?: unknown;
    updated_at?: unknown;
    merged?: unknown;
  };

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      message:
        typeof (body as { message?: unknown }).message === "string"
          ? String((body as { message?: unknown }).message)
          : "GitHub lookup failed",
    };
  }

  return {
    ok: true as const,
    status: response.status,
    data: {
      url: typeof body.html_url === "string" ? body.html_url : url,
      title: typeof body.title === "string" ? body.title : "",
      state: typeof body.state === "string" ? body.state : "unknown",
      updatedAt:
        typeof body.updated_at === "string"
          ? body.updated_at
          : new Date().toISOString(),
      merged: input.type === "pr" && typeof body.merged === "boolean" ? body.merged : undefined,
    },
  };
}

export const githubLookup = onRequest(
  { region: REGION, timeoutSeconds: 30 },
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

    const rate = await enforceRateLimit({
      req,
      key: "githubLookup",
      max: 60,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const parsed = parseBody(githubLookupSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    try {
      const result = await fetchGitHubResource(parsed.data);
      if (!result.ok) {
        res.status(result.status).json({ ok: false, message: result.message });
        return;
      }

      res.status(200).json({ ok: true, data: result.data });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("githubLookup failed", { message });
      res.status(500).json({ ok: false, message: "GitHub lookup failed" });
    }
  }
);

export const staffUpdateUserProfile = onRequest(
  { region: REGION, timeoutSeconds: 30 },
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

    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    const parsed = parseBody(staffUpdateUserProfileSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const patchInput = parsed.data.patch;
    const hasPatchField =
      patchInput.displayName !== undefined ||
      patchInput.membershipTier !== undefined ||
      patchInput.kilnPreferences !== undefined ||
      patchInput.staffNotes !== undefined;

    if (!hasPatchField) {
      res.status(400).json({ ok: false, message: "Patch must include at least one editable field" });
      return;
    }

    try {
      const userRef = db.collection("users").doc(parsed.data.uid);
      const auditRef = db.collection("staffProfileEdits").doc();

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error("User not found");

        const current = (snap.data() ?? {}) as Record<string, any>;
        const before = {
          displayName: current.displayName ?? null,
          membershipTier: current.membershipTier ?? null,
          kilnPreferences: current.kilnPreferences ?? null,
          staffNotes: current.staffNotes ?? null,
        };

        const writePatch: Record<string, unknown> = {
          updatedAt: nowTs(),
          staffProfileUpdatedBy: auth.uid,
        };

        const after = { ...before } as Record<string, unknown>;

        if (patchInput.displayName !== undefined) {
          writePatch.displayName = patchInput.displayName;
          after.displayName = patchInput.displayName;
        }
        if (patchInput.membershipTier !== undefined) {
          writePatch.membershipTier = patchInput.membershipTier;
          after.membershipTier = patchInput.membershipTier;
        }
        if (patchInput.kilnPreferences !== undefined) {
          writePatch.kilnPreferences = patchInput.kilnPreferences;
          after.kilnPreferences = patchInput.kilnPreferences;
        }
        if (patchInput.staffNotes !== undefined) {
          writePatch.staffNotes = patchInput.staffNotes;
          after.staffNotes = patchInput.staffNotes;
        }

        tx.set(userRef, writePatch, { merge: true });
        tx.set(auditRef, {
          uid: parsed.data.uid,
          editedByUid: auth.uid,
          editedByMode: admin.mode,
          reason: parsed.data.reason ?? null,
          before,
          after,
          at: nowTs(),
        });
      });

      res.status(200).json({ ok: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message === "User not found" ? 404 : 500;
      logger.error("staffUpdateUserProfile failed", { message });
      res.status(code).json({ ok: false, message });
    }
  }
);

// -----------------------------
// Integrations: PATs (integration tokens)
// -----------------------------
export const createIntegrationToken = onRequest(
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

    const parsed = parseBody(createIntegrationTokenSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "createIntegrationToken",
      max: 6,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const scopesParsed = normalizeAndValidateScopes(parsed.data.scopes);
    if (!scopesParsed.ok) {
      res.status(400).json({ ok: false, message: scopesParsed.message });
      return;
    }

    try {
      const out = await createIntegrationTokenRecord({
        ownerUid: auth.uid,
        label: parsed.data.label ? String(parsed.data.label) : null,
        scopes: scopesParsed.scopes,
      });

      res.status(200).json({
        ok: true,
        tokenId: out.tokenId,
        token: out.token,
        record: out.record,
      });
    } catch (e: any) {
      logger.error("createIntegrationToken failed", e);
      res.status(500).json({ ok: false, message: e?.message ?? "Failed to create token" });
    }
  }
);

export const listIntegrationTokens = onRequest(
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

    const rate = await enforceRateLimit({
      req,
      key: "listIntegrationTokens",
      max: 30,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const tokens = await listIntegrationTokensForOwner(auth.uid);
    res.status(200).json({ ok: true, tokens });
  }
);

export const revokeIntegrationToken = onRequest(
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

    const parsed = parseBody(revokeIntegrationTokenSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "revokeIntegrationToken",
      max: 20,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const tokenId = safeString(parsed.data.tokenId);
    const out = await revokeIntegrationTokenForOwner({ ownerUid: auth.uid, tokenId });
    if (!out.ok) {
      res.status(out.message === "Token not found" ? 404 : 403).json({ ok: false, message: out.message });
      return;
    }

    res.status(200).json({ ok: true });
  }
);

export const createDelegatedAgentToken = onRequest(
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

    const parsed = parseBody(createDelegatedAgentTokenSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "createDelegatedAgentToken",
      max: 30,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const clientId = safeString(parsed.data.agentClientId);
    const ref = db.collection("agentClients").doc(clientId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, message: "Agent client not found" });
      return;
    }

    const row = snap.data() as Record<string, unknown>;
    const clientStatus = safeString(row.status, "active");
    if (clientStatus !== "active") {
      res.status(400).json({ ok: false, message: "Agent client must be active for delegated tokens." });
      return;
    }

    const ownerUid = safeString(row.ownerUid) || safeString(row.createdByUid);
    const admin = await requireAdmin(req);
    const isStaff = admin.ok;
    if (!isStaff && ownerUid && ownerUid !== auth.uid) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    const requestedScopes = [...new Set(parsed.data.scopes.map((entry) => String(entry).trim()).filter(Boolean))];
    if (!requestedScopes.length) {
      res.status(400).json({ ok: false, message: "At least one scope is required." });
      return;
    }

    const allowedScopes = Array.isArray(row.scopes)
      ? row.scopes.filter((entry): entry is string => typeof entry === "string")
      : [];
    const missingScopes = requestedScopes.filter((scope) => !allowedScopes.includes(scope));
    if (missingScopes.length) {
      res.status(403).json({
        ok: false,
        message: `Agent client missing scope(s): ${missingScopes.join(", ")}`,
      });
      return;
    }

    const principalUid = safeString(parsed.data.principalUid) || auth.uid;
    if (principalUid !== auth.uid && !isStaff) {
      res.status(403).json({ ok: false, message: "Only staff can issue delegated tokens for other principals." });
      return;
    }

    try {
      const issued = createDelegatedToken({
        principalUid,
        agentClientId: clientId,
        scopes: requestedScopes,
        ttlSeconds: parsed.data.ttlSeconds ?? 300,
        audience: parsed.data.audience ?? null,
      });

      await db.collection("agentClientAuditLogs").add({
        actorUid: auth.uid,
        action: "issue_delegated_token",
        clientId,
        metadata: {
          principalUid,
          scopes: requestedScopes,
          ttlSeconds: parsed.data.ttlSeconds ?? 300,
          audience: issued.audience,
          expiresAtMs: issued.expiresAt,
          nonce: issued.nonce,
        },
        createdAt: nowTs(),
      });

      res.status(200).json({
        ok: true,
        delegatedToken: issued.token,
        expiresAtMs: issued.expiresAt,
        audience: issued.audience,
        principalUid,
        mode: "delegated",
        warning: "Delegated token is short-lived and single-use (nonce protected).",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, message });
    }
  }
);

export const helloPat = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;

  const auth = await requireAuthContext(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, code: auth.code, message: auth.message });
    return;
  }

  res.status(200).json({
    ok: true,
    uid: auth.ctx.uid,
    mode: auth.ctx.mode,
    scopes: auth.ctx.mode === "firebase" ? null : auth.ctx.scopes,
    delegated: auth.ctx.mode === "delegated" ? auth.ctx.delegated : null,
  });
});

// -----------------------------
// Debug: calendar id sanity check
// -----------------------------
export const debugCalendarId = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;

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

  const trimmed = FIRINGS_CALENDAR_ID.trim();
  const tail = trimmed.slice(-23);
  const tailCharCodes = tail.split("").map((c) => c.charCodeAt(0));

  res.status(200).json({
    calendarId: FIRINGS_CALENDAR_ID,
    trimmed,
    sameAfterTrim: FIRINGS_CALENDAR_ID === trimmed,
    length: FIRINGS_CALENDAR_ID.length,
    trimmedLength: trimmed.length,
    hasWhitespaceAnywhere: /\s/.test(FIRINGS_CALENDAR_ID),
    tail,
    tailCharCodes,
  });
});

// -----------------------------
// Utility: accept/insert the shared calendar into the service account's calendar list
// -----------------------------
export const acceptFiringsCalendar = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;

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

    try {
      const { calendar, clientEmail } = await getCalendarClient();

      // Insert into calendar list (helps in some cases + confirms access)
      const inserted = await calendar.calendarList.insert({
        requestBody: { id: FIRINGS_CALENDAR_ID },
      });

      res.status(200).json({
        ok: true,
        clientEmail,
        inserted: true,
        calendarId: FIRINGS_CALENDAR_ID,
        summary: inserted.data.summary ?? null,
      });
    } catch (e: any) {
      logger.error("acceptFiringsCalendar failed", e);
      res.status(200).json({
        ok: false,
        calendarId: FIRINGS_CALENDAR_ID,
        message: e?.message ?? String(e),
        hint:
          "If you see NOT_FOUND, share the calendar to the service account email under Google Calendar > Settings and sharing > Share with specific people.",
      });
    }
  }
);

// -----------------------------
// Calendar -> Firestore sync
// Writes into collection: firingsCalendarEvents/{eventId}
// -----------------------------
async function syncFiringsCore(): Promise<{ synced: number; clientEmail: string }> {
  const { calendar, clientEmail } = await getCalendarClient();

  // Fetch a reasonable window (tweak later)
  const timeMin = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString(); // 60 days back
  const timeMax = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString(); // 1 year forward

  const resp = await calendar.events.list({
    calendarId: FIRINGS_CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });

  const items = resp.data.items ?? [];
  const col = db.collection("firingsCalendarEvents");

  const batch = db.batch();
  let writes = 0;

  for (const ev of items) {
    if (!ev.id) continue;

    const docRef = col.doc(ev.id);
    batch.set(
      docRef,
      {
        calendarId: FIRINGS_CALENDAR_ID,
        eventId: ev.id,
        summary: ev.summary ?? null,
        description: ev.description ?? null,
        status: ev.status ?? null,
        htmlLink: ev.htmlLink ?? null,
        start: ev.start ?? null,
        end: ev.end ?? null,
        updated: ev.updated ?? null,
        raw: ev,
        syncedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    writes++;
    // If you ever exceed 500 writes, you must commit in chunks.
    // For now we stay simple; if you add tons of events later, we’ll chunk it.
    if (writes >= 450) break;
  }

  await batch.commit();
  return { synced: writes, clientEmail };
}

export const syncFiringsNow = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;

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

    const rate = await enforceRateLimit({
      req,
      key: "syncFiringsNow",
      max: 3,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    try {
      const out = await syncFiringsCore();
      res.status(200).json({
        ok: true,
        synced: out.synced,
        calendarId: FIRINGS_CALENDAR_ID,
        clientEmail: out.clientEmail,
      });
    } catch (e: any) {
      logger.error("syncFiringsNow failed", e);
      res.status(200).json({
        ok: false,
        calendarId: FIRINGS_CALENDAR_ID,
        message: e?.message ?? String(e),
        code: e?.code ?? null,
        gaxiosStatus: e?.response?.status ?? null,
        gaxiosData: e?.response?.data ?? null,
        hint:
          "If you see NOT_FOUND, confirm the calendar is shared to the service account AND the Calendar API is enabled.",
      });
    }
  }
);

// Scheduled version (daily)
export const syncFirings = onSchedule(
  { region: REGION, schedule: "every day 03:15", timeZone: "America/Phoenix" },
  async () => {
    try {
      const out = await syncFiringsCore();
      logger.info("syncFirings ok", out);
    } catch (e) {
      logger.error("syncFirings failed", e);
    }
  }
);

// -----------------------------
// Batches: createBatch (admin-only)
// -----------------------------
export const createBatch = onRequest(
  { region: REGION, timeoutSeconds: 60, cors: true },
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

    const parsed = parseBody(createBatchSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "createBatch",
      max: 6,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const ownerUid = safeString(parsed.data.ownerUid);
    const ownerDisplayName = safeString(parsed.data.ownerDisplayName);
    const title = safeString(parsed.data.title);
    const intakeMode = safeString(parsed.data.intakeMode) as IntakeMode;
    const estimatedCostCents = asInt(parsed.data.estimatedCostCents, 0);
    const kilnName = safeString(parsed.data.kilnName);
    const estimateNotes = safeString(parsed.data.estimateNotes || parsed.data.notes);
    const clientRequestId = safeString(parsed.data.clientRequestId);

    const admin = await requireAdmin(req);
    const isSelfService = ownerUid === auth.uid;
    if (!admin.ok && !isSelfService) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    const ref = clientRequestId
      ? batchesCol().doc(makeIdempotencyId("batch", ownerUid, clientRequestId))
      : batchesCol().doc();

    if (clientRequestId) {
      const existing = await ref.get();
      if (existing.exists) {
        res.status(200).json({ ok: true, existingBatchId: ref.id });
        return;
      }
    }
    const createdAt = nowTs();
    const editors = isSelfService
      ? [auth.uid]
      : [ownerUid, auth.uid].filter((uid, idx, arr) => arr.indexOf(uid) === idx);

    const doc = {
      ownerUid,
      ownerDisplayName: ownerDisplayName || null,
      editors,
      title,
      intakeMode: intakeMode || "STAFF_HANDOFF",
      estimatedCostCents,
      kilnName: kilnName || null,
      estimateNotes: estimateNotes || null,

      state: "DRAFT" as BatchState,
      isClosed: false,
      createdAt,
      updatedAt: createdAt,
      closedAt: null,

      // journey tracking
      journeyRootBatchId: ref.id,
      journeyParentBatchId: null,
    };

    await ref.set(doc);
    const actorUid = isSelfService ? auth.uid : "admin";
    const actorName = isSelfService ? ownerDisplayName || "client" : "admin";
    await addTimelineEvent({
      batchId: ref.id,
      type: TimelineEventType.CREATE_BATCH,
      at: createdAt,
      actorUid,
      actorName,
      notes: "Batch created",
    });

    // Best-effort integration event for agent clients.
    try {
      const evt = await emitIntegrationEvent({
        uid: ownerUid,
        type: "batch.updated",
        subject: { batchId: ref.id },
        data: { state: doc.state, isClosed: doc.isClosed, title: doc.title },
      });
      if (!evt.ok) {
        logger.warn("emitIntegrationEvent failed", { message: evt.message });
      }
    } catch (e: any) {
      logger.warn("emitIntegrationEvent exception", { message: e?.message ?? String(e) });
    }

    res.status(200).json({ ok: true, batchId: ref.id });
  }
);

// -----------------------------
// Batches: submitDraftBatch (client sets state -> SUBMITTED)
// -----------------------------
export const submitDraftBatch = onRequest(
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
    const uid = auth.uid;

    const parsed = parseBody(submitDraftSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "submitDraftBatch",
      max: 6,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const batchId = safeString(parsed.data.batchId);

    const ref = batchDoc(batchId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, message: "Batch not found" });
      return;
    }

    const data = snap.data() as any;
    if (data.ownerUid !== uid) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    const t = nowTs();
    await ref.set(
      {
        state: "SUBMITTED" as BatchState,
        updatedAt: t,
      },
      { merge: true }
    );

    await addTimelineEvent({
      batchId,
      type: TimelineEventType.SUBMIT_DRAFT,
      at: t,
      actorUid: uid,
      actorName: data.ownerDisplayName ?? null,
      notes: safeString(parsed.data.notes) || "Submitted",
    });

    res.status(200).json({ ok: true });
  }
);

// -----------------------------
// Batches: pickedUpAndClose (admin-only)
// Closes the batch, but keeps pieces reusable later.
// -----------------------------
export const pickedUpAndClose = onRequest(
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

    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    const parsed = parseBody(batchActionSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "pickedUpAndClose",
      max: 10,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const batchId = safeString(parsed.data.batchId);

    const ref = batchDoc(batchId);
    const t = nowTs();

    await ref.set(
      {
        isClosed: true,
        state: "CLOSED_PICKED_UP" as BatchState,
        closedAt: t,
        updatedAt: t,
      },
      { merge: true }
    );

    await addTimelineEvent({
      batchId,
      type: TimelineEventType.PICKED_UP_AND_CLOSE,
      at: t,
      actorUid: "admin",
      actorName: "admin",
      notes: safeString(parsed.data.notes) || "Picked up; batch closed",
    });

    res.status(200).json({ ok: true });
  }
);

// -----------------------------
// Batches: continueJourney (client)
// Creates a NEW DRAFT batch linked to the same journeyRootBatchId.
// -----------------------------
export const continueJourney = onRequest(
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
    const uid = auth.uid;

    const parsed = parseBody(continueJourneySchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "continueJourney",
      max: 4,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const fromBatchId = safeString(parsed.data.fromBatchId);
    if (safeString(parsed.data.uid) !== uid) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    const fromSnap = await batchDoc(fromBatchId).get();
    if (!fromSnap.exists) {
      res.status(404).json({ ok: false, message: "Source batch not found" });
      return;
    }

    const from = fromSnap.data() as any;
    if (from.ownerUid !== uid) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    const rootId = safeString(from.journeyRootBatchId) || fromBatchId;

    const newRef = batchesCol().doc();
    const t = nowTs();

    await newRef.set({
      ownerUid: uid,
      ownerDisplayName: from.ownerDisplayName ?? null,
      title: safeString(parsed.data.title) || `${from.title} (resubmission)`,
      intakeMode: from.intakeMode ?? "SELF_SERVICE",
      estimatedCostCents: 0,
      estimateNotes: null,

      state: "DRAFT" as BatchState,
      isClosed: false,
      createdAt: t,
      updatedAt: t,
      closedAt: null,

      journeyRootBatchId: rootId,
      journeyParentBatchId: fromBatchId,
    });

    await addTimelineEvent({
      batchId: newRef.id,
      type: TimelineEventType.CONTINUE_JOURNEY,
      at: t,
      actorUid: uid,
      actorName: from.ownerDisplayName ?? null,
      notes: `Continued journey from ${fromBatchId}`,
      extra: { fromBatchId },
    });

    res.status(200).json({ ok: true, batchId: newRef.id, rootId });
  }
);

// -----------------------------
// Optional admin lifecycle helpers (safe no-op-ish, but real writes)
// -----------------------------
export const shelveBatch = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(batchActionSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "shelveBatch",
    max: 15,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const batchId = safeString(parsed.data.batchId);

  const t = nowTs();
  await batchDoc(batchId).set(
    { state: "SHELVED" as BatchState, updatedAt: t },
    { merge: true }
  );
  await addTimelineEvent({
    batchId,
    type: TimelineEventType.SHELVED,
    at: t,
    actorUid: "admin",
    actorName: "admin",
    notes: safeString(parsed.data.notes) || "Shelved",
  });

  res.status(200).json({ ok: true });
});

export const kilnLoad = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(kilnLoadSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "kilnLoad",
    max: 20,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const batchId = safeString(parsed.data.batchId);
  const kilnId = safeString(parsed.data.kilnId);
  const kilnName = safeString(parsed.data.kilnName);

  const t = nowTs();
  await batchDoc(batchId).set(
    {
      state: "LOADED" as BatchState,
      updatedAt: t,
      currentKilnId: kilnId,
      currentKilnName: kilnName || null,
    },
    { merge: true }
  );

  await addTimelineEvent({
    batchId,
    type: TimelineEventType.KILN_LOAD,
    at: t,
    actorUid: "admin",
    actorName: "admin",
    kilnId,
    kilnName: kilnName || null,
    notes: safeString(parsed.data.notes) || "Loaded to kiln",
    photos: Array.isArray(parsed.data.photos) ? parsed.data.photos : [],
  });

  res.status(200).json({ ok: true });
});

export const kilnUnload = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(kilnUnloadSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "kilnUnload",
    max: 20,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const batchId = safeString(parsed.data.batchId);

  const t = nowTs();
  await batchDoc(batchId).set(
    {
      updatedAt: t,
      // Leaving state alone here; you may set FIRED or READY_FOR_PICKUP next
      currentKilnId: FieldValue.delete(),
      currentKilnName: FieldValue.delete(),
    },
    { merge: true }
  );

  await addTimelineEvent({
    batchId,
    type: TimelineEventType.KILN_UNLOAD,
    at: t,
    actorUid: "admin",
    actorName: "admin",
    notes: safeString(parsed.data.notes) || "Unloaded from kiln",
    photos: Array.isArray(parsed.data.photos) ? parsed.data.photos : [],
  });

  res.status(200).json({ ok: true });
});

export const readyForPickup = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(batchActionSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "readyForPickup",
    max: 20,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const batchId = safeString(parsed.data.batchId);

  const t = nowTs();
  await batchDoc(batchId).set(
    { state: "READY_FOR_PICKUP" as BatchState, updatedAt: t },
    { merge: true }
  );

  await addTimelineEvent({
    batchId,
    type: TimelineEventType.READY_FOR_PICKUP,
    at: t,
    actorUid: "admin",
    actorName: "admin",
    notes: safeString(parsed.data.notes) || "Ready for pickup",
  });

  res.status(200).json({ ok: true });
});

export { createReservation } from "./createReservation";
export { normalizeTimelineEventTypes } from "./normalizeTimelineEventTypes";
export { createMaterialsCheckoutSession, listMaterialsProducts, seedMaterialsCatalog, stripeWebhook } from "./materials";
export { importLibraryIsbns } from "./library";
export {
  getJukeboxConfig,
  listTracks,
  listQueue,
  getJukeboxState,
  enqueueTrack,
  vote,
  requestSkip,
  adminUpsertTrack,
  adminSetConfig,
  adminAdvanceQueue,
  adminSetPlaybackState,
  adminSkipNowPlaying,
  adminClearQueue,
} from "./jukebox";
export {
  listEvents,
  listEventSignups,
  getEvent,
  createEvent,
  publishEvent,
  staffSetEventStatus,
  signupForEvent,
  cancelEventSignup,
  claimEventOffer,
  checkInEvent,
  createEventCheckoutSession,
  eventStripeWebhook,
  sweepEventOffers,
} from "./events";
export { listBillingSummary } from "./billingSummary";
export {
  staffGetStripeConfig,
  staffUpdateStripeConfig,
  staffValidateStripeConfig,
  createAgentCheckoutSession,
  createCheckoutSession,
  stripePortalWebhook,
} from "./stripeConfig";

// -----------------------------
// Backfill helper: ensure isClosed field exists (admin-only)
// -----------------------------
export const backfillIsClosed = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;

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

    const parsed = parseBody(backfillSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const limit = Math.min(Math.max(asInt(parsed.data.limit, 200), 1), 500);

    const snaps = await batchesCol().limit(limit).get();
    const batch = db.batch();
    let updated = 0;

    snaps.forEach((docSnap) => {
      const d = docSnap.data() as any;
      if (typeof d.isClosed !== "boolean") {
        batch.set(docSnap.ref, { isClosed: false }, { merge: true });
        updated++;
      }
    });

    if (updated > 0) await batch.commit();

    res.status(200).json({ ok: true, scanned: snaps.size, updated });
  }
);



