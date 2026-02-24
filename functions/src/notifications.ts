import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldPath, type DocumentReference } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { db, nowTs, safeString, Timestamp, adminAuth, applyCors, requireAuthUid, requireAdmin } from "./shared";
import { z } from "zod";

const REGION = "us-central1";
const JOB_MAX_ATTEMPTS = 5;
const JOB_BASE_RETRY_MS = 60_000;
const SMS_MESSAGE_MAX_CHARS = 1200;
const RESERVATION_DELAY_FOLLOW_UP_INITIAL_MS = 12 * 60 * 60 * 1000;
const RESERVATION_DELAY_FOLLOW_UP_REPEAT_MS = 24 * 60 * 60 * 1000;
const RESERVATION_STORAGE_REMINDER_SCHEDULE_MS = [
  72 * 60 * 60 * 1000,
  120 * 60 * 60 * 1000,
  168 * 60 * 60 * 1000,
] as const;
const RESERVATION_STORAGE_HOLD_PENDING_MS = 10 * 24 * 60 * 60 * 1000;
const RESERVATION_STORAGE_STORED_BY_POLICY_MS = 14 * 24 * 60 * 60 * 1000;
const RESERVATION_STORAGE_HISTORY_MAX = 60;

type ReservationStorageStatus = "active" | "reminder_pending" | "hold_pending" | "stored_by_policy";
type ReservationPickupWindowStatus = "open" | "confirmed" | "missed" | "expired" | "completed";

function asRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  const rawMessage =
    asRecord(error) && "message" in error && error !== null
      ? safeString((error as { message?: unknown }).message)
      : safeString(error);
  return rawMessage || String(error);
}

const registerDeviceTokenSchema = z.object({
  token: z.string().min(16).max(1024),
  platform: z.enum(["ios"]).optional(),
  environment: z.enum(["sandbox", "production"]).optional(),
  appVersion: z.string().max(128).optional(),
  appBuild: z.string().max(64).optional(),
  deviceModel: z.string().max(128).optional(),
});

const unregisterDeviceTokenSchema = z.object({
  token: z.string().min(16).max(1024).optional(),
  tokenHash: z.string().length(64).optional(),
});

const runNotificationDrillSchema = z.object({
  uid: z.string().min(1),
  mode: z.enum(["auth", "provider_4xx", "provider_5xx", "network", "success"]),
  channels: z
    .object({
      inApp: z.boolean().optional(),
      email: z.boolean().optional(),
      push: z.boolean().optional(),
      sms: z.boolean().optional(),
    })
    .optional(),
  forceRunNow: z.boolean().optional(),
});

export const registerDeviceToken = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed", code: "INVALID_ARGUMENT" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message, code: "UNAUTHENTICATED" });
    return;
  }

  const parsed = registerDeviceTokenSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request body";
    res.status(400).json({ ok: false, message, code: "INVALID_ARGUMENT" });
    return;
  }

  const data = parsed.data;
  const normalizedToken = data.token.trim().replace(/\s+/g, "");
  if (!normalizedToken) {
    res.status(400).json({ ok: false, message: "Device token is required", code: "INVALID_ARGUMENT" });
    return;
  }

  const tokenId = createHash("sha256").update(normalizedToken).digest("hex");
  const ref = db.collection("users").doc(auth.uid).collection("deviceTokens").doc(tokenId);
  const now = nowTs();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as Record<string, unknown> | undefined) : undefined;
    tx.set(
      ref,
      {
        uid: auth.uid,
        token: normalizedToken,
        tokenHash: tokenId,
        active: true,
        platform: data.platform ?? "ios",
        environment: data.environment ?? "production",
        appVersion: data.appVersion ?? null,
        appBuild: data.appBuild ?? null,
        deviceModel: data.deviceModel ?? null,
        createdAt: existing?.createdAt ?? now,
        lastSeenAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
  });

  res.status(200).json({ ok: true, uid: auth.uid, tokenHash: tokenId });
});

export const unregisterDeviceToken = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed", code: "INVALID_ARGUMENT" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message, code: "UNAUTHENTICATED" });
    return;
  }

  const parsed = unregisterDeviceTokenSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request body";
    res.status(400).json({ ok: false, message, code: "INVALID_ARGUMENT" });
    return;
  }

  const data = parsed.data;
  const normalizedToken = data.token?.trim().replace(/\s+/g, "");
  const tokenHash =
    data.tokenHash ??
    (normalizedToken ? createHash("sha256").update(normalizedToken).digest("hex") : "");

  if (!tokenHash) {
    res.status(400).json({
      ok: false,
      message: "token or tokenHash is required",
      code: "INVALID_ARGUMENT",
    });
    return;
  }

  await db
    .collection("users")
    .doc(auth.uid)
    .collection("deviceTokens")
    .doc(tokenHash)
    .set(
      {
        active: false,
        deactivatedAt: nowTs(),
        updatedAt: nowTs(),
      },
      { merge: true }
    );

  res.status(200).json({ ok: true, uid: auth.uid, tokenHash });
});

export const runNotificationFailureDrill = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed", code: "INVALID_ARGUMENT" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message, code: "UNAUTHENTICATED" });
    return;
  }
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    res.status(403).json({ ok: false, message: admin.message, code: "PERMISSION_DENIED" });
    return;
  }

  const parsed = runNotificationDrillSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request body";
    res.status(400).json({ ok: false, message, code: "INVALID_ARGUMENT" });
    return;
  }

  const input = parsed.data;
  const now = nowTs();
  const drillId = `drill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload: NotificationPayload = {
    dedupeKey: `DRILL:${input.mode}:${drillId}:${input.uid}`,
    firingId: `drill-firing-${drillId}`,
    kilnName: "Drill Kiln",
    firingType: "bisque",
    drillMode: input.mode,
  };
  const runAfter = input.forceRunNow === false ? Timestamp.fromDate(new Date(Date.now() + 120000)) : now;
  const job: NotificationJob = {
    type: "KILN_UNLOADED",
    createdAt: now,
    runAfter,
    uid: input.uid,
    channels: {
      inApp: input.channels?.inApp ?? false,
      email: input.channels?.email ?? false,
      push: input.channels?.push ?? true,
      sms: input.channels?.sms ?? false,
    },
    payload,
    attemptCount: 0,
    status: "queued",
  };

  const ref = db.collection("notificationJobs").doc(hashId(payload.dedupeKey));
  await ref.set(job, { merge: true });
  res.status(200).json({ ok: true, jobId: ref.id, uid: input.uid, mode: input.mode });
});

type NotificationPrefs = {
  enabled: boolean;
  channels: {
    inApp: boolean;
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  events: {
    kilnUnloaded: boolean;
    kilnUnloadedBisque: boolean;
    kilnUnloadedGlaze: boolean;
  };
  quietHours?: {
    enabled: boolean;
    startLocal: string;
    endLocal: string;
    timezone: string;
  };
  frequency: {
    mode: "immediate" | "digest";
    digestHours?: number;
  };
};

type NotificationPayload = {
  dedupeKey: string;
  firingId: string;
  kilnId?: string | null;
  kilnName?: string | null;
  firingType?: "bisque" | "glaze" | null;
  batchIds?: string[];
  pieceIds?: string[];
  drillMode?: "auth" | "provider_4xx" | "provider_5xx" | "network" | "success";
  reservationId?: string | null;
  reservationStatus?: string | null;
  previousReservationStatus?: string | null;
  reservationLoadStatus?: string | null;
  previousReservationLoadStatus?: string | null;
  eventKind?:
    | "confirmed"
    | "waitlisted"
    | "cancelled"
    | "estimate_shift"
    | "pickup_ready"
    | "delay_follow_up"
    | "pickup_reminder";
  reason?: string | null;
  estimateWindowLabel?: string | null;
  suggestedNextUpdateAtIso?: string | null;
  previousWindowStartIso?: string | null;
  previousWindowEndIso?: string | null;
  currentWindowStartIso?: string | null;
  currentWindowEndIso?: string | null;
  delayEpisodeId?: string | null;
  delayFollowUpOrdinal?: number | null;
  storageStatus?: ReservationStorageStatus | null;
  previousStorageStatus?: ReservationStorageStatus | null;
  reminderOrdinal?: number | null;
  reminderCount?: number | null;
  readyForPickupAtIso?: string | null;
  policyWindowLabel?: string | null;
};

type NotificationAudienceSegment = "all" | "members" | "staff";

type NotificationJob = {
  type:
    | "KILN_UNLOADED"
    | "RESERVATION_STATUS"
    | "RESERVATION_ETA_SHIFT"
    | "RESERVATION_READY_PICKUP"
    | "RESERVATION_DELAY_FOLLOW_UP"
    | "RESERVATION_PICKUP_REMINDER";
  createdAt: Timestamp;
  runAfter?: Timestamp | null;
  uid: string;
  channels: { inApp: boolean; email: boolean; push: boolean; sms: boolean };
  payload: NotificationPayload;
  attemptCount: number;
  lastError?: string;
  status: "queued" | "processing" | "done" | "failed" | "skipped";
};

type NotificationErrorClass =
  | "provider_4xx"
  | "provider_5xx"
  | "network"
  | "auth"
  | "unknown";

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  channels: {
    inApp: true,
    email: false,
    push: false,
    sms: false,
  },
  events: {
    kilnUnloaded: true,
    kilnUnloadedBisque: true,
    kilnUnloadedGlaze: true,
  },
  quietHours: {
    enabled: false,
    startLocal: "21:00",
    endLocal: "08:00",
    timezone: "America/Phoenix",
  },
  frequency: {
    mode: "immediate",
    digestHours: 6,
  },
};

function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseLocalMinutes(raw: string, fallback: number): number {
  const parts = raw.split(":").map((chunk) => chunk.trim());
  if (parts.length < 2) return fallback;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  const clampedHours = Math.min(23, Math.max(0, Math.trunc(hours)));
  const clampedMinutes = Math.min(59, Math.max(0, Math.trunc(minutes)));
  return clampedHours * 60 + clampedMinutes;
}

function isWithinQuietHours(localMinutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    return localMinutes >= startMinutes && localMinutes < endMinutes;
  }
  return localMinutes >= startMinutes || localMinutes < endMinutes;
}

function resolveRunAfter(base: Date, prefs: NotificationPrefs): Date | null {
  let targetDate = new Date(base.getTime());
  const freq = prefs.frequency?.mode ?? "immediate";
  const digestHours = prefs.frequency?.digestHours ?? DEFAULT_PREFS.frequency.digestHours ?? 6;
  if (freq === "digest") {
    targetDate = new Date(targetDate.getTime() + digestHours * 60 * 60 * 1000);
  }

  const quiet = prefs.quietHours;
  if (!quiet || !quiet.enabled) return targetDate;

  const timeZone = quiet.timezone || DEFAULT_PREFS.quietHours?.timezone || "America/Phoenix";
  const localNow = new Date(targetDate.toLocaleString("en-US", { timeZone }));
  const localMinutes = localNow.getHours() * 60 + localNow.getMinutes();
  const startMinutes = parseLocalMinutes(
    quiet.startLocal || DEFAULT_PREFS.quietHours?.startLocal || "21:00",
    21 * 60
  );
  const endMinutes = parseLocalMinutes(
    quiet.endLocal || DEFAULT_PREFS.quietHours?.endLocal || "08:00",
    8 * 60
  );

  if (!isWithinQuietHours(localMinutes, startMinutes, endMinutes)) {
    return targetDate;
  }

  const targetLocal = new Date(localNow.getTime());
  targetLocal.setSeconds(0, 0);
  if (startMinutes < endMinutes) {
    targetLocal.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
    if (localMinutes >= endMinutes) {
      targetLocal.setDate(targetLocal.getDate() + 1);
    }
  } else {
    if (localMinutes >= startMinutes) {
      targetLocal.setDate(targetLocal.getDate() + 1);
    }
    targetLocal.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
  }

  const diffMs = targetLocal.getTime() - localNow.getTime();
  return new Date(targetDate.getTime() + diffMs);
}

function mergePrefs(data?: Partial<NotificationPrefs> | null): NotificationPrefs {
  const prefs = data ?? {};
  return {
    enabled: prefs.enabled ?? DEFAULT_PREFS.enabled,
    channels: {
      inApp: prefs.channels?.inApp ?? DEFAULT_PREFS.channels.inApp,
      email: prefs.channels?.email ?? DEFAULT_PREFS.channels.email,
      push: prefs.channels?.push ?? DEFAULT_PREFS.channels.push,
      sms: prefs.channels?.sms ?? DEFAULT_PREFS.channels.sms,
    },
    events: {
      kilnUnloaded: prefs.events?.kilnUnloaded ?? DEFAULT_PREFS.events.kilnUnloaded,
      kilnUnloadedBisque:
        prefs.events?.kilnUnloadedBisque ?? DEFAULT_PREFS.events.kilnUnloadedBisque,
      kilnUnloadedGlaze:
        prefs.events?.kilnUnloadedGlaze ?? DEFAULT_PREFS.events.kilnUnloadedGlaze,
    },
    quietHours: {
      enabled: prefs.quietHours?.enabled ?? DEFAULT_PREFS.quietHours?.enabled ?? false,
      startLocal: prefs.quietHours?.startLocal ?? DEFAULT_PREFS.quietHours?.startLocal ?? "21:00",
      endLocal: prefs.quietHours?.endLocal ?? DEFAULT_PREFS.quietHours?.endLocal ?? "08:00",
      timezone: prefs.quietHours?.timezone ?? DEFAULT_PREFS.quietHours?.timezone ?? "America/Phoenix",
    },
    frequency: {
      mode: prefs.frequency?.mode ?? DEFAULT_PREFS.frequency.mode,
      digestHours: prefs.frequency?.digestHours ?? DEFAULT_PREFS.frequency.digestHours,
    },
  };
}

async function readPrefs(uid: string): Promise<NotificationPrefs> {
  const ref = db.collection("users").doc(uid).collection("prefs").doc("notifications");
  const snap = await ref.get();
  if (!snap.exists) return mergePrefs(null);
  return mergePrefs(snap.data() as Partial<NotificationPrefs>);
}

async function resolveKilnName(kilnId?: string | null): Promise<string | null> {
  if (!kilnId) return null;
  const snap = await db.collection("kilns").doc(kilnId).get();
  if (!snap.exists) return null;
  return safeString((snap.data() as Record<string, unknown>)?.name) || null;
}

async function loadBatchOwners(batchIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(batchIds)).filter(Boolean);
  const ownerMap = new Map<string, string>();
  for (let i = 0; i < uniqueIds.length; i += 500) {
    const chunk = uniqueIds.slice(i, i + 500);
    const refs = chunk.map((batchId) => db.collection("batches").doc(batchId));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap) => {
      if (!snap.exists) return;
      const data = snap.data() as Record<string, unknown> | undefined;
      if (typeof data?.ownerUid === "string") {
        ownerMap.set(snap.id, data.ownerUid);
      }
    });
  }
  return ownerMap;
}

async function resolveOwnersFromPieceIds(pieceIds: string[]): Promise<Map<string, string[]>> {
  const uniqueIds = Array.from(new Set(pieceIds)).filter(Boolean);
  const batchIds = new Set<string>();
  const pieceToBatch = new Map<string, string>();
  for (let i = 0; i < uniqueIds.length; i += 10) {
    const chunk = uniqueIds.slice(i, i + 10);
    const snap = await db
      .collectionGroup("pieces")
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    snap.forEach((docSnap) => {
      const batchId = docSnap.ref.parent.parent?.id;
      if (batchId) {
        pieceToBatch.set(docSnap.id, batchId);
        batchIds.add(batchId);
      }
    });
  }
  const ownerMap = await loadBatchOwners(Array.from(batchIds));
  const pieceOwners = new Map<string, string[]>();
  pieceToBatch.forEach((batchId, pieceId) => {
    const ownerUid = ownerMap.get(batchId);
    if (!ownerUid) return;
    if (!pieceOwners.has(ownerUid)) pieceOwners.set(ownerUid, []);
    pieceOwners.get(ownerUid)?.push(pieceId);
  });
  return pieceOwners;
}

function isStaffClaims(claims: Record<string, unknown> | undefined): boolean {
  if (!claims) return false;
  if (claims.staff === true) return true;
  const roles = claims.roles;
  return Array.isArray(roles) && roles.includes("staff");
}

async function filterRecipientUidsBySegment(
  uids: string[],
  segment: NotificationAudienceSegment
): Promise<string[]> {
  if (segment === "all") return uids;
  if (!uids.length) return [];

  const checks = await Promise.all(
    uids.map(async (uid) => {
      try {
        const user = await adminAuth.getUser(uid);
        const staff = isStaffClaims(user.customClaims as Record<string, unknown> | undefined);
        return { uid, staff };
      } catch {
        return { uid, staff: false };
      }
    })
  );

  if (segment === "staff") {
    return checks.filter((entry) => entry.staff).map((entry) => entry.uid);
  }
  return checks.filter((entry) => !entry.staff).map((entry) => entry.uid);
}

function shouldNotify(
  prefs: NotificationPrefs,
  firingType: "bisque" | "glaze" | null
): boolean {
  if (!prefs.enabled) return false;
  if (!prefs.events.kilnUnloaded) return false;
  if (firingType === "bisque" && !prefs.events.kilnUnloadedBisque) return false;
  if (firingType === "glaze" && !prefs.events.kilnUnloadedGlaze) return false;
  return true;
}

type ReservationEstimatedWindowSnapshot = {
  currentStart: Timestamp | null;
  currentEnd: Timestamp | null;
  updatedAt: Timestamp | null;
  slaState: string | null;
  confidence: string | null;
};

type ReservationStorageNoticeEntry = {
  at: Timestamp | null;
  kind: string;
  detail: string | null;
  status: ReservationStorageStatus | null;
  reminderOrdinal: number | null;
  reminderCount: number | null;
  failureCode: string | null;
};

type ReservationPickupWindowSnapshot = {
  requestedStart: Timestamp | null;
  requestedEnd: Timestamp | null;
  confirmedStart: Timestamp | null;
  confirmedEnd: Timestamp | null;
  status: ReservationPickupWindowStatus | null;
  confirmedAt: Timestamp | null;
  completedAt: Timestamp | null;
  missedCount: number;
  rescheduleCount: number;
  lastMissedAt: Timestamp | null;
  lastRescheduleRequestedAt: Timestamp | null;
};

type ReservationNotificationSnapshot = {
  ownerUid: string;
  status: string | null;
  loadStatus: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  estimatedWindow: ReservationEstimatedWindowSnapshot;
  stageReason: string | null;
  stageNotes: string | null;
  staffNotes: string | null;
  storageStatus: ReservationStorageStatus | null;
  readyForPickupAt: Timestamp | null;
  pickupReminderCount: number;
  lastReminderAt: Timestamp | null;
  pickupReminderFailureCount: number;
  lastReminderFailureAt: Timestamp | null;
  storageNoticeHistory: ReservationStorageNoticeEntry[];
  pickupWindow: ReservationPickupWindowSnapshot;
};

type ReservationNotificationRouting = {
  prefs: NotificationPrefs;
  notifyReservations: boolean;
  channels: {
    inApp: boolean;
    email: boolean;
    push: boolean;
    sms: boolean;
  };
};

function parseTimestampValue(value: unknown): Timestamp | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Timestamp.fromDate(value);
  }
  if (asRecord(value) && typeof value.toDate === "function") {
    try {
      const asDate = value.toDate();
      if (asDate instanceof Date && Number.isFinite(asDate.getTime())) {
        return Timestamp.fromDate(asDate);
      }
    } catch {
      return null;
    }
  }
  if (asRecord(value) && typeof value.seconds === "number") {
    const seconds = Number(value.seconds);
    const nanos =
      typeof value.nanoseconds === "number" && Number.isFinite(value.nanoseconds)
        ? Math.max(0, Number(value.nanoseconds))
        : 0;
    if (!Number.isFinite(seconds)) return null;
    const millis = Math.trunc(seconds * 1000 + nanos / 1_000_000);
    return Timestamp.fromMillis(millis);
  }
  if (typeof value === "string" && value.trim()) {
    const asDate = new Date(value);
    if (Number.isFinite(asDate.getTime())) {
      return Timestamp.fromDate(asDate);
    }
  }
  return null;
}

function tsIso(value: Timestamp | null): string | null {
  if (!value) return null;
  try {
    return value.toDate().toISOString();
  } catch {
    return null;
  }
}

function tsMillis(value: Timestamp | null): number | null {
  if (!value) return null;
  try {
    return value.toMillis();
  } catch {
    return null;
  }
}

function normalizeReservationStatusValue(value: unknown): string | null {
  const normalized = safeString(value).trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "CANCELED") return "CANCELLED";
  return normalized;
}

function normalizeReservationLoadStatusValue(value: unknown): string | null {
  const normalized = safeString(value).trim().toLowerCase();
  return normalized || null;
}

function normalizeReservationStorageStatusValue(value: unknown): ReservationStorageStatus | null {
  const normalized = safeString(value).trim().toLowerCase();
  if (
    normalized === "active" ||
    normalized === "reminder_pending" ||
    normalized === "hold_pending" ||
    normalized === "stored_by_policy"
  ) {
    return normalized;
  }
  return null;
}

function normalizeReservationPickupWindowStatusValue(value: unknown): ReservationPickupWindowStatus | null {
  const normalized = safeString(value).trim().toLowerCase();
  if (
    normalized === "open" ||
    normalized === "confirmed" ||
    normalized === "missed" ||
    normalized === "expired" ||
    normalized === "completed"
  ) {
    return normalized;
  }
  return null;
}

function normalizeReminderCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function normalizeStorageNoticeHistory(raw: unknown): ReservationStorageNoticeEntry[] {
  if (!Array.isArray(raw)) return [];
  const rows: ReservationStorageNoticeEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const source = row as Record<string, unknown>;
    const kind = safeString(source.kind).trim();
    if (!kind) continue;
    rows.push({
      at: parseTimestampValue(source.at),
      kind,
      detail: safeString(source.detail).trim() || null,
      status: normalizeReservationStorageStatusValue(source.status),
      reminderOrdinal: normalizeReminderCount(source.reminderOrdinal) || null,
      reminderCount: normalizeReminderCount(source.reminderCount) || null,
      failureCode: safeString(source.failureCode).trim() || null,
    });
  }
  return rows.slice(-RESERVATION_STORAGE_HISTORY_MAX);
}

function normalizeStorageNoticeForWrite(entry: ReservationStorageNoticeEntry): Record<string, unknown> {
  return {
    at: entry.at ?? nowTs(),
    kind: entry.kind,
    detail: entry.detail ?? null,
    status: entry.status ?? null,
    reminderOrdinal: entry.reminderOrdinal ?? null,
    reminderCount: entry.reminderCount ?? null,
    failureCode: entry.failureCode ?? null,
  };
}

function normalizePickupWindowForWrite(window: ReservationPickupWindowSnapshot): Record<string, unknown> {
  return {
    requestedStart: window.requestedStart ?? null,
    requestedEnd: window.requestedEnd ?? null,
    confirmedStart: window.confirmedStart ?? null,
    confirmedEnd: window.confirmedEnd ?? null,
    status: window.status ?? "open",
    confirmedAt: window.confirmedAt ?? null,
    completedAt: window.completedAt ?? null,
    missedCount: Math.max(0, Math.trunc(window.missedCount)),
    rescheduleCount: Math.max(0, Math.trunc(window.rescheduleCount)),
    lastMissedAt: window.lastMissedAt ?? null,
    lastRescheduleRequestedAt: window.lastRescheduleRequestedAt ?? null,
  };
}

function parseReservationSnapshot(value: Record<string, unknown> | undefined): ReservationNotificationSnapshot {
  const estimatedWindow = asRecord(value?.estimatedWindow)
    ? (value.estimatedWindow as Record<string, unknown>)
    : {};
  const stageStatus = asRecord(value?.stageStatus)
    ? (value.stageStatus as Record<string, unknown>)
    : {};
  const pickupWindow = asRecord(value?.pickupWindow)
    ? (value.pickupWindow as Record<string, unknown>)
    : {};

  return {
    ownerUid: safeString(value?.ownerUid),
    status: normalizeReservationStatusValue(value?.status),
    loadStatus: normalizeReservationLoadStatusValue(value?.loadStatus),
    createdAt: parseTimestampValue(value?.createdAt),
    updatedAt: parseTimestampValue(value?.updatedAt),
    estimatedWindow: {
      currentStart: parseTimestampValue(estimatedWindow.currentStart),
      currentEnd: parseTimestampValue(estimatedWindow.currentEnd),
      updatedAt: parseTimestampValue(estimatedWindow.updatedAt),
      slaState: safeString(estimatedWindow.slaState).trim().toLowerCase() || null,
      confidence: safeString(estimatedWindow.confidence).trim().toLowerCase() || null,
    },
    stageReason: safeString(stageStatus.reason).trim() || null,
    stageNotes: safeString(stageStatus.notes).trim() || null,
    staffNotes: safeString(value?.staffNotes).trim() || null,
    storageStatus: normalizeReservationStorageStatusValue(value?.storageStatus),
    readyForPickupAt: parseTimestampValue(value?.readyForPickupAt),
    pickupReminderCount: normalizeReminderCount(value?.pickupReminderCount),
    lastReminderAt: parseTimestampValue(value?.lastReminderAt),
    pickupReminderFailureCount: normalizeReminderCount(value?.pickupReminderFailureCount),
    lastReminderFailureAt: parseTimestampValue(value?.lastReminderFailureAt),
    storageNoticeHistory: normalizeStorageNoticeHistory(value?.storageNoticeHistory),
    pickupWindow: {
      requestedStart: parseTimestampValue(pickupWindow.requestedStart),
      requestedEnd: parseTimestampValue(pickupWindow.requestedEnd),
      confirmedStart: parseTimestampValue(pickupWindow.confirmedStart),
      confirmedEnd: parseTimestampValue(pickupWindow.confirmedEnd),
      status: normalizeReservationPickupWindowStatusValue(pickupWindow.status),
      confirmedAt: parseTimestampValue(pickupWindow.confirmedAt),
      completedAt: parseTimestampValue(pickupWindow.completedAt),
      missedCount: normalizeReminderCount(pickupWindow.missedCount),
      rescheduleCount: normalizeReminderCount(pickupWindow.rescheduleCount),
      lastMissedAt: parseTimestampValue(pickupWindow.lastMissedAt),
      lastRescheduleRequestedAt: parseTimestampValue(pickupWindow.lastRescheduleRequestedAt),
    },
  };
}

function currentStorageStatus(snapshot: ReservationNotificationSnapshot): ReservationStorageStatus {
  return snapshot.storageStatus ?? "active";
}

function storageStatusForElapsed(params: {
  elapsedMs: number;
  reminderCount: number;
}): ReservationStorageStatus {
  const elapsedMs = Math.max(0, params.elapsedMs);
  if (elapsedMs >= RESERVATION_STORAGE_STORED_BY_POLICY_MS) return "stored_by_policy";
  if (elapsedMs >= RESERVATION_STORAGE_HOLD_PENDING_MS) return "hold_pending";
  if (params.reminderCount > 0) return "reminder_pending";
  return "active";
}

function nextDueReminderOrdinal(params: {
  elapsedMs: number;
  currentCount: number;
}): number | null {
  const nextOrdinal = Math.max(1, params.currentCount + 1);
  if (nextOrdinal > RESERVATION_STORAGE_REMINDER_SCHEDULE_MS.length) return null;
  const thresholdMs = RESERVATION_STORAGE_REMINDER_SCHEDULE_MS[nextOrdinal - 1];
  if (params.elapsedMs < thresholdMs) return null;
  return nextOrdinal;
}

function storagePolicyWindowLabel(reminderOrdinal: number): string {
  const nextThreshold = RESERVATION_STORAGE_REMINDER_SCHEDULE_MS[reminderOrdinal] ?? RESERVATION_STORAGE_HOLD_PENDING_MS;
  const nextHours = Math.round(nextThreshold / (60 * 60 * 1000));
  if (reminderOrdinal >= 3) {
    return "Final reminder window. Reservation moves to storage hold soon if pickup is still pending.";
  }
  return `Next storage policy checkpoint is around ${nextHours} hours after pickup-ready status.`;
}

function pushStorageNotice(
  history: ReservationStorageNoticeEntry[],
  notice: Omit<ReservationStorageNoticeEntry, "at"> & { at?: Timestamp | null }
): ReservationStorageNoticeEntry[] {
  const next = [...history];
  next.push({
    at: notice.at ?? nowTs(),
    kind: notice.kind,
    detail: notice.detail ?? null,
    status: notice.status ?? null,
    reminderOrdinal: notice.reminderOrdinal ?? null,
    reminderCount: notice.reminderCount ?? null,
    failureCode: notice.failureCode ?? null,
  });
  return next.slice(-RESERVATION_STORAGE_HISTORY_MAX);
}

async function writeReservationStorageAudit(params: {
  reservationId: string;
  uid: string;
  action: string;
  reason: string;
  at?: Timestamp | null;
  fromStatus?: ReservationStorageStatus | null;
  toStatus?: ReservationStorageStatus | null;
  reminderOrdinal?: number | null;
  reminderCount?: number | null;
  requestId?: string | null;
  failureCode?: string | null;
}): Promise<void> {
  const at = params.at ?? nowTs();
  const auditId = hashId(
    [
      params.reservationId,
      params.action,
      safeString(params.requestId) || "none",
      tsIso(at) ?? String(Date.now()),
      safeString(params.reason),
      String(params.reminderOrdinal ?? ""),
      String(params.reminderCount ?? ""),
    ].join(":")
  );
  await db.collection("reservationStorageAudit").doc(auditId).set(
    {
      reservationId: params.reservationId,
      uid: params.uid,
      action: params.action,
      reason: params.reason,
      fromStatus: params.fromStatus ?? null,
      toStatus: params.toStatus ?? null,
      reminderOrdinal: params.reminderOrdinal ?? null,
      reminderCount: params.reminderCount ?? null,
      requestId: params.requestId ?? null,
      failureCode: params.failureCode ?? null,
      at,
      createdAt: nowTs(),
    },
    { merge: true }
  );
}

function reservationEstimatedWindowChanged(
  before: ReservationEstimatedWindowSnapshot,
  after: ReservationEstimatedWindowSnapshot
): boolean {
  return (
    tsMillis(before.currentStart) !== tsMillis(after.currentStart) ||
    tsMillis(before.currentEnd) !== tsMillis(after.currentEnd) ||
    before.slaState !== after.slaState ||
    before.confidence !== after.confidence
  );
}

function reservationEstimatedWindowLabel(window: ReservationEstimatedWindowSnapshot): string | null {
  const startIso = tsIso(window.currentStart);
  const endIso = tsIso(window.currentEnd);
  if (startIso && endIso) return `${startIso} -> ${endIso}`;
  if (startIso) return `from ${startIso}`;
  if (endIso) return `until ${endIso}`;
  return null;
}

function buildReservationReason(
  after: ReservationNotificationSnapshot,
  fallback: string
): string {
  return after.stageReason ?? after.stageNotes ?? after.staffNotes ?? fallback;
}

function suggestedReservationUpdateIso(
  after: ReservationNotificationSnapshot,
  delayMode: "none" | "initial" | "follow_up"
): string | null {
  const anchor = after.estimatedWindow.updatedAt ?? after.updatedAt;
  if (!anchor) return null;
  const baseMs = anchor.toMillis();
  const offsetMs =
    delayMode === "initial"
      ? RESERVATION_DELAY_FOLLOW_UP_INITIAL_MS
      : delayMode === "follow_up"
        ? RESERVATION_DELAY_FOLLOW_UP_REPEAT_MS
        : 24 * 60 * 60 * 1000;
  return new Date(baseMs + offsetMs).toISOString();
}

async function readReservationNotifyPreference(uid: string): Promise<boolean> {
  const snap = await db.collection("profiles").doc(uid).get();
  if (!snap.exists) return true;
  const data = snap.data() as Record<string, unknown> | undefined;
  if (!data) return true;
  return typeof data.notifyReservations === "boolean" ? data.notifyReservations : true;
}

function hasEnabledChannels(channels: { inApp: boolean; email: boolean; push: boolean; sms: boolean }): boolean {
  return channels.inApp || channels.email || channels.push || channels.sms;
}

async function readReservationRouting(uid: string): Promise<ReservationNotificationRouting> {
  const prefs = await readPrefs(uid);
  const notifyReservations = await readReservationNotifyPreference(uid);
  const channels = {
    inApp: prefs.channels.inApp,
    email: prefs.channels.email,
    push: prefs.channels.push,
    sms: prefs.channels.sms,
  };
  return {
    prefs,
    notifyReservations,
    channels,
  };
}

async function createJob(job: NotificationJob): Promise<void> {
  const jobId = hashId(job.payload.dedupeKey);
  const ref = db.collection("notificationJobs").doc(jobId);
  try {
    await ref.create(job);
  } catch (error: unknown) {
    if (
      (asRecord(error) && "code" in error && error.code === 6) ||
      (asRecord(error) && "code" in error && error.code === "already-exists")
    ) {
      return;
    }
    throw error;
  }
}

async function enqueueReservationNotificationJob(params: {
  uid: string;
  type:
    | "RESERVATION_STATUS"
    | "RESERVATION_ETA_SHIFT"
    | "RESERVATION_READY_PICKUP"
    | "RESERVATION_DELAY_FOLLOW_UP"
    | "RESERVATION_PICKUP_REMINDER";
  payload: NotificationPayload;
  routing?: ReservationNotificationRouting | null;
  runAfter?: Timestamp | null;
}): Promise<void> {
  const routing = params.routing ?? (await readReservationRouting(params.uid));
  const runAfterDate =
    params.runAfter !== undefined
      ? null
      : resolveRunAfter(new Date(), routing.prefs);
  const runAfter = params.runAfter !== undefined
    ? params.runAfter
    : runAfterDate
      ? Timestamp.fromDate(runAfterDate)
      : null;
  const baseJob: NotificationJob = {
    type: params.type,
    createdAt: nowTs(),
    runAfter,
    uid: params.uid,
    channels: routing.channels,
    payload: params.payload,
    attemptCount: 0,
    status: "queued",
  };

  if (!routing.notifyReservations) {
    await createJob({
      ...baseJob,
      status: "skipped",
      lastError: "RESERVATION_PREF_DISABLED",
    });
    return;
  }
  if (!routing.prefs.enabled) {
    await createJob({
      ...baseJob,
      status: "skipped",
      lastError: "PREFS_DISABLED",
    });
    return;
  }
  if (!hasEnabledChannels(routing.channels)) {
    await createJob({
      ...baseJob,
      status: "skipped",
      lastError: "NO_CHANNELS_ENABLED",
    });
    return;
  }

  await createJob(baseJob);
}

async function enqueueNotifications(params: {
  firingId: string;
  firingType: "bisque" | "glaze" | null;
  kilnId?: string | null;
  kilnName?: string | null;
  batchIds: string[];
  pieceIds: string[];
  owners: Map<string, { batchIds: string[]; pieceIds: string[] }>;
  segment?: NotificationAudienceSegment;
}): Promise<void> {
  const { firingId, firingType, kilnId, kilnName, batchIds, pieceIds, owners, segment = "members" } = params;
  const eligibleUids = new Set(
    await filterRecipientUidsBySegment(Array.from(owners.keys()), segment)
  );
  const now = nowTs();
  for (const [uid, ownerData] of owners.entries()) {
    if (!eligibleUids.has(uid)) {
      logger.info("Notification recipient skipped by audience segment", {
        uid,
        segment,
        firingId,
      });
      continue;
    }

    const prefs = await readPrefs(uid);
    const dedupeKey = `KILN_UNLOADED:${firingId}:${uid}`;
    const payload: NotificationPayload = {
      dedupeKey,
      firingId,
      kilnId: kilnId ?? null,
      kilnName: kilnName ?? null,
      firingType,
      batchIds: ownerData.batchIds.length ? ownerData.batchIds : batchIds,
      pieceIds: ownerData.pieceIds.length ? ownerData.pieceIds : pieceIds,
    };

    const runAfterDate = resolveRunAfter(new Date(), prefs);
    const runAfter = runAfterDate ? Timestamp.fromDate(runAfterDate) : null;

    const baseJob: NotificationJob = {
      type: "KILN_UNLOADED",
      createdAt: now,
      runAfter,
      uid,
      channels: {
        inApp: prefs.channels.inApp,
        email: prefs.channels.email,
        push: prefs.channels.push,
        sms: prefs.channels.sms,
      },
      payload,
      attemptCount: 0,
      status: "queued",
    };

    if (!shouldNotify(prefs, firingType)) {
      await createJob({
        ...baseJob,
        status: "skipped",
        lastError: "PREFS_DISABLED",
      });
      continue;
    }

    await createJob(baseJob);
  }
}

export const onKilnFiringUnloaded = onDocumentWritten(
  { region: REGION, document: "kilnFirings/{firingId}" },
  async (event) => {
    const before = event.data?.before.data() as Record<string, unknown> | undefined;
    const after = event.data?.after.data() as Record<string, unknown> | undefined;
    if (!after) return;

    const beforeUnloaded = Boolean(before?.unloadedAt);
    const afterUnloaded = Boolean(after?.unloadedAt);
    if (beforeUnloaded || !afterUnloaded) return;

    const firingId = event.params.firingId;
    const kilnId = safeString(after.kilnId) || null;
    const firingTypeRaw = safeString(after.cycleType).toLowerCase();
    const firingType =
      firingTypeRaw === "bisque" ? "bisque" : firingTypeRaw === "glaze" ? "glaze" : null;

    const batchIds = Array.isArray(after.batchIds)
      ? after.batchIds
          .map((id) => safeString(id))
          .filter((value): value is string => value.length > 0)
      : [];
    const pieceIds = Array.isArray(after.pieceIds)
      ? after.pieceIds
          .map((id) => safeString(id))
          .filter((value): value is string => value.length > 0)
      : [];

    const owners = new Map<string, { batchIds: string[]; pieceIds: string[] }>();
    const addOwner = (uid: string, batchId?: string, pieceId?: string) => {
      if (!owners.has(uid)) {
        owners.set(uid, { batchIds: [], pieceIds: [] });
      }
      const entry = owners.get(uid);
      if (!entry) return;
      if (batchId && !entry.batchIds.includes(batchId)) entry.batchIds.push(batchId);
      if (pieceId && !entry.pieceIds.includes(pieceId)) entry.pieceIds.push(pieceId);
    };

    if (batchIds.length) {
      const batchOwners = await loadBatchOwners(batchIds);
      batchOwners.forEach((ownerUid, batchId) => addOwner(ownerUid, batchId));
    }

    if (pieceIds.length) {
      const pieceOwners = await resolveOwnersFromPieceIds(pieceIds);
      pieceOwners.forEach((ownedPieces, ownerUid) => {
        ownedPieces.forEach((pieceId) => addOwner(ownerUid, undefined, pieceId));
      });
    }

    if (owners.size === 0) {
      logger.warn("Kiln unload notification skipped: no owners resolved", {
        firingId,
        batchIdsCount: batchIds.length,
        pieceIdsCount: pieceIds.length,
      });
      return;
    }

    const kilnName = safeString(after.kilnName) || (await resolveKilnName(kilnId));

    logger.info("Kiln unload notification queued", {
      firingId,
      owners: owners.size,
      kilnName,
      firingType,
    });

    await enqueueNotifications({
      firingId,
      firingType,
      kilnId,
      kilnName,
      batchIds,
      pieceIds,
      owners,
    });
  }
);

export const onReservationLifecycleUpdated = onDocumentWritten(
  { region: REGION, document: "reservations/{reservationId}" },
  async (event) => {
    const beforeRaw = event.data?.before.data() as Record<string, unknown> | undefined;
    const afterRaw = event.data?.after.data() as Record<string, unknown> | undefined;
    if (!afterRaw) return;

    const reservationId = event.params.reservationId;
    const before = parseReservationSnapshot(beforeRaw);
    const after = parseReservationSnapshot(afterRaw);
    const uid = after.ownerUid;

    if (!uid) {
      logger.warn("Reservation notification skipped: missing owner", {
        reservationId,
      });
      return;
    }

    const routing = await readReservationRouting(uid);
    const updatedAtMs = tsMillis(after.updatedAt) ?? Date.now();
    const updatedAtIso = tsIso(after.updatedAt) ?? new Date(updatedAtMs).toISOString();

    const statusChanged = before.status !== after.status;
    const loadChanged = before.loadStatus !== after.loadStatus;
    const windowChanged = reservationEstimatedWindowChanged(before.estimatedWindow, after.estimatedWindow);
    const pickupWindowStatusChanged = before.pickupWindow.status !== after.pickupWindow.status;
    const becameLoaded =
      (after.loadStatus === "loaded" && before.loadStatus !== "loaded") ||
      (after.status === "LOADED" && before.status !== "LOADED");

    const currentWindowStartIso = tsIso(after.estimatedWindow.currentStart);
    const currentWindowEndIso = tsIso(after.estimatedWindow.currentEnd);
    const previousWindowStartIso = tsIso(before.estimatedWindow.currentStart);
    const previousWindowEndIso = tsIso(before.estimatedWindow.currentEnd);
    const estimateWindowLabel = reservationEstimatedWindowLabel(after.estimatedWindow);
    const pickupWindowEndIso = tsIso(after.pickupWindow.confirmedEnd);
    const delayEpisodeId =
      tsIso(after.estimatedWindow.updatedAt) ?? updatedAtIso;
    const suggestedInitialDelayIso = suggestedReservationUpdateIso(after, "initial");

    if (
      statusChanged &&
      (after.status === "CONFIRMED" || after.status === "WAITLISTED" || after.status === "CANCELLED")
    ) {
      const eventKind =
        after.status === "CONFIRMED"
          ? "confirmed"
          : after.status === "WAITLISTED"
            ? "waitlisted"
            : "cancelled";
      const reason = buildReservationReason(after, `Reservation moved to ${after.status}.`);
      await enqueueReservationNotificationJob({
        uid,
        type: "RESERVATION_STATUS",
        routing,
        payload: {
          dedupeKey: `RESERVATION_STATUS:${reservationId}:${before.status ?? "unknown"}:${after.status}:${updatedAtMs}`,
          firingId: reservationId,
          reservationId,
          reservationStatus: after.status,
          previousReservationStatus: before.status,
          reservationLoadStatus: after.loadStatus,
          previousReservationLoadStatus: before.loadStatus,
          eventKind,
          reason,
          estimateWindowLabel,
          suggestedNextUpdateAtIso:
            after.status === "CANCELLED" ? null : suggestedReservationUpdateIso(after, "none"),
          previousWindowStartIso,
          previousWindowEndIso,
          currentWindowStartIso,
          currentWindowEndIso,
        },
      });
    }

    if (
      windowChanged &&
      (after.status === "CONFIRMED" || after.status === "WAITLISTED")
    ) {
      const reason = buildReservationReason(
        after,
        "Estimated firing window shifted based on live queue and kiln availability."
      );
      await enqueueReservationNotificationJob({
        uid,
        type: "RESERVATION_ETA_SHIFT",
        routing,
        payload: {
          dedupeKey: `RESERVATION_ETA_SHIFT:${reservationId}:${previousWindowStartIso ?? "null"}:${previousWindowEndIso ?? "null"}:${currentWindowStartIso ?? "null"}:${currentWindowEndIso ?? "null"}:${after.estimatedWindow.slaState ?? "unknown"}`,
          firingId: reservationId,
          reservationId,
          reservationStatus: after.status,
          previousReservationStatus: before.status,
          reservationLoadStatus: after.loadStatus,
          previousReservationLoadStatus: before.loadStatus,
          eventKind: "estimate_shift",
          reason,
          estimateWindowLabel,
          suggestedNextUpdateAtIso:
            after.estimatedWindow.slaState === "delayed"
              ? suggestedInitialDelayIso
              : suggestedReservationUpdateIso(after, "none"),
          previousWindowStartIso,
          previousWindowEndIso,
          currentWindowStartIso,
          currentWindowEndIso,
          delayEpisodeId,
        },
      });

      if (after.estimatedWindow.slaState === "delayed") {
        const baseRunAfter = new Date(Date.now() + RESERVATION_DELAY_FOLLOW_UP_INITIAL_MS);
        const resolvedRunAfter = resolveRunAfter(baseRunAfter, routing.prefs) ?? baseRunAfter;
        const runAfter = Timestamp.fromDate(resolvedRunAfter);
        await enqueueReservationNotificationJob({
          uid,
          type: "RESERVATION_DELAY_FOLLOW_UP",
          routing,
          runAfter,
          payload: {
            dedupeKey: `RESERVATION_DELAY_FOLLOW_UP:${reservationId}:${delayEpisodeId}:1`,
            firingId: reservationId,
            reservationId,
            reservationStatus: after.status,
            previousReservationStatus: before.status,
            reservationLoadStatus: after.loadStatus,
            previousReservationLoadStatus: before.loadStatus,
            eventKind: "delay_follow_up",
            reason: buildReservationReason(
              after,
              "Your reservation remains delayed while we work through active kiln constraints."
            ),
            estimateWindowLabel,
            suggestedNextUpdateAtIso: tsIso(runAfter),
            previousWindowStartIso,
            previousWindowEndIso,
            currentWindowStartIso,
            currentWindowEndIso,
            delayEpisodeId,
            delayFollowUpOrdinal: 1,
          },
        });
      }
    }

    if (pickupWindowStatusChanged && after.pickupWindow.status === "open") {
      const readyForPickupAt = after.readyForPickupAt ?? after.updatedAt ?? nowTs();
      await enqueueReservationNotificationJob({
        uid,
        type: "RESERVATION_PICKUP_REMINDER",
        routing,
        payload: {
          dedupeKey: `RESERVATION_PICKUP_WINDOW_OPEN:${reservationId}:${updatedAtMs}`,
          firingId: reservationId,
          reservationId,
          reservationStatus: after.status,
          previousReservationStatus: before.status,
          reservationLoadStatus: after.loadStatus,
          previousReservationLoadStatus: before.loadStatus,
          eventKind: "pickup_reminder",
          reason: buildReservationReason(
            after,
            "Pickup window is now open. Please confirm your collection window."
          ),
          storageStatus: currentStorageStatus(after),
          previousStorageStatus: currentStorageStatus(before),
          reminderCount: after.pickupReminderCount,
          readyForPickupAtIso: tsIso(readyForPickupAt),
          policyWindowLabel: pickupWindowEndIso
            ? `Pickup window closes around ${formatIsoForUser(pickupWindowEndIso)}.`
            : "Pickup window is open. Confirm as soon as possible.",
          estimateWindowLabel,
          suggestedNextUpdateAtIso: pickupWindowEndIso ?? null,
        },
      });

      if (after.pickupWindow.confirmedEnd) {
        const preExpiryDate = new Date(
          after.pickupWindow.confirmedEnd.toMillis() - 24 * 60 * 60 * 1000
        );
        if (preExpiryDate.getTime() > Date.now()) {
          const resolvedRunAfter = resolveRunAfter(preExpiryDate, routing.prefs) ?? preExpiryDate;
          const runAfter = Timestamp.fromDate(resolvedRunAfter);
          await enqueueReservationNotificationJob({
            uid,
            type: "RESERVATION_PICKUP_REMINDER",
            routing,
            runAfter,
            payload: {
              dedupeKey: `RESERVATION_PICKUP_WINDOW_PRE_EXPIRY:${reservationId}:${after.pickupWindow.confirmedEnd.toMillis()}`,
              firingId: reservationId,
              reservationId,
              reservationStatus: after.status,
              previousReservationStatus: before.status,
              reservationLoadStatus: after.loadStatus,
              previousReservationLoadStatus: before.loadStatus,
              eventKind: "pickup_reminder",
              reason: buildReservationReason(
                after,
                "Pickup window reminder: your selected collection window is closing soon."
              ),
              storageStatus: currentStorageStatus(after),
              previousStorageStatus: currentStorageStatus(before),
              reminderCount: after.pickupReminderCount,
              readyForPickupAtIso: tsIso(readyForPickupAt),
              policyWindowLabel: "Pickup window closes in about 24 hours.",
              estimateWindowLabel,
              suggestedNextUpdateAtIso: tsIso(runAfter),
            },
          });
        }
      }
    }

    if (becameLoaded || (loadChanged && after.loadStatus === "loaded")) {
      const reason = buildReservationReason(
        after,
        "Reservation load is complete and ready for pickup planning."
      );
      const readyForPickupAt = after.readyForPickupAt ?? after.updatedAt ?? nowTs();
      await enqueueReservationNotificationJob({
        uid,
        type: "RESERVATION_READY_PICKUP",
        routing,
        payload: {
          dedupeKey: `RESERVATION_READY_PICKUP:${reservationId}:${updatedAtMs}`,
          firingId: reservationId,
          reservationId,
          reservationStatus: after.status,
          previousReservationStatus: before.status,
          reservationLoadStatus: after.loadStatus,
          previousReservationLoadStatus: before.loadStatus,
          eventKind: "pickup_ready",
          reason,
          storageStatus: "active",
          previousStorageStatus: currentStorageStatus(before),
          reminderCount: 0,
          readyForPickupAtIso: tsIso(readyForPickupAt),
          policyWindowLabel: "Pickup-ready notice sent. Storage reminders begin after 72 hours.",
          estimateWindowLabel,
          suggestedNextUpdateAtIso: null,
          previousWindowStartIso,
          previousWindowEndIso,
          currentWindowStartIso,
          currentWindowEndIso,
        },
      });

      const nextHistory = pushStorageNotice(after.storageNoticeHistory, {
        at: nowTs(),
        kind: "pickup_ready",
        detail: reason,
        status: "active",
        reminderOrdinal: null,
        reminderCount: 0,
        failureCode: null,
      });
      await db.collection("reservations").doc(reservationId).set(
        {
          readyForPickupAt,
          storageStatus: "active",
          pickupReminderCount: 0,
          lastReminderAt: null,
          pickupReminderFailureCount: 0,
          lastReminderFailureAt: null,
          storageNoticeHistory: nextHistory.map(normalizeStorageNoticeForWrite),
          updatedAt: nowTs(),
        },
        { merge: true }
      );
      await writeReservationStorageAudit({
        reservationId,
        uid,
        action: "pickup_ready",
        reason,
        fromStatus: currentStorageStatus(before),
        toStatus: "active",
        reminderCount: 0,
      });
    }
  }
);

function formatIsoForUser(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const asDate = new Date(iso);
  if (!Number.isFinite(asDate.getTime())) return null;
  return asDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatReservationEstimateLine(payload: NotificationPayload): string {
  const startLabel = formatIsoForUser(payload.currentWindowStartIso ?? null);
  const endLabel = formatIsoForUser(payload.currentWindowEndIso ?? null);
  if (startLabel && endLabel) {
    return `Updated estimate: ${startLabel} - ${endLabel}.`;
  }
  if (payload.estimateWindowLabel) {
    return `Updated estimate: ${payload.estimateWindowLabel}.`;
  }
  return "Updated estimate: We'll keep this current as queue conditions change.";
}

function formatReservationReasonLine(payload: NotificationPayload): string {
  const reason = safeString(payload.reason).trim();
  if (reason) return `Last change reason: ${reason}.`;
  return "Last change reason: queue and kiln availability were recalculated.";
}

function formatReservationNextUpdateLine(payload: NotificationPayload): string {
  const policyWindowLabel = safeString(payload.policyWindowLabel).trim();
  if (policyWindowLabel) {
    return policyWindowLabel;
  }
  const next = formatIsoForUser(payload.suggestedNextUpdateAtIso ?? null);
  if (next) return `Suggested next update window: around ${next}.`;
  return "Suggested next update window: within 24 hours or sooner if conditions change.";
}

function buildReservationNotificationCopy(job: NotificationJob): {
  title: string;
  body: string;
  subject: string;
  messageType: string;
} {
  const eventKind = job.payload.eventKind;
  const estimateLine = formatReservationEstimateLine(job.payload);
  const reasonLine = formatReservationReasonLine(job.payload);
  const nextLine = formatReservationNextUpdateLine(job.payload);

  if (eventKind === "confirmed") {
    return {
      title: "Reservation confirmed",
      subject: "Reservation confirmed",
      messageType: "RESERVATION_CONFIRMED",
      body: ["Your reservation is confirmed.", estimateLine, reasonLine, nextLine].join(" "),
    };
  }
  if (eventKind === "waitlisted") {
    return {
      title: "Reservation waitlisted",
      subject: "Reservation moved to waitlist",
      messageType: "RESERVATION_WAITLISTED",
      body: ["Your reservation is currently waitlisted.", estimateLine, reasonLine, nextLine].join(" "),
    };
  }
  if (eventKind === "cancelled") {
    return {
      title: "Reservation cancelled",
      subject: "Reservation cancelled",
      messageType: "RESERVATION_CANCELLED",
      body: [
        "Your reservation has been cancelled.",
        reasonLine,
        `Contact support with code ${hashId(job.payload.dedupeKey).slice(0, 8)} if this looks wrong.`,
      ].join(" "),
    };
  }
  if (eventKind === "pickup_ready") {
    return {
      title: "Ready for pickup",
      subject: "Reservation ready for pickup",
      messageType: "RESERVATION_READY_PICKUP",
      body: ["Your reservation is ready for pickup planning.", reasonLine, nextLine].join(" "),
    };
  }
  if (eventKind === "delay_follow_up") {
    return {
      title: "Reservation delay update",
      subject: "Reservation delay follow-up",
      messageType: "RESERVATION_DELAY_FOLLOW_UP",
      body: ["Your reservation is still delayed.", estimateLine, reasonLine, nextLine].join(" "),
    };
  }
  if (eventKind === "pickup_reminder") {
    return {
      title: "Pickup reminder",
      subject: "Reservation pickup reminder",
      messageType: "RESERVATION_PICKUP_REMINDER",
      body: [
        "Your reservation is still waiting for pickup.",
        reasonLine,
        nextLine,
        `Contact support with code ${hashId(job.payload.dedupeKey).slice(0, 8)} if you need help scheduling pickup.`,
      ].join(" "),
    };
  }
  return {
    title: "Reservation estimate updated",
    subject: "Reservation estimate updated",
    messageType: "RESERVATION_ESTIMATE_SHIFT",
    body: ["Your reservation estimate has changed.", estimateLine, reasonLine, nextLine].join(" "),
  };
}

function buildJobContent(job: NotificationJob): {
  inAppType: string;
  title: string;
  body: string;
  subject: string;
  textBody: string;
  sourceKind: "firing" | "reservation";
  sourceId: string;
  data: Record<string, unknown>;
  pushType: string;
} {
  if (job.type === "KILN_UNLOADED") {
    const title = job.payload.kilnName
      ? `Kiln unloaded: ${job.payload.kilnName}`
      : "Kiln unloaded";
    const body = job.payload.firingType
      ? `Your ${job.payload.firingType} firing is unloaded. We will confirm details together at pickup.`
      : "Your firing is unloaded. We will confirm details together at pickup.";
    const firingLabel = job.payload.firingType ? ` (${job.payload.firingType})` : "";
    const textBody = [
      "Your firing has been unloaded.",
      `Firing${firingLabel}`,
      "We will confirm everything together at pickup.",
    ].join("\n");
    return {
      inAppType: "KILN_UNLOADED",
      title,
      body,
      subject: title,
      textBody,
      sourceKind: "firing",
      sourceId: job.payload.firingId,
      pushType: "KILN_UNLOADED",
      data: {
        firingId: job.payload.firingId,
        kilnId: job.payload.kilnId ?? null,
        kilnName: job.payload.kilnName ?? null,
        firingType: job.payload.firingType ?? null,
        batchIds: job.payload.batchIds ?? [],
        pieceIds: job.payload.pieceIds ?? [],
      },
    };
  }

  const reservationCopy = buildReservationNotificationCopy(job);
  return {
    inAppType: reservationCopy.messageType,
    title: reservationCopy.title,
    body: reservationCopy.body,
    subject: reservationCopy.subject,
    textBody: reservationCopy.body,
    sourceKind: "reservation",
    sourceId: job.payload.reservationId ?? job.payload.firingId,
    pushType: reservationCopy.messageType,
    data: {
      reservationId: job.payload.reservationId ?? null,
      reservationStatus: job.payload.reservationStatus ?? null,
      previousReservationStatus: job.payload.previousReservationStatus ?? null,
      reservationLoadStatus: job.payload.reservationLoadStatus ?? null,
      previousReservationLoadStatus: job.payload.previousReservationLoadStatus ?? null,
      eventKind: job.payload.eventKind ?? null,
      reason: job.payload.reason ?? null,
      estimateWindowLabel: job.payload.estimateWindowLabel ?? null,
      suggestedNextUpdateAtIso: job.payload.suggestedNextUpdateAtIso ?? null,
      previousWindowStartIso: job.payload.previousWindowStartIso ?? null,
      previousWindowEndIso: job.payload.previousWindowEndIso ?? null,
      currentWindowStartIso: job.payload.currentWindowStartIso ?? null,
      currentWindowEndIso: job.payload.currentWindowEndIso ?? null,
      delayEpisodeId: job.payload.delayEpisodeId ?? null,
      delayFollowUpOrdinal: job.payload.delayFollowUpOrdinal ?? null,
      storageStatus: job.payload.storageStatus ?? null,
      previousStorageStatus: job.payload.previousStorageStatus ?? null,
      reminderOrdinal: job.payload.reminderOrdinal ?? null,
      reminderCount: job.payload.reminderCount ?? null,
      readyForPickupAtIso: job.payload.readyForPickupAtIso ?? null,
      policyWindowLabel: job.payload.policyWindowLabel ?? null,
    },
  };
}

async function writeInAppNotification(job: NotificationJob): Promise<{ created: boolean }> {
  const notificationId = hashId(job.payload.dedupeKey);
  const ref = db
    .collection("users")
    .doc(job.uid)
    .collection("notifications")
    .doc(notificationId);
  const content = buildJobContent(job);

  try {
    await ref.create({
      type: content.inAppType,
      title: content.title,
      body: content.body,
      createdAt: nowTs(),
      data: content.data,
      dedupeKey: job.payload.dedupeKey,
      source: { kind: content.sourceKind, id: content.sourceId },
      status: "created",
    });
    return { created: true };
  } catch (error: unknown) {
    if (
      (asRecord(error) && "code" in error && error.code === 6) ||
      (asRecord(error) && "code" in error && error.code === "already-exists")
    ) {
      return { created: false };
    }
    throw error;
  }
}

async function readUserEmail(uid: string): Promise<string | null> {
  try {
    const user = await adminAuth.getUser(uid);
    return user.email ?? null;
  } catch {
    return null;
  }
}

async function writeEmailNotification(job: NotificationJob, email: string): Promise<{ created: boolean }> {
  const mailId = hashId(`${job.payload.dedupeKey}:email`);
  const ref = db.collection("mail").doc(mailId);
  const content = buildJobContent(job);

  try {
    await ref.create({
      to: email,
      message: {
        subject: content.subject,
        text: content.textBody,
      },
      data: {
        ...content.data,
        sourceKind: content.sourceKind,
        sourceId: content.sourceId,
      },
      createdAt: nowTs(),
    });
    return { created: true };
  } catch (error: unknown) {
    if (
      (asRecord(error) && "code" in error && error.code === 6) ||
      (asRecord(error) && "code" in error && error.code === "already-exists")
    ) {
      return { created: false };
    }
    throw error;
  }
}

type SmsProviderMode = "disabled" | "mock" | "twilio";
type SmsMockMode = "success" | "auth" | "provider_4xx" | "provider_5xx" | "network";
type SmsNotificationResult =
  | { outcome: "sent"; provider: string }
  | { outcome: "skipped"; reason: string }
  | { outcome: "hard_failed"; reason: string; providerCode?: string | null };

type TwilioSmsSendResponse = {
  ok: boolean;
  status: number;
  sid: string | null;
  twilioStatus: string | null;
  providerCode: string | null;
  providerMessage: string | null;
};

function normalizeE164(raw: unknown): string | null {
  const source = safeString(raw).trim();
  if (!source) return null;
  const compact = source.replace(/[\s()-]+/g, "");
  const normalized = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return null;
  return normalized;
}

function getSmsProviderMode(): SmsProviderMode {
  const raw = safeString(process.env.NOTIFICATION_SMS_PROVIDER).trim().toLowerCase();
  if (raw === "twilio") return "twilio";
  if (raw === "mock") return "mock";
  return "disabled";
}

function getSmsMockMode(): SmsMockMode {
  const raw = safeString(process.env.NOTIFICATION_SMS_MOCK_MODE).trim().toLowerCase();
  if (
    raw === "auth" ||
    raw === "provider_4xx" ||
    raw === "provider_5xx" ||
    raw === "network" ||
    raw === "success"
  ) {
    return raw;
  }
  return "success";
}

function getTwilioAccountSid(): string {
  return safeString(process.env.TWILIO_ACCOUNT_SID).trim();
}

function getTwilioAuthToken(): string {
  return safeString(process.env.TWILIO_AUTH_TOKEN).trim();
}

function getSmsFromE164(): string {
  return normalizeE164(process.env.NOTIFICATION_SMS_FROM_E164) ?? "";
}

function classifySmsHttpStatus(status: number): NotificationErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || status === 429) return "network";
  if (status >= 500) return "provider_5xx";
  if (status >= 400) return "provider_4xx";
  return "unknown";
}

function isTwilioHardFailure(status: number, providerCode: string | null): boolean {
  if (status < 400 || status >= 500) return false;
  if (status === 408 || status === 429) return false;
  const hardCodes = new Set(["21211", "21610", "21612", "21614"]);
  return providerCode ? hardCodes.has(providerCode) : false;
}

function normalizeSmsBody(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, SMS_MESSAGE_MAX_CHARS);
}

async function readUserPhoneE164(uid: string): Promise<string | null> {
  try {
    const user = await adminAuth.getUser(uid);
    const authPhone = normalizeE164(user.phoneNumber);
    if (authPhone) return authPhone;
  } catch {
    // fall through to profile fallback
  }

  try {
    const profileSnap = await db.collection("profiles").doc(uid).get();
    if (!profileSnap.exists) return null;
    const data = profileSnap.data() as Record<string, unknown> | undefined;
    if (!data) return null;
    return (
      normalizeE164(data.phoneE164) ??
      normalizeE164(data.phone) ??
      normalizeE164(data.mobilePhone) ??
      null
    );
  } catch {
    return null;
  }
}

async function writeSmsAttemptTelemetry(params: {
  job: NotificationJob;
  status: "sent" | "skipped" | "failed";
  reason: string;
  provider?: string;
  providerCode?: string | null;
  phoneE164?: string | null;
  accepted?: number;
  rejected?: number;
  fallbackChannel?: "email" | null;
  fallbackStatus?: "sent" | "missing_email" | "failed" | null;
}): Promise<void> {
  const {
    job,
    status,
    reason,
    provider,
    providerCode,
    phoneE164,
    accepted,
    rejected,
    fallbackChannel,
    fallbackStatus,
  } = params;
  const attemptId = hashId(
    `${job.payload.dedupeKey}:sms:${status}:${reason}:${providerCode ?? "none"}:${fallbackStatus ?? "none"}`
  );
  await db.collection("notificationDeliveryAttempts").doc(attemptId).set(
    {
      uid: job.uid,
      channel: "sms",
      type: job.type,
      firingId: job.payload.firingId,
      reservationId: job.payload.reservationId ?? null,
      status,
      reason,
      provider: provider ?? null,
      providerCode: providerCode ?? null,
      phoneHash: phoneE164 ? hashId(phoneE164) : null,
      accepted: accepted ?? null,
      rejected: rejected ?? null,
      fallbackChannel: fallbackChannel ?? null,
      fallbackStatus: fallbackStatus ?? null,
      createdAt: nowTs(),
      dedupeKey: job.payload.dedupeKey,
    },
    { merge: true }
  );
}

async function sendSmsViaTwilio(input: {
  toE164: string;
  body: string;
}): Promise<TwilioSmsSendResponse> {
  const accountSid = getTwilioAccountSid();
  const authToken = getTwilioAuthToken();
  const fromE164 = getSmsFromE164();
  if (!accountSid || !authToken || !fromE164) {
    throw new Error("SMS_CONFIG: Twilio credentials or sender number not configured");
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body: new URLSearchParams({
      To: input.toE164,
      From: fromE164,
      Body: input.body,
    }).toString(),
  });
  const rawBody = await response.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    const json = JSON.parse(rawBody);
    if (asRecord(json)) parsed = json;
  } catch {
    parsed = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    sid: safeString(parsed?.sid) || null,
    twilioStatus: safeString(parsed?.status) || null,
    providerCode: safeString(parsed?.code) || null,
    providerMessage: safeString(parsed?.message) || safeString(rawBody).slice(0, 240) || null,
  };
}

async function sendSmsNotification(job: NotificationJob): Promise<SmsNotificationResult> {
  const phoneE164 = await readUserPhoneE164(job.uid);
  if (!phoneE164) {
    await writeSmsAttemptTelemetry({
      job,
      status: "skipped",
      reason: "PHONE_MISSING",
      provider: getSmsProviderMode(),
      accepted: 0,
      rejected: 0,
    });
    return { outcome: "skipped", reason: "PHONE_MISSING" };
  }

  const providerMode = getSmsProviderMode();
  const drillMode = job.payload.drillMode;
  if (drillMode) {
    if (drillMode === "provider_4xx") {
      await writeSmsAttemptTelemetry({
        job,
        status: "failed",
        reason: "DRILL_PROVIDER_4XX",
        provider: providerMode,
        providerCode: "DRILL_PROVIDER_4XX",
        phoneE164,
        accepted: 0,
        rejected: 1,
      });
      return {
        outcome: "hard_failed",
        reason: "DRILL_PROVIDER_4XX",
        providerCode: "DRILL_PROVIDER_4XX",
      };
    }
    if (drillMode === "auth") {
      await writeSmsAttemptTelemetry({
        job,
        status: "failed",
        reason: "DRILL_AUTH",
        provider: providerMode,
        providerCode: "DRILL_AUTH",
        phoneE164,
        accepted: 0,
        rejected: 1,
      });
      throw new Error("SMS provider failed: 401 DRILL_AUTH");
    }
    if (drillMode === "provider_5xx") {
      await writeSmsAttemptTelemetry({
        job,
        status: "failed",
        reason: "DRILL_PROVIDER_5XX",
        provider: providerMode,
        providerCode: "DRILL_PROVIDER_5XX",
        phoneE164,
        accepted: 0,
        rejected: 1,
      });
      throw new Error("SMS provider failed: 503 DRILL_PROVIDER_5XX");
    }
    if (drillMode === "network") {
      await writeSmsAttemptTelemetry({
        job,
        status: "failed",
        reason: "DRILL_NETWORK",
        provider: providerMode,
        providerCode: "DRILL_NETWORK",
        phoneE164,
        accepted: 0,
        rejected: 1,
      });
      throw new Error("SMS provider failed: network DRILL_NETWORK");
    }
    if (drillMode === "success") {
      await writeSmsAttemptTelemetry({
        job,
        status: "sent",
        reason: "DRILL_SUCCESS_SIMULATED",
        provider: providerMode,
        phoneE164,
        accepted: 1,
        rejected: 0,
      });
      return { outcome: "sent", provider: providerMode };
    }
  }

  if (providerMode === "disabled") {
    await writeSmsAttemptTelemetry({
      job,
      status: "skipped",
      reason: "SMS_PROVIDER_DISABLED",
      provider: providerMode,
      phoneE164,
      accepted: 0,
      rejected: 0,
    });
    return { outcome: "skipped", reason: "SMS_PROVIDER_DISABLED" };
  }

  const content = buildJobContent(job);
  const smsBody = normalizeSmsBody(content.textBody);
  if (!smsBody) {
    await writeSmsAttemptTelemetry({
      job,
      status: "skipped",
      reason: "SMS_BODY_EMPTY",
      provider: providerMode,
      phoneE164,
      accepted: 0,
      rejected: 0,
    });
    return { outcome: "skipped", reason: "SMS_BODY_EMPTY" };
  }

  if (providerMode === "mock") {
    const mockMode = getSmsMockMode();
    if (mockMode === "success") {
      await writeSmsAttemptTelemetry({
        job,
        status: "sent",
        reason: "SMS_MOCK_SENT",
        provider: providerMode,
        phoneE164,
        accepted: 1,
        rejected: 0,
      });
      return { outcome: "sent", provider: providerMode };
    }
    if (mockMode === "provider_4xx") {
      await writeSmsAttemptTelemetry({
        job,
        status: "failed",
        reason: "SMS_MOCK_PROVIDER_4XX",
        provider: providerMode,
        providerCode: "SMS_MOCK_PROVIDER_4XX",
        phoneE164,
        accepted: 0,
        rejected: 1,
      });
      return {
        outcome: "hard_failed",
        reason: "SMS_MOCK_PROVIDER_4XX",
        providerCode: "SMS_MOCK_PROVIDER_4XX",
      };
    }
    if (mockMode === "auth") {
      await writeSmsAttemptTelemetry({
        job,
        status: "failed",
        reason: "SMS_MOCK_AUTH",
        provider: providerMode,
        providerCode: "SMS_MOCK_AUTH",
        phoneE164,
        accepted: 0,
        rejected: 1,
      });
      throw new Error("SMS provider failed: 401 SMS_MOCK_AUTH");
    }
    if (mockMode === "provider_5xx") {
      await writeSmsAttemptTelemetry({
        job,
        status: "failed",
        reason: "SMS_MOCK_PROVIDER_5XX",
        provider: providerMode,
        providerCode: "SMS_MOCK_PROVIDER_5XX",
        phoneE164,
        accepted: 0,
        rejected: 1,
      });
      throw new Error("SMS provider failed: 503 SMS_MOCK_PROVIDER_5XX");
    }
    await writeSmsAttemptTelemetry({
      job,
      status: "failed",
      reason: "SMS_MOCK_NETWORK",
      provider: providerMode,
      providerCode: "SMS_MOCK_NETWORK",
      phoneE164,
      accepted: 0,
      rejected: 1,
    });
    throw new Error("SMS provider failed: network SMS_MOCK_NETWORK");
  }

  const twilioResult = await sendSmsViaTwilio({ toE164: phoneE164, body: smsBody });
  if (!twilioResult.ok) {
    const statusClass = classifySmsHttpStatus(twilioResult.status);
    const providerReason = `${twilioResult.status}:${twilioResult.providerCode ?? "no_code"}:${twilioResult.providerMessage ?? "error"}`.slice(0, 180);
    const hardFailure = statusClass === "provider_4xx" && isTwilioHardFailure(twilioResult.status, twilioResult.providerCode);
    await writeSmsAttemptTelemetry({
      job,
      status: "failed",
      reason: hardFailure ? `SMS_HARD_FAIL:${providerReason}` : `SMS_FAIL:${providerReason}`,
      provider: "twilio",
      providerCode: twilioResult.providerCode,
      phoneE164,
      accepted: 0,
      rejected: 1,
    });
    if (hardFailure) {
      return {
        outcome: "hard_failed",
        reason: providerReason,
        providerCode: twilioResult.providerCode,
      };
    }
    throw new Error(`SMS provider failed (${statusClass}): ${providerReason}`);
  }

  await writeSmsAttemptTelemetry({
    job,
    status: "sent",
    reason: "SMS_PROVIDER_SENT",
    provider: "twilio",
    providerCode: twilioResult.twilioStatus,
    phoneE164,
    accepted: 1,
    rejected: 0,
  });
  return { outcome: "sent", provider: "twilio" };
}

type DeviceTokenRecord = {
  token: string;
  tokenHash: string;
  platform: string;
  environment: string;
  active: boolean;
};

type PushProviderSendInput = {
  tokens: DeviceTokenRecord[];
  job: NotificationJob;
};

type PushProviderPerTokenResult = {
  tokenHash: string;
  ok: boolean;
  providerCode?: string;
  message?: string;
};

type PushProviderSendResult = {
  provider: "relay";
  accepted: number;
  rejected: number;
  results: PushProviderPerTokenResult[];
};

async function readActiveDeviceTokens(uid: string): Promise<DeviceTokenRecord[]> {
  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("deviceTokens")
    .where("active", "==", true)
    .limit(20)
    .get();

  return snap.docs
    .map((docSnap) => {
      const data = asRecord(docSnap.data()) ? (docSnap.data() as Record<string, unknown>) : {};
      const token = safeString(data.token);
      if (!token) return null;
      return {
        token,
        tokenHash: safeString(data.tokenHash) || docSnap.id,
        platform: safeString(data.platform) || "ios",
        environment: safeString(data.environment) || "production",
        active: data.active === true,
      };
    })
    .filter((entry): entry is DeviceTokenRecord =>
      Boolean(entry && entry.active && typeof entry.token === "string" && entry.token.length > 0)
    );
}

async function writePushAttemptTelemetry(params: {
  job: NotificationJob;
  tokenHashes: string[];
  status: "sent" | "skipped" | "failed";
  reason: string;
  provider?: string;
  accepted?: number;
  rejected?: number;
  providerCodes?: string[];
}): Promise<void> {
  const { job, tokenHashes, status, reason, provider, accepted, rejected, providerCodes } = params;
  const attemptId = hashId(`${job.payload.dedupeKey}:push:${reason}`);
  await db.collection("notificationDeliveryAttempts").doc(attemptId).set(
    {
      uid: job.uid,
      channel: "push",
      type: job.type,
      firingId: job.payload.firingId,
      reservationId: job.payload.reservationId ?? null,
      tokenHashes,
      status,
      reason,
      provider: provider ?? null,
      accepted: accepted ?? null,
      rejected: rejected ?? null,
      providerCodes: providerCodes ?? [],
      createdAt: nowTs(),
      dedupeKey: job.payload.dedupeKey,
    },
    { merge: true }
);
}

function buildPushBody(job: NotificationJob): { title: string; body: string; data: Record<string, string> } {
  const content = buildJobContent(job);
  const sourceKind = content.sourceKind;
  const sourceId = content.sourceId;
  return {
    title: content.title,
    body: content.body,
    data: {
      type: content.pushType,
      firingId: job.payload.firingId,
      kilnId: job.payload.kilnId ?? "",
      kilnName: job.payload.kilnName ?? "",
      firingType: job.payload.firingType ?? "",
      reservationId: job.payload.reservationId ?? "",
      reservationStatus: job.payload.reservationStatus ?? "",
      eventKind: job.payload.eventKind ?? "",
      sourceKind,
      sourceId,
    },
  };
}

function getPushRelayUrl(): string {
  return (process.env.APNS_RELAY_URL ?? "").trim();
}

function getPushRelayKey(): string {
  return (process.env.APNS_RELAY_KEY ?? "").trim();
}

function shouldDeactivateForProviderCode(code?: string): boolean {
  const normalized = (code ?? "").toLowerCase();
  return (
    normalized === "baddevicetoken" ||
    normalized === "unregistered" ||
    normalized === "device_token_not_for_topic"
  );
}

async function deactivateToken(uid: string, tokenHash: string, reason: string): Promise<void> {
  await db
    .collection("users")
    .doc(uid)
    .collection("deviceTokens")
    .doc(tokenHash)
    .set(
      {
        active: false,
        deactivatedAt: nowTs(),
        deactivationReason: reason,
        updatedAt: nowTs(),
      },
      { merge: true }
    );
}

async function sendPushViaRelay(input: PushProviderSendInput): Promise<PushProviderSendResult> {
  const relayUrl = getPushRelayUrl();
  if (!relayUrl) {
    throw new Error("APNS_RELAY_URL not configured");
  }
  const relayKey = getPushRelayKey();
  if (!relayKey) {
    throw new Error("APNS_RELAY_KEY not configured");
  }

  const payload = buildPushBody(input.job);
  const response = await fetch(relayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${relayKey}`,
    },
    body: JSON.stringify({
      tokens: input.tokens.map((entry) => ({
        token: entry.token,
        tokenHash: entry.tokenHash,
        environment: entry.environment,
      })),
      notification: payload,
      context: {
        uid: input.job.uid,
        dedupeKey: input.job.payload.dedupeKey,
        firingId: input.job.payload.firingId,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`APNS relay failed: ${response.status} ${body}`.slice(0, 1000));
  }

  const json = (await response.json()) as {
    accepted?: number;
    rejected?: number;
    results?: Array<{ tokenHash?: string; ok?: boolean; providerCode?: string; message?: string }>;
  };
  const results = Array.isArray(json.results)
    ? json.results
        .map((entry) => ({
          tokenHash: safeString(entry.tokenHash),
          ok: Boolean(entry.ok),
          providerCode: safeString(entry.providerCode) || undefined,
          message: safeString(entry.message) || undefined,
        }))
        .filter((entry) => entry.tokenHash.length > 0)
    : [];

  return {
    provider: "relay",
    accepted: Number.isFinite(json.accepted) ? Number(json.accepted) : results.filter((r) => r.ok).length,
    rejected: Number.isFinite(json.rejected) ? Number(json.rejected) : results.filter((r) => !r.ok).length,
    results,
  };
}

async function sendPushNotification(job: NotificationJob): Promise<void> {
  const drillMode = job.payload.drillMode;
  if (drillMode) {
    if (drillMode === "auth") {
      throw new Error("APNS relay failed: 401 DRILL_AUTH");
    }
    if (drillMode === "provider_4xx") {
      throw new Error("APNS relay failed: 400 DRILL_PROVIDER_4XX");
    }
    if (drillMode === "provider_5xx") {
      throw new Error("APNS relay failed: 503 DRILL_PROVIDER_5XX");
    }
    if (drillMode === "network") {
      throw new Error("fetch failed DRILL_NETWORK");
    }
    if (drillMode === "success") {
      await writePushAttemptTelemetry({
        job,
        tokenHashes: [],
        status: "sent",
        reason: "DRILL_SUCCESS_SIMULATED",
        provider: "relay",
        accepted: 1,
        rejected: 0,
        providerCodes: [],
      });
      return;
    }
  }

  const tokens = await readActiveDeviceTokens(job.uid);
  if (!tokens.length) {
    await writePushAttemptTelemetry({
      job,
      tokenHashes: [],
      status: "skipped",
      reason: "NO_ACTIVE_DEVICE_TOKENS",
    });
    return;
  }
  try {
    const result = await sendPushViaRelay({ tokens, job });

    const invalidTokens = result.results.filter(
      (entry) => !entry.ok && shouldDeactivateForProviderCode(entry.providerCode)
    );
    for (const invalid of invalidTokens) {
      await deactivateToken(job.uid, invalid.tokenHash, invalid.providerCode ?? "INVALID_DEVICE_TOKEN");
    }

    const failedCodes = result.results
      .filter((entry) => !entry.ok && entry.providerCode)
      .map((entry) => entry.providerCode as string);

    await writePushAttemptTelemetry({
      job,
      tokenHashes: tokens.map((entry) => entry.tokenHash),
      status: result.rejected > 0 && result.accepted === 0 ? "failed" : "sent",
      reason: result.rejected > 0 ? "PUSH_PROVIDER_PARTIAL" : "PUSH_PROVIDER_SENT",
      provider: result.provider,
      accepted: result.accepted,
      rejected: result.rejected,
      providerCodes: failedCodes,
    });
  } catch (error: unknown) {
    const message = errorMessage(error);
    await writePushAttemptTelemetry({
      job,
      tokenHashes: tokens.map((entry) => entry.tokenHash),
      status: "failed",
      reason: message.slice(0, 180),
      provider: "relay",
      accepted: 0,
      rejected: tokens.length,
      providerCodes: [],
    });
    throw error;
  }
}

function classifyNotificationError(err: unknown): NotificationErrorClass {
  const text = safeString(
    asRecord(err) && "message" in err && err.message ? err.message : err
  ).toLowerCase();
  if (text.includes("401") || text.includes("403") || text.includes("unauthorized")) return "auth";
  if (
    text.includes("network") ||
    text.includes("timed out") ||
    text.includes("fetch") ||
    text.includes("408") ||
    text.includes("429") ||
    text.includes("rate limit")
  ) {
    return "network";
  }
  if (text.includes(" 5") || text.includes("500") || text.includes("502") || text.includes("503")) {
    return "provider_5xx";
  }
  if (text.includes(" 4") || text.includes("400") || text.includes("404")) {
    return "provider_4xx";
  }
  return "unknown";
}

function isRetryableError(errorClass: NotificationErrorClass): boolean {
  return errorClass === "provider_5xx" || errorClass === "network" || errorClass === "unknown";
}

function retryDelayMs(attemptCount: number): number {
  const capped = Math.min(6, Math.max(1, attemptCount));
  return JOB_BASE_RETRY_MS * Math.pow(2, capped - 1);
}

async function writeDeadLetter(params: {
  ref: DocumentReference;
  job: NotificationJob;
  errorMessage: string;
  errorClass: NotificationErrorClass;
  finalAttempt: number;
}): Promise<void> {
  const { ref, job, errorMessage, errorClass, finalAttempt } = params;
  await db.collection("notificationJobDeadLetters").doc(ref.id).set(
    {
      jobId: ref.id,
      uid: job.uid,
      type: job.type,
      payload: job.payload,
      channels: job.channels,
      attemptCount: finalAttempt,
      errorClass,
      errorMessage: errorMessage.slice(0, 1000),
      failedAt: nowTs(),
      dedupeKey: job.payload.dedupeKey,
    },
    { merge: true }
  );
}

function isReservationJobType(type: NotificationJob["type"]): boolean {
  return type !== "KILN_UNLOADED";
}

async function scheduleNextReservationDelayFollowUp(
  job: NotificationJob,
  routing: ReservationNotificationRouting
): Promise<void> {
  if (job.type !== "RESERVATION_DELAY_FOLLOW_UP" || job.payload.eventKind !== "delay_follow_up") {
    return;
  }
  const reservationId = safeString(job.payload.reservationId).trim();
  if (!reservationId) return;

  const reservationSnap = await db.collection("reservations").doc(reservationId).get();
  if (!reservationSnap.exists) return;
  const reservation = parseReservationSnapshot(reservationSnap.data() as Record<string, unknown>);
  if (reservation.status === "CANCELLED" || reservation.loadStatus === "loaded") return;
  if (reservation.estimatedWindow.slaState !== "delayed") return;
  if (!routing.notifyReservations || !routing.prefs.enabled || !hasEnabledChannels(routing.channels)) {
    return;
  }

  const currentOrdinalRaw =
    typeof job.payload.delayFollowUpOrdinal === "number"
      ? Math.max(1, Math.trunc(job.payload.delayFollowUpOrdinal))
      : 1;
  const nextOrdinal = currentOrdinalRaw + 1;
  if (nextOrdinal > 14) return;

  const delayEpisodeId =
    safeString(job.payload.delayEpisodeId).trim() ||
    tsIso(reservation.estimatedWindow.updatedAt) ||
    tsIso(reservation.updatedAt) ||
    String(Date.now());
  const baseRunAfter = new Date(Date.now() + RESERVATION_DELAY_FOLLOW_UP_REPEAT_MS);
  const resolvedRunAfter = resolveRunAfter(baseRunAfter, routing.prefs) ?? baseRunAfter;
  const runAfter = Timestamp.fromDate(resolvedRunAfter);

  await enqueueReservationNotificationJob({
    uid: job.uid,
    type: "RESERVATION_DELAY_FOLLOW_UP",
    routing,
    runAfter,
    payload: {
      dedupeKey: `RESERVATION_DELAY_FOLLOW_UP:${reservationId}:${delayEpisodeId}:${nextOrdinal}`,
      firingId: reservationId,
      reservationId,
      reservationStatus: reservation.status,
      previousReservationStatus: job.payload.reservationStatus ?? null,
      reservationLoadStatus: reservation.loadStatus,
      previousReservationLoadStatus: job.payload.reservationLoadStatus ?? null,
      eventKind: "delay_follow_up",
      reason: buildReservationReason(
        reservation,
        "Your reservation remains delayed while we work through active kiln constraints."
      ),
      estimateWindowLabel: reservationEstimatedWindowLabel(reservation.estimatedWindow),
      suggestedNextUpdateAtIso: tsIso(runAfter),
      previousWindowStartIso: job.payload.currentWindowStartIso ?? null,
      previousWindowEndIso: job.payload.currentWindowEndIso ?? null,
      currentWindowStartIso: tsIso(reservation.estimatedWindow.currentStart),
      currentWindowEndIso: tsIso(reservation.estimatedWindow.currentEnd),
      delayEpisodeId,
      delayFollowUpOrdinal: nextOrdinal,
    },
  });
}

async function recordReservationReminderFailure(
  job: NotificationJob,
  errorClass: NotificationErrorClass,
  rawMessage: string
): Promise<void> {
  if (job.type !== "RESERVATION_PICKUP_REMINDER") return;
  const reservationId = safeString(job.payload.reservationId).trim();
  if (!reservationId) return;
  const uid = safeString(job.uid).trim();
  if (!uid) return;
  const reminderOrdinal =
    typeof job.payload.reminderOrdinal === "number"
      ? Math.max(1, Math.trunc(job.payload.reminderOrdinal))
      : null;
  const now = nowTs();

  const reservationRef = db.collection("reservations").doc(reservationId);
  const nextFailureCount = await db.runTransaction(async (tx) => {
    const snap = await tx.get(reservationRef);
    if (!snap.exists) return null;
    const reservation = parseReservationSnapshot(snap.data() as Record<string, unknown>);
    const nextHistory = pushStorageNotice(reservation.storageNoticeHistory, {
      at: now,
      kind: "reminder_failed",
      detail: rawMessage.slice(0, 280),
      status: currentStorageStatus(reservation),
      reminderOrdinal,
      reminderCount: reservation.pickupReminderCount,
      failureCode: errorClass,
    });
    const nextFailureCount = reservation.pickupReminderFailureCount + 1;
    tx.set(
      reservationRef,
      {
        pickupReminderFailureCount: nextFailureCount,
        lastReminderFailureAt: now,
        storageNoticeHistory: nextHistory.map(normalizeStorageNoticeForWrite),
        updatedAt: now,
      },
      { merge: true }
    );
    return nextFailureCount;
  });

  if (nextFailureCount == null) return;
  await writeReservationStorageAudit({
    reservationId,
    uid,
    action: "pickup_reminder_failed",
    reason: rawMessage.slice(0, 280),
    reminderOrdinal,
    reminderCount: typeof nextFailureCount === "number" ? nextFailureCount : null,
    failureCode: errorClass,
  });
}

async function processJob(ref: DocumentReference): Promise<void> {
  const snap = await ref.get();
  if (!snap.exists) return;
  const job = snap.data() as NotificationJob;
  if (job.status !== "queued") return;

  const now = Timestamp.now();
  if (job.runAfter && job.runAfter.toMillis() > now.toMillis()) {
    return;
  }

  const currentAttempt = (job.attemptCount ?? 0) + 1;

  await ref.set(
    {
      status: "processing",
      attemptCount: currentAttempt,
    },
    { merge: true }
  );

  const errors: string[] = [];
  try {
    let reservationRouting: ReservationNotificationRouting | null = null;
    if (isReservationJobType(job.type)) {
      reservationRouting = await readReservationRouting(job.uid);
      if (!reservationRouting.notifyReservations || !reservationRouting.prefs.enabled) {
        await ref.set(
          {
            status: "skipped",
            lastError: !reservationRouting.notifyReservations
              ? "RESERVATION_PREF_DISABLED"
              : "PREFS_DISABLED",
          },
          { merge: true }
        );
        return;
      }
      if (!hasEnabledChannels(reservationRouting.channels)) {
        await ref.set(
          {
            status: "skipped",
            lastError: "NO_CHANNELS_ENABLED",
          },
          { merge: true }
        );
        return;
      }
    }

    if (job.type === "RESERVATION_DELAY_FOLLOW_UP" || job.type === "RESERVATION_PICKUP_REMINDER") {
      const reservationId = safeString(job.payload.reservationId).trim();
      if (!reservationId) {
        await ref.set(
          {
            status: "skipped",
            lastError: "RESERVATION_ID_MISSING",
          },
          { merge: true }
        );
        return;
      }
      const reservationSnap = await db.collection("reservations").doc(reservationId).get();
      if (!reservationSnap.exists) {
        await ref.set(
          {
            status: "skipped",
            lastError: "RESERVATION_NOT_FOUND",
          },
          { merge: true }
        );
        return;
      }
      const reservation = parseReservationSnapshot(
        reservationSnap.data() as Record<string, unknown>
      );
      if (job.type === "RESERVATION_DELAY_FOLLOW_UP") {
        const stillDelayed =
          reservation.estimatedWindow.slaState === "delayed" &&
          reservation.status !== "CANCELLED" &&
          reservation.loadStatus !== "loaded";
        if (!stillDelayed) {
          await ref.set(
            {
              status: "skipped",
              lastError: "RESERVATION_NO_LONGER_DELAYED",
            },
            { merge: true }
          );
          return;
        }
      }
      if (job.type === "RESERVATION_PICKUP_REMINDER") {
        const reminderOrdinal =
          typeof job.payload.reminderOrdinal === "number"
            ? Math.max(1, Math.trunc(job.payload.reminderOrdinal))
            : null;
        const pickupEligible =
          reservation.loadStatus === "loaded" &&
          reservation.status !== "CANCELLED";
        if (!pickupEligible) {
          await ref.set(
            {
              status: "skipped",
              lastError: "RESERVATION_NOT_READY_FOR_PICKUP",
            },
            { merge: true }
          );
          return;
        }
        if (currentStorageStatus(reservation) === "stored_by_policy") {
          await ref.set(
            {
              status: "skipped",
              lastError: "RESERVATION_STORAGE_FINALIZED",
            },
            { merge: true }
          );
          return;
        }
        if (reminderOrdinal && reservation.pickupReminderCount >= reminderOrdinal) {
          await ref.set(
            {
              status: "skipped",
              lastError: "REMINDER_ALREADY_RECORDED",
            },
            { merge: true }
          );
          return;
        }
      }
    }

    const channels = reservationRouting ? reservationRouting.channels : job.channels;
    const resolvedChannels = {
      inApp: Boolean(channels?.inApp),
      email: Boolean(channels?.email),
      push: Boolean(channels?.push),
      sms: Boolean(channels?.sms),
    };

    if (resolvedChannels.inApp) {
      await writeInAppNotification(job);
    }

    let smsFallbackTriggered = false;
    if (resolvedChannels.sms) {
      const smsResult = await sendSmsNotification(job);
      if (smsResult.outcome === "hard_failed") {
        smsFallbackTriggered = true;
        errors.push(`SMS_HARD_FAIL:${smsResult.reason.slice(0, 120)}`);
      } else if (smsResult.outcome === "skipped") {
        errors.push(`SMS_SKIPPED:${smsResult.reason}`);
      }
    }

    if (resolvedChannels.email || smsFallbackTriggered) {
      const email = await readUserEmail(job.uid);
      if (!email) {
        if (smsFallbackTriggered) {
          errors.push("SMS_FALLBACK_EMAIL_MISSING");
          await writeSmsAttemptTelemetry({
            job,
            status: "failed",
            reason: "SMS_FALLBACK_EMAIL_MISSING",
            fallbackChannel: "email",
            fallbackStatus: "missing_email",
          });
        } else {
          errors.push("EMAIL_MISSING");
        }
        logger.warn("Email notification skipped: no email", {
          uid: job.uid,
          jobId: ref.id,
          fallback: smsFallbackTriggered,
        });
      } else {
        try {
          await writeEmailNotification(job, email);
          if (smsFallbackTriggered) {
            errors.push("SMS_FALLBACK_EMAIL_SENT");
            await writeSmsAttemptTelemetry({
              job,
              status: "sent",
              reason: "SMS_FALLBACK_EMAIL_SENT",
              fallbackChannel: "email",
              fallbackStatus: "sent",
            });
          }
        } catch (error: unknown) {
          if (smsFallbackTriggered) {
            await writeSmsAttemptTelemetry({
              job,
              status: "failed",
              reason: `SMS_FALLBACK_EMAIL_FAILED:${errorMessage(error).slice(0, 120)}`,
              fallbackChannel: "email",
              fallbackStatus: "failed",
            });
          }
          throw error;
        }
      }
    }

    if (resolvedChannels.push) {
      await sendPushNotification(job);
    }

    if (reservationRouting) {
      await scheduleNextReservationDelayFollowUp(job, reservationRouting);
    }

    await ref.set(
      {
        status: "done",
        lastError: errors.length ? errors.join(",") : null,
      },
      { merge: true }
    );
  } catch (error: unknown) {
    const rawMessage = errorMessage(error);
    const errorClass = classifyNotificationError(error);
    const retryable = isRetryableError(errorClass);
    const hasRetry = retryable && currentAttempt < JOB_MAX_ATTEMPTS;

    if (hasRetry) {
      const delayMs = retryDelayMs(currentAttempt);
      await ref.set(
        {
          status: "queued",
          runAfter: Timestamp.fromDate(new Date(Date.now() + delayMs)),
          lastError: `${errorClass}: ${rawMessage}`.slice(0, 1000),
          lastErrorClass: errorClass,
        },
        { merge: true }
      );
      return;
    }

    await ref.set(
      {
        status: "failed",
        lastError: `${errorClass}: ${rawMessage}`.slice(0, 1000),
        lastErrorClass: errorClass,
      },
      { merge: true }
    );
    await recordReservationReminderFailure(job, errorClass, rawMessage);
    await writeDeadLetter({
      ref,
      job,
      errorMessage: rawMessage,
      errorClass,
      finalAttempt: currentAttempt,
    });
    logger.error("Notification job moved to dead-letter", {
      jobId: ref.id,
      errorClass,
      attemptCount: currentAttempt,
    });
  }
}

export const processNotificationJob = onDocumentCreated(
  { region: REGION, document: "notificationJobs/{jobId}" },
  async (event) => {
    const ref = event.data?.ref;
    if (!ref) return;
    await processJob(ref);
  }
);

export const processQueuedNotificationJobs = onSchedule(
  { region: REGION, schedule: "every 15 minutes" },
  async () => {
    const now = nowTs();
    const snap = await db
      .collection("notificationJobs")
      .where("status", "==", "queued")
      .where("runAfter", "<=", now)
      .limit(50)
      .get();

    const refs = snap.docs.map((docSnap) => docSnap.ref);
    for (const ref of refs) {
      try {
        await processJob(ref);
      } catch (err) {
        logger.error("Queued notification job failed", { jobId: ref.id, error: err });
      }
    }
  }
);

function pickupReminderReason(reminderOrdinal: number): string {
  if (reminderOrdinal >= 3) {
    return "Final pickup reminder: reservation is nearing storage-hold policy thresholds.";
  }
  if (reminderOrdinal === 2) {
    return "Second pickup reminder: reservation is still awaiting pickup scheduling.";
  }
  return "Pickup reminder: reservation has been ready for collection for several days.";
}

export const evaluateReservationStorageHolds = onSchedule(
  { region: REGION, schedule: "every 60 minutes" },
  async () => {
    const now = nowTs();
    const nowMs = now.toMillis();
    const snap = await db
      .collection("reservations")
      .where("loadStatus", "==", "loaded")
      .limit(200)
      .get();

    let scanned = 0;
    let updatedReservations = 0;
    let reminderJobs = 0;
    let statusTransitions = 0;

    for (const docSnap of snap.docs) {
      const reservationId = docSnap.id;
      const reservation = parseReservationSnapshot(docSnap.data() as Record<string, unknown>);
      const uid = safeString(reservation.ownerUid).trim();
      if (!uid) continue;
      if (reservation.status === "CANCELLED") continue;
      if (reservation.pickupWindow.status === "completed") continue;
      scanned += 1;

      const readyAnchor = reservation.readyForPickupAt ?? reservation.updatedAt ?? reservation.createdAt;
      if (!readyAnchor) continue;

      const elapsedMs = Math.max(0, nowMs - readyAnchor.toMillis());
      const previousStorageStatus = currentStorageStatus(reservation);
      let nextStorageStatus = previousStorageStatus;
      let nextReminderCount = reservation.pickupReminderCount;
      let nextHistory = reservation.storageNoticeHistory;
      const updates: Record<string, unknown> = {};
      let autoMissApplied = false;

      if (!reservation.readyForPickupAt) {
        updates.readyForPickupAt = readyAnchor;
      }

      const pickupWindowStatus = reservation.pickupWindow.status;
      const pickupWindowEndMs = tsMillis(reservation.pickupWindow.confirmedEnd);
      if (
        (pickupWindowStatus === "open" || pickupWindowStatus === "confirmed") &&
        pickupWindowEndMs !== null &&
        pickupWindowEndMs <= nowMs
      ) {
        const nextMissedCount = reservation.pickupWindow.missedCount + 1;
        const missedStatus: ReservationStorageStatus =
          nextMissedCount >= 2 ? "stored_by_policy" : "hold_pending";
        const missReason =
          nextMissedCount >= 2
            ? "Pickup window was missed again and reservation moved to stored-by-policy."
            : "Pickup window elapsed and reservation moved to hold-pending.";
        updates.pickupWindow = normalizePickupWindowForWrite({
          ...reservation.pickupWindow,
          status: "missed",
          confirmedAt: null,
          completedAt: null,
          missedCount: nextMissedCount,
          lastMissedAt: now,
        });
        updates.storageStatus = missedStatus;
        nextStorageStatus = missedStatus;
        autoMissApplied = true;
        if (previousStorageStatus !== missedStatus) {
          statusTransitions += 1;
        }
        nextHistory = pushStorageNotice(nextHistory, {
          at: now,
          kind: "pickup_window_missed",
          detail: missReason,
          status: missedStatus,
          reminderOrdinal: null,
          reminderCount: nextReminderCount,
          failureCode: null,
        });
        await writeReservationStorageAudit({
          reservationId,
          uid,
          action: "pickup_window_missed",
          reason: missReason,
          fromStatus: previousStorageStatus,
          toStatus: missedStatus,
          reminderCount: nextReminderCount,
        });
        const routing = await readReservationRouting(uid);
        await enqueueReservationNotificationJob({
          uid,
          type: "RESERVATION_PICKUP_REMINDER",
          routing,
          payload: {
            dedupeKey: `RESERVATION_PICKUP_WINDOW_MISSED:${reservationId}:${pickupWindowEndMs}:${nextMissedCount}`,
            firingId: reservationId,
            reservationId,
            reservationStatus: reservation.status,
            reservationLoadStatus: reservation.loadStatus,
            eventKind: "pickup_reminder",
            reason: missReason,
            storageStatus: missedStatus,
            previousStorageStatus,
            reminderCount: nextReminderCount,
            readyForPickupAtIso: tsIso(readyAnchor),
            policyWindowLabel: "Pickup window missed. Staff follow-up is now required.",
            suggestedNextUpdateAtIso: null,
          },
        });
        reminderJobs += 1;
      }

      const dueReminderOrdinal = nextDueReminderOrdinal({
        elapsedMs,
        currentCount: reservation.pickupReminderCount,
      });

      if (dueReminderOrdinal && !autoMissApplied) {
        const reason = pickupReminderReason(dueReminderOrdinal);
        const routing = await readReservationRouting(uid);
        const reminderStatus: ReservationStorageStatus =
          dueReminderOrdinal >= 3 ? "hold_pending" : "reminder_pending";
        await enqueueReservationNotificationJob({
          uid,
          type: "RESERVATION_PICKUP_REMINDER",
          routing,
          payload: {
            dedupeKey: `RESERVATION_PICKUP_REMINDER:${reservationId}:${tsIso(readyAnchor) ?? readyAnchor.toMillis()}:${dueReminderOrdinal}`,
            firingId: reservationId,
            reservationId,
            reservationStatus: reservation.status,
            reservationLoadStatus: reservation.loadStatus,
            eventKind: "pickup_reminder",
            reason,
            storageStatus: reminderStatus,
            previousStorageStatus: previousStorageStatus,
            reminderOrdinal: dueReminderOrdinal,
            reminderCount: dueReminderOrdinal,
            readyForPickupAtIso: tsIso(readyAnchor),
            policyWindowLabel: storagePolicyWindowLabel(dueReminderOrdinal),
            suggestedNextUpdateAtIso: null,
          },
        });
        reminderJobs += 1;

        nextReminderCount = Math.max(nextReminderCount, dueReminderOrdinal);
        nextStorageStatus = reminderStatus;
        updates.pickupReminderCount = nextReminderCount;
        updates.lastReminderAt = now;
        updates.storageStatus = nextStorageStatus;
        nextHistory = pushStorageNotice(nextHistory, {
          at: now,
          kind: `pickup_reminder_${dueReminderOrdinal}`,
          detail: reason,
          status: nextStorageStatus,
          reminderOrdinal: dueReminderOrdinal,
          reminderCount: nextReminderCount,
          failureCode: null,
        });
        await writeReservationStorageAudit({
          reservationId,
          uid,
          action: "pickup_reminder_enqueued",
          reason,
          fromStatus: previousStorageStatus,
          toStatus: nextStorageStatus,
          reminderOrdinal: dueReminderOrdinal,
          reminderCount: nextReminderCount,
        });
      }

      const policyStatus = storageStatusForElapsed({
        elapsedMs,
        reminderCount: nextReminderCount,
      });
      if (policyStatus !== nextStorageStatus) {
        const fromStatus = nextStorageStatus;
        nextStorageStatus = policyStatus;
        updates.storageStatus = policyStatus;
        statusTransitions += 1;
        const transitionDetail =
          policyStatus === "stored_by_policy"
            ? "Reservation reached storage policy threshold and is marked stored by policy."
            : policyStatus === "hold_pending"
              ? "Reservation entered storage hold pending status."
              : "Reservation storage status returned to active.";
        nextHistory = pushStorageNotice(nextHistory, {
          at: now,
          kind: policyStatus,
          detail: transitionDetail,
          status: policyStatus,
          reminderOrdinal: null,
          reminderCount: nextReminderCount,
          failureCode: null,
        });
        await writeReservationStorageAudit({
          reservationId,
          uid,
          action: "storage_status_transition",
          reason: transitionDetail,
          fromStatus,
          toStatus: policyStatus,
          reminderCount: nextReminderCount,
        });
      }

      if (Object.keys(updates).length === 0) {
        continue;
      }

      updates.storageNoticeHistory = nextHistory.map(normalizeStorageNoticeForWrite);
      updates.updatedAt = now;
      await docSnap.ref.set(updates, { merge: true });
      updatedReservations += 1;
    }

    logger.info("reservation_storage_hold_evaluation_complete", {
      scanned,
      updatedReservations,
      reminderJobs,
      statusTransitions,
    });
  }
);

function incrementCounter(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

async function aggregateNotificationMetricsWindow(windowHours: number): Promise<{
  windowHours: number;
  totalAttempts: number;
  statusCounts: Record<string, number>;
  reasonCounts: Record<string, number>;
  providerCounts: Record<string, number>;
}> {
  const cutoff = Timestamp.fromDate(new Date(Date.now() - windowHours * 60 * 60 * 1000));
  const snap = await db
    .collection("notificationDeliveryAttempts")
    .where("createdAt", ">=", cutoff)
    .limit(4000)
    .get();

  const statusCounts: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};
  const providerCounts: Record<string, number> = {};

  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() as Record<string, unknown>;
    incrementCounter(statusCounts, safeString(data.status) || "unknown");
    incrementCounter(reasonCounts, safeString(data.reason) || "unknown");
    incrementCounter(providerCounts, safeString(data.provider) || "unknown");
  });

  return {
    windowHours,
    totalAttempts: snap.size,
    statusCounts,
    reasonCounts,
    providerCounts,
  };
}

export const aggregateNotificationDeliveryMetrics = onSchedule(
  { region: REGION, schedule: "every 30 minutes" },
  async () => {
    const summary = await aggregateNotificationMetricsWindow(24);
    await db.collection("notificationMetrics").doc("delivery_24h").set(
      {
        updatedAt: nowTs(),
        ...summary,
      },
      { merge: true }
    );
  }
);

export const runNotificationMetricsAggregationNow = onRequest(
  { region: REGION },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Method not allowed", code: "INVALID_ARGUMENT" });
      return;
    }
    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message, code: "UNAUTHENTICATED" });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: admin.message, code: "PERMISSION_DENIED" });
      return;
    }

    const summary = await aggregateNotificationMetricsWindow(24);
    await db.collection("notificationMetrics").doc("delivery_24h").set(
      {
        updatedAt: nowTs(),
        ...summary,
        triggeredBy: auth.uid,
        triggerMode: "manual",
      },
      { merge: true }
    );

    res.status(200).json({ ok: true, ...summary });
  }
);

export const cleanupStaleDeviceTokens = onSchedule(
  { region: REGION, schedule: "every day 03:30" },
  async () => {
    const cutoff = Timestamp.fromDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
    const snap = await db
      .collectionGroup("deviceTokens")
      .where("active", "==", true)
      .where("updatedAt", "<", cutoff)
      .limit(250)
      .get();

    if (snap.empty) return;

    const batch = db.batch();
    snap.docs.forEach((docSnap) => {
      batch.set(
        docSnap.ref,
        {
          active: false,
          deactivatedAt: nowTs(),
          deactivationReason: "STALE_TOKEN_TIMEOUT",
          updatedAt: nowTs(),
        },
        { merge: true }
      );
    });
    await batch.commit();

    logger.info("Stale device token cleanup completed", { count: snap.size });
  }
);
