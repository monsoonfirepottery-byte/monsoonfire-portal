import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  db,
  applyCors,
  requireAdmin,
  requireAuthUid,
  nowTs,
  parseBody,
  safeString,
  asInt,
  enforceRateLimit,
  type RequestLike,
} from "./shared";
import {
  parseJukeboxConfigDoc,
  parseJukeboxQueueItemDoc,
  parseJukeboxStateDoc,
  parseJukeboxTrackDoc,
  parseVoteValue,
} from "./firestoreConverters";

const REGION = "us-central1";

const configSchema = z.object({
  enabled: z.boolean().optional(),
  ipAllowlistCidrs: z.array(z.string()).optional(),
  geoCenter: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
  geoRadiusMeters: z.number().optional(),
  maxQueuePerUser: z.number().int().optional(),
  cooldownSeconds: z.number().int().optional(),
  skipVoteThreshold: z.number().int().optional(),
});

const geoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const enqueueSchema = z.object({
  trackId: z.string().min(1),
  geo: geoSchema,
});

const voteSchema = z.object({
  itemId: z.string().min(1),
  value: z.union([z.literal(1), z.literal(-1)]),
  geo: geoSchema,
});

const skipSchema = z.object({
  itemId: z.string().min(1),
  geo: geoSchema,
});

const adminTrackSchema = z.object({
  trackId: z.string().optional(),
  title: z.string().min(1),
  artist: z.string().optional().nullable(),
  sourceType: z.enum(["url_audio", "youtube"]),
  url: z.string().optional().nullable(),
  youtubeVideoId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

const adminPlaybackSchema = z.object({
  geo: geoSchema,
  nowPlayingItemId: z.string().nullable().optional(),
  isPlaying: z.boolean().optional(),
});

const adminSkipSchema = z.object({
  itemId: z.string().min(1),
  geo: geoSchema,
});

const adminClearSchema = z.object({
  geo: geoSchema,
});

function configDoc() {
  return db.collection("config").doc("studioJukebox");
}

function tracksCol() {
  return db.collection("studioJukebox").doc("tracks").collection("items");
}

function queueCol() {
  return db.collection("studioJukebox").doc("queue").collection("items");
}

function votesCol(itemId: string) {
  return db
    .collection("studioJukebox")
    .doc("votes")
    .collection("items")
    .doc(itemId)
    .collection("byUid");
}

function stateDoc() {
  return db.collection("studioJukebox").doc("state");
}

function normalizeIp(raw: string): string {
  if (raw.startsWith("::ffff:")) return raw.replace("::ffff:", "");
  if (raw === "::1") return "127.0.0.1";
  return raw;
}

function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return null;
  }
  return (
    (parts[0] << 24) +
    (parts[1] << 16) +
    (parts[2] << 8) +
    parts[3]
  ) >>> 0;
}

function cidrContains(ip: string, cidr: string): boolean {
  const [range, maskRaw] = cidr.split("/");
  const maskBits = Number(maskRaw);
  if (!range || !Number.isFinite(maskBits) || maskBits < 0 || maskBits > 32) return false;
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range.trim());
  if (ipInt === null || rangeInt === null) return false;
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function isIpAllowed(ip: string, allowlist: string[]): boolean {
  if (!allowlist.length) return false;
  return allowlist.some((cidr) => cidrContains(ip, cidr.trim()));
}

function getClientIp(req: RequestLike): string {
  const headers = req.headers ?? {};
  const header = headers["x-forwarded-for"];
  if (typeof header === "string" && header.trim()) {
    return normalizeIp(header.split(",")[0].trim());
  }
  if (Array.isArray(header) && header[0]) return normalizeIp(String(header[0]).trim());
  return normalizeIp(typeof req.ip === "string" ? req.ip : "unknown");
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function readConfig() {
  const snap = await configDoc().get();
  if (!snap.exists) {
    return {
      enabled: false,
      ipAllowlistCidrs: [] as string[],
      geoCenter: null as { lat: number; lng: number } | null,
      geoRadiusMeters: 0,
      maxQueuePerUser: 2,
      cooldownSeconds: 120,
      skipVoteThreshold: 3,
    };
  }
  return parseJukeboxConfigDoc(snap.data());
}

function sanitizeConfig(config: Awaited<ReturnType<typeof readConfig>>, includeAllowlist: boolean) {
  return {
    enabled: config.enabled,
    ipAllowlistCidrs: includeAllowlist ? config.ipAllowlistCidrs : undefined,
    geoCenter: config.geoCenter,
    geoRadiusMeters: config.geoRadiusMeters,
    maxQueuePerUser: config.maxQueuePerUser,
    cooldownSeconds: config.cooldownSeconds,
    skipVoteThreshold: config.skipVoteThreshold,
  };
}

async function enforceStudioGate(req: RequestLike, geo: { lat: number; lng: number }) {
  const config = await readConfig();
  if (!config.enabled) {
    return { ok: false as const, code: "disabled", message: "Studio jukebox is disabled." };
  }

  const clientIp = getClientIp(req);
  const allowlist = config.ipAllowlistCidrs;
  if (!isIpAllowed(clientIp, allowlist)) {
    return {
      ok: false as const,
      code: "ip_not_allowed",
      message: "This action requires studio Wi-Fi.",
    };
  }

  if (!config.geoCenter || config.geoRadiusMeters <= 0) {
    return { ok: false as const, code: "geo_not_configured", message: "Studio location is not configured." };
  }

  if (geo == null || typeof geo.lat !== "number" || typeof geo.lng !== "number") {
    return { ok: false as const, code: "geo_missing", message: "Location is required for studio actions." };
  }

  const distance = haversineMeters(config.geoCenter.lat, config.geoCenter.lng, geo.lat, geo.lng);
  if (distance > config.geoRadiusMeters) {
    return {
      ok: false as const,
      code: "geo_outside",
      message: "You must be in the studio to use the jukebox.",
    };
  }

  return { ok: true as const, config, clientIp };
}

export const getJukeboxConfig = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const admin = await requireAdmin(req);
  const config = await readConfig();
  res.status(200).json({ ok: true, config: sanitizeConfig(config, admin.ok) });
});

export const listTracks = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }
  const admin = await requireAdmin(req);

  const snap = await tracksCol().orderBy("title", "asc").get();
  const tracks = snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...parseJukeboxTrackDoc(docSnap.data()) }))
    .filter((track) => track.isActive !== false || admin.ok)
    .map((track) => ({
      id: track.id,
      title: safeString(track.title),
      artist: safeString(track.artist) || null,
      sourceType: track.sourceType,
      youtubeVideoId: track.sourceType === "youtube" ? safeString(track.youtubeVideoId) : null,
      url: admin.ok && track.sourceType === "url_audio" ? safeString(track.url) : null,
      isActive: track.isActive !== false,
      updatedAt: track.updatedAt ?? null,
    }));

  res.status(200).json({ ok: true, tracks });
});

export const enqueueTrack = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(enqueueSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const gate = await enforceStudioGate(req, parsed.data.geo);
  if (!gate.ok) {
    res.status(403).json({ ok: false, code: gate.code, message: gate.message });
    return;
  }

  const rate = await enforceRateLimit({ req, key: "jukebox_enqueue", max: 10, windowMs: 60_000 });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const trackId = safeString(parsed.data.trackId);
  const trackSnap = await tracksCol().doc(trackId).get();
  if (!trackSnap.exists) {
    res.status(404).json({ ok: false, message: "Track not found" });
    return;
  }
  const track = parseJukeboxTrackDoc(trackSnap.data());
  if (track.isActive === false) {
    res.status(400).json({ ok: false, message: "Track is not active" });
    return;
  }

  const config = gate.config;
  const uid = auth.uid;

  const existingSnap = await queueCol()
    .where("requestedByUid", "==", uid)
    .orderBy("requestedAt", "desc")
    .limit(25)
    .get();

  const activeItems = existingSnap.docs.filter((docSnap) => {
    const data = parseJukeboxQueueItemDoc(docSnap.data());
    return data.status === "queued" || data.status === "playing";
  });

  if (activeItems.length >= config.maxQueuePerUser) {
    res.status(429).json({ ok: false, message: "Queue limit reached. Try again later." });
    return;
  }

  const mostRecentRaw = existingSnap.docs[0]?.data();
  const mostRecent = mostRecentRaw ? parseJukeboxQueueItemDoc(mostRecentRaw) : null;
  if (mostRecent?.requestedAt) {
    const elapsed = Date.now() - mostRecent.requestedAt.toMillis();
    if (elapsed < config.cooldownSeconds * 1000) {
      res.status(429).json({ ok: false, message: "Please wait before adding another track." });
      return;
    }
  }

  const t = nowTs();
  const ref = queueCol().doc();
  await ref.set({
    trackId,
    requestedByUid: uid,
    requestedAt: t,
    votesUp: 0,
    votesDown: 0,
    status: "queued",
  });

  res.status(200).json({ ok: true, itemId: ref.id });
});

export const vote = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(voteSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const gate = await enforceStudioGate(req, parsed.data.geo);
  if (!gate.ok) {
    res.status(403).json({ ok: false, code: gate.code, message: gate.message });
    return;
  }

  const rate = await enforceRateLimit({ req, key: "jukebox_vote", max: 20, windowMs: 60_000 });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const uid = auth.uid;
  const itemId = safeString(parsed.data.itemId);
  const value = parsed.data.value;

  const itemRef = queueCol().doc(itemId);
  const voteRef = votesCol(itemId).doc(uid);

  await db.runTransaction(async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists) throw new Error("Queue item not found");

    const item = parseJukeboxQueueItemDoc(itemSnap.data());
    const voteSnap = await tx.get(voteRef);
    const existing = voteSnap.exists ? parseVoteValue((voteSnap.data() as Record<string, unknown>).value) : null;

    let votesUp = asInt(item.votesUp, 0);
    let votesDown = asInt(item.votesDown, 0);

    if (existing === value) {
      return;
    }

    if (existing === 1) votesUp -= 1;
    if (existing === -1) votesDown -= 1;

    if (value === 1) votesUp += 1;
    if (value === -1) votesDown += 1;

    tx.set(voteRef, { value, votedAt: nowTs() }, { merge: true });
    tx.set(
      itemRef,
      {
        votesUp,
        votesDown,
      },
      { merge: true }
    );
  });

  res.status(200).json({ ok: true });
});

export const requestSkip = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(skipSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const gate = await enforceStudioGate(req, parsed.data.geo);
  if (!gate.ok) {
    res.status(403).json({ ok: false, code: gate.code, message: gate.message });
    return;
  }

  const uid = auth.uid;
  const itemId = safeString(parsed.data.itemId);

  const itemRef = queueCol().doc(itemId);
  const voteRef = votesCol(itemId).doc(uid);
  const config = gate.config;

  await db.runTransaction(async (tx) => {
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists) throw new Error("Queue item not found");

    const item = parseJukeboxQueueItemDoc(itemSnap.data());
    const voteSnap = await tx.get(voteRef);
    const existing = voteSnap.exists ? parseVoteValue((voteSnap.data() as Record<string, unknown>).value) : null;

    let votesDown = asInt(item.votesDown, 0);
    let votesUp = asInt(item.votesUp, 0);

    if (existing === -1) return;

    if (existing === 1) votesUp -= 1;
    votesDown += 1;

    const nextStatus = votesDown >= config.skipVoteThreshold ? "skipped" : item.status;

    tx.set(voteRef, { value: -1, votedAt: nowTs() }, { merge: true });
    tx.set(
      itemRef,
      {
        votesUp,
        votesDown,
        status: nextStatus,
        playedEndedAt: nextStatus === "skipped" ? nowTs() : item.playedEndedAt ?? null,
      },
      { merge: true }
    );
  });

  res.status(200).json({ ok: true });
});

export const adminUpsertTrack = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(adminTrackSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const t = nowTs();
  const trackId = safeString(parsed.data.trackId);
  const ref = trackId ? tracksCol().doc(trackId) : tracksCol().doc();

  const payload: Record<string, unknown> = {
    title: safeString(parsed.data.title),
    artist: safeString(parsed.data.artist) || null,
    sourceType: parsed.data.sourceType,
    url: parsed.data.sourceType === "url_audio" ? safeString(parsed.data.url) || null : null,
    youtubeVideoId:
      parsed.data.sourceType === "youtube"
        ? safeString(parsed.data.youtubeVideoId) || null
        : null,
    isActive: parsed.data.isActive !== false,
    updatedAt: t,
  };

  if (!(await ref.get()).exists) {
    payload.createdAt = t;
  }

  await ref.set(payload, { merge: true });

  res.status(200).json({ ok: true, trackId: ref.id });
});

export const adminSetConfig = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(configSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  await configDoc().set(
    {
      ...parsed.data,
      updatedAt: nowTs(),
    },
    { merge: true }
  );

  res.status(200).json({ ok: true });
});

export const adminAdvanceQueue = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(adminPlaybackSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const gate = await enforceStudioGate(req, parsed.data.geo);
  if (!gate.ok) {
    res.status(403).json({ ok: false, code: gate.code, message: gate.message });
    return;
  }

  const queueSnap = await queueCol()
    .where("status", "==", "queued")
    .orderBy("requestedAt", "asc")
    .limit(1)
    .get();

  const next = queueSnap.docs[0];
  const t = nowTs();

  await db.runTransaction(async (tx) => {
    const stateSnap = await tx.get(stateDoc());
    const state = stateSnap.exists ? parseJukeboxStateDoc(stateSnap.data()) : { nowPlayingItemId: null, isPlaying: false };

    if (state.nowPlayingItemId) {
      const prevRef = queueCol().doc(state.nowPlayingItemId);
      tx.set(
        prevRef,
        {
          status: "played",
          playedEndedAt: t,
        },
        { merge: true }
      );
    }

    if (next) {
      tx.set(
        queueCol().doc(next.id),
        { status: "playing", playingStartedAt: t },
        { merge: true }
      );
      tx.set(
        stateDoc(),
        { nowPlayingItemId: next.id, isPlaying: true, updatedAt: t },
        { merge: true }
      );
    } else {
      tx.set(stateDoc(), { nowPlayingItemId: null, isPlaying: false, updatedAt: t }, { merge: true });
    }
  });

  res.status(200).json({ ok: true, nextItemId: next?.id ?? null });
});

export const adminSetPlaybackState = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(adminPlaybackSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const gate = await enforceStudioGate(req, parsed.data.geo);
  if (!gate.ok) {
    res.status(403).json({ ok: false, code: gate.code, message: gate.message });
    return;
  }

  const payload: Record<string, unknown> = { updatedAt: nowTs() };
  if (parsed.data.nowPlayingItemId !== undefined) payload.nowPlayingItemId = parsed.data.nowPlayingItemId;
  if (parsed.data.isPlaying !== undefined) payload.isPlaying = parsed.data.isPlaying;

  await stateDoc().set(payload, { merge: true });
  res.status(200).json({ ok: true });
});

export const adminSkipNowPlaying = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(adminSkipSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const gate = await enforceStudioGate(req, parsed.data.geo);
  if (!gate.ok) {
    res.status(403).json({ ok: false, code: gate.code, message: gate.message });
    return;
  }

  const itemRef = queueCol().doc(parsed.data.itemId);
  const t = nowTs();
  await itemRef.set({ status: "skipped", playedEndedAt: t }, { merge: true });
  await stateDoc().set({ nowPlayingItemId: null, isPlaying: false, updatedAt: t }, { merge: true });

  res.status(200).json({ ok: true });
});

export const adminClearQueue = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(adminClearSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const gate = await enforceStudioGate(req, parsed.data.geo);
  if (!gate.ok) {
    res.status(403).json({ ok: false, code: gate.code, message: gate.message });
    return;
  }

  const snap = await queueCol().where("status", "in", ["queued", "playing"]).get();
  const batch = db.batch();
  const t = nowTs();
  snap.docs.forEach((docSnap) => {
    batch.set(docSnap.ref, { status: "skipped", playedEndedAt: t }, { merge: true });
  });
  batch.set(stateDoc(), { nowPlayingItemId: null, isPlaying: false, updatedAt: t }, { merge: true });
  await batch.commit();

  res.status(200).json({ ok: true, cleared: snap.size });
});

export const listQueue = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const snap = await queueCol().orderBy("requestedAt", "asc").limit(100).get();
  const items = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) }));
  res.status(200).json({ ok: true, items });
});

export const getJukeboxState = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const snap = await stateDoc().get();
  res.status(200).json({ ok: true, state: snap.exists ? snap.data() : null });
});
