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
    const existing = snap.exists ? (snap.data() as any) : null;
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
};

type NotificationAudienceSegment = "all" | "members" | "staff";

type NotificationJob = {
  type: "KILN_UNLOADED";
  createdAt: Timestamp;
  runAfter?: Timestamp | null;
  uid: string;
  channels: { inApp: boolean; email: boolean; push: boolean };
  payload: NotificationPayload;
  attemptCount: number;
  lastError?: string;
  status: "queued" | "processing" | "done" | "failed" | "skipped";
};

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
  return safeString((snap.data() as any)?.name) || null;
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
      const data = snap.data() as any;
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

async function createJob(job: NotificationJob): Promise<void> {
  const jobId = hashId(job.payload.dedupeKey);
  const ref = db.collection("notificationJobs").doc(jobId);
  try {
    await ref.create(job);
  } catch (err: any) {
    if (err?.code === 6 || err?.code === "already-exists") {
      return;
    }
    throw err;
  }
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
    const before = event.data?.before.data() as any | undefined;
    const after = event.data?.after.data() as any | undefined;
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
      ? after.batchIds.map((id: any) => safeString(id)).filter(Boolean)
      : [];
    const pieceIds = Array.isArray(after.pieceIds)
      ? after.pieceIds.map((id: any) => safeString(id)).filter(Boolean)
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

async function writeInAppNotification(job: NotificationJob): Promise<{ created: boolean }> {
  const notificationId = hashId(job.payload.dedupeKey);
  const ref = db
    .collection("users")
    .doc(job.uid)
    .collection("notifications")
    .doc(notificationId);

  const title = job.payload.kilnName
    ? `Kiln unloaded: ${job.payload.kilnName}`
    : "Kiln unloaded";
  const body = job.payload.firingType
    ? `Your ${job.payload.firingType} firing is unloaded. We will confirm details together at pickup.`
    : "Your firing is unloaded. We will confirm details together at pickup.";

  try {
    await ref.create({
      type: "KILN_UNLOADED",
      title,
      body,
      createdAt: nowTs(),
      data: {
        firingId: job.payload.firingId,
        kilnId: job.payload.kilnId ?? null,
        kilnName: job.payload.kilnName ?? null,
        firingType: job.payload.firingType ?? null,
        batchIds: job.payload.batchIds ?? [],
        pieceIds: job.payload.pieceIds ?? [],
      },
      dedupeKey: job.payload.dedupeKey,
      source: { kind: "firing", id: job.payload.firingId },
      status: "created",
    });
    return { created: true };
  } catch (err: any) {
    if (err?.code === 6 || err?.code === "already-exists") {
      return { created: false };
    }
    throw err;
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
  const subject = job.payload.kilnName
    ? `Kiln unloaded: ${job.payload.kilnName}`
    : "Kiln unloaded";
  const firingLabel = job.payload.firingType ? ` (${job.payload.firingType})` : "";
  const textBody = [
    "Your firing has been unloaded.",
    `Firing${firingLabel}`,
    "We will confirm everything together at pickup.",
  ].join("\n");

  try {
    await ref.create({
      to: email,
      message: {
        subject,
        text: textBody,
      },
      data: {
        firingId: job.payload.firingId,
        kilnId: job.payload.kilnId ?? null,
        firingType: job.payload.firingType ?? null,
      },
      createdAt: nowTs(),
    });
    return { created: true };
  } catch (err: any) {
    if (err?.code === 6 || err?.code === "already-exists") {
      return { created: false };
    }
    throw err;
  }
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
    .map((docSnap) => ({ ...(docSnap.data() as any), tokenHash: docSnap.id }))
    .filter((entry) => typeof entry?.token === "string" && entry.token.length > 0);
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
  const title = job.payload.kilnName ? `Kiln unloaded: ${job.payload.kilnName}` : "Kiln unloaded";
  const body = job.payload.firingType
    ? `Your ${job.payload.firingType} firing is unloaded.`
    : "Your firing is unloaded.";
  return {
    title,
    body,
    data: {
      type: "KILN_UNLOADED",
      firingId: job.payload.firingId,
      kilnId: job.payload.kilnId ?? "",
      kilnName: job.payload.kilnName ?? "",
      firingType: job.payload.firingType ?? "",
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
  } catch (err: any) {
    const message = safeString(err?.message) || "PUSH_PROVIDER_SEND_FAILED";
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
    throw err;
  }
}

type NotificationErrorClass =
  | "provider_4xx"
  | "provider_5xx"
  | "network"
  | "auth"
  | "unknown";

function classifyNotificationError(err: unknown): NotificationErrorClass {
  const text = safeString((err as any)?.message ?? String(err)).toLowerCase();
  if (text.includes("401") || text.includes("403") || text.includes("unauthorized")) return "auth";
  if (text.includes(" 4") || text.includes("400") || text.includes("404") || text.includes("429")) {
    return "provider_4xx";
  }
  if (text.includes(" 5") || text.includes("500") || text.includes("502") || text.includes("503")) {
    return "provider_5xx";
  }
  if (text.includes("network") || text.includes("timed out") || text.includes("fetch")) return "network";
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
    if (job.channels?.inApp) {
      await writeInAppNotification(job);
    }

    if (job.channels?.email) {
      const email = await readUserEmail(job.uid);
      if (!email) {
        errors.push("EMAIL_MISSING");
        logger.warn("Email notification skipped: no email", {
          uid: job.uid,
          jobId: ref.id,
        });
      } else {
        await writeEmailNotification(job, email);
      }
    }

    if (job.channels?.push) {
      await sendPushNotification(job);
    }

    await ref.set(
      {
        status: "done",
        lastError: errors.length ? errors.join(",") : null,
      },
      { merge: true }
    );
  } catch (err: any) {
    const rawMessage = safeString(err?.message) || "Notification job failed";
    const errorClass = classifyNotificationError(err);
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
    const data = docSnap.data() as any;
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
