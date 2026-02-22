import { asInt, safeString, Timestamp } from "./shared";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asStringOrNull(value: unknown): string | null {
  const next = safeString(value).trim();
  return next.length ? next : null;
}

function asStringOrFallback(value: unknown, fallback: string): string {
  const next = safeString(value).trim();
  return next.length ? next : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asTimestampOrNull(value: unknown): Timestamp | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (typeof value === "object" && typeof (value as { toDate?: () => Date }).toDate === "function") {
    try {
      return Timestamp.fromDate((value as { toDate: () => Date }).toDate());
    } catch {
      return null;
    }
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const next = asStringOrNull(entry);
    if (next) out.push(next);
  }
  return out;
}

export type ParsedReservationDoc = {
  ownerUid: string;
  status: string;
  linkedBatchId: string | null;
  firingType: string | null;
  kilnId: string | null;
  preferredWindow: {
    earliestDate: Timestamp | null;
    latestDate: Timestamp | null;
  };
  notes: {
    general: string | null;
    clayBody: string | null;
    glazeNotes: string | null;
  };
};

export function parseReservationDoc(value: unknown): ParsedReservationDoc {
  const row = asRecord(value);
  const preferredWindow = asRecord(row.preferredWindow);
  const notes = asRecord(row.notes);
  return {
    ownerUid: asStringOrFallback(row.ownerUid, ""),
    status: asStringOrFallback(row.status, "unknown"),
    linkedBatchId: asStringOrNull(row.linkedBatchId),
    firingType: asStringOrNull(row.firingType),
    kilnId: asStringOrNull(row.kilnId),
    preferredWindow: {
      earliestDate: asTimestampOrNull(preferredWindow.earliestDate),
      latestDate: asTimestampOrNull(preferredWindow.latestDate),
    },
    notes: {
      general: asStringOrNull(notes.general),
      clayBody: asStringOrNull(notes.clayBody),
      glazeNotes: asStringOrNull(notes.glazeNotes),
    },
  };
}

export type ParsedMaterialsOrderItemDoc = {
  productId: string;
  quantity: number;
  trackInventory: boolean;
};

function parseMaterialsOrderItem(value: unknown): ParsedMaterialsOrderItemDoc | null {
  const row = asRecord(value);
  const productId = asStringOrNull(row.productId);
  const quantity = Math.max(asInt(row.quantity, 0), 0);
  if (!productId || quantity <= 0) return null;
  return {
    productId,
    quantity,
    trackInventory: row.trackInventory === true,
  };
}

export type ParsedMaterialsOrderDoc = {
  uid: string | null;
  status: string;
  items: ParsedMaterialsOrderItemDoc[];
};

export function parseMaterialsOrderDoc(value: unknown): ParsedMaterialsOrderDoc {
  const row = asRecord(value);
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const items: ParsedMaterialsOrderItemDoc[] = [];
  for (const entry of rawItems) {
    const parsed = parseMaterialsOrderItem(entry);
    if (parsed) items.push(parsed);
  }
  return {
    uid: asStringOrNull(row.uid),
    status: asStringOrFallback(row.status, "unknown"),
    items,
  };
}

export type ParsedMaterialProductDoc = {
  name: string;
  description: string | null;
  category: string | null;
  sku: string | null;
  priceCents: number;
  currency: string;
  stripePriceId: string | null;
  imageUrl: string | null;
  trackInventory: boolean;
  inventoryOnHand: number;
  inventoryReserved: number;
  active: boolean;
};

function normalizeCurrency(value: unknown): string {
  const next = asStringOrNull(value);
  return (next ?? "USD").toUpperCase();
}

export function parseMaterialProductDoc(value: unknown): ParsedMaterialProductDoc {
  const row = asRecord(value);
  return {
    name: asStringOrFallback(row.name, ""),
    description: asStringOrNull(row.description),
    category: asStringOrNull(row.category),
    sku: asStringOrNull(row.sku),
    priceCents: Math.max(asInt(row.priceCents, 0), 0),
    currency: normalizeCurrency(row.currency),
    stripePriceId: asStringOrNull(row.stripePriceId),
    imageUrl: asStringOrNull(row.imageUrl),
    trackInventory: row.trackInventory === true,
    inventoryOnHand: Math.max(asInt(row.inventoryOnHand, 0), 0),
    inventoryReserved: Math.max(asInt(row.inventoryReserved, 0), 0),
    active: row.active !== false,
  };
}

export type ParsedBatchDoc = {
  ownerUid: string;
  ownerDisplayName: string | null;
  title: string;
  intakeMode: string;
  journeyRootBatchId: string | null;
  isClosed: boolean;
};

export function parseBatchDoc(value: unknown): ParsedBatchDoc {
  const row = asRecord(value);
  return {
    ownerUid: asStringOrFallback(row.ownerUid, ""),
    ownerDisplayName: asStringOrNull(row.ownerDisplayName),
    title: asStringOrFallback(row.title, "Untitled batch"),
    intakeMode: asStringOrFallback(row.intakeMode, "SELF_SERVICE"),
    journeyRootBatchId: asStringOrNull(row.journeyRootBatchId),
    isClosed: asBoolean(row.isClosed),
  };
}

export type ParsedIntegrationEventDoc = {
  at: Timestamp | null;
  uid: string;
  type: string;
  subject: Record<string, unknown>;
  data: Record<string, unknown>;
  cursor: number;
};

export function parseIntegrationEventDoc(value: unknown, fallbackUid: string): ParsedIntegrationEventDoc {
  const row = asRecord(value);
  return {
    at: asTimestampOrNull(row.at),
    uid: asStringOrFallback(row.uid, fallbackUid),
    type: asStringOrFallback(row.type, "unknown"),
    subject: asRecord(row.subject),
    data: asRecord(row.data),
    cursor: Math.max(asInt(row.cursor, 0), 0),
  };
}

export type ParsedJukeboxConfigDoc = {
  enabled: boolean;
  ipAllowlistCidrs: string[];
  geoCenter: { lat: number; lng: number } | null;
  geoRadiusMeters: number;
  maxQueuePerUser: number;
  cooldownSeconds: number;
  skipVoteThreshold: number;
};

export function parseJukeboxConfigDoc(value: unknown): ParsedJukeboxConfigDoc {
  const row = asRecord(value);
  const geoCenter = asRecord(row.geoCenter);
  const lat = Number(geoCenter.lat);
  const lng = Number(geoCenter.lng);
  return {
    enabled: row.enabled === true,
    ipAllowlistCidrs: asStringArray(row.ipAllowlistCidrs),
    geoCenter: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    geoRadiusMeters: Math.max(asInt(row.geoRadiusMeters, 0), 0),
    maxQueuePerUser: Math.max(asInt(row.maxQueuePerUser, 2), 1),
    cooldownSeconds: Math.max(asInt(row.cooldownSeconds, 120), 0),
    skipVoteThreshold: Math.max(asInt(row.skipVoteThreshold, 3), 1),
  };
}

export type ParsedJukeboxTrackDoc = {
  title: string;
  artist: string | null;
  sourceType: "url_audio" | "youtube";
  url: string | null;
  youtubeVideoId: string | null;
  isActive: boolean;
  updatedAt: unknown;
};

export function parseJukeboxTrackDoc(value: unknown): ParsedJukeboxTrackDoc {
  const row = asRecord(value);
  const sourceTypeRaw = asStringOrFallback(row.sourceType, "url_audio");
  const sourceType: "url_audio" | "youtube" =
    sourceTypeRaw === "youtube" ? "youtube" : "url_audio";
  return {
    title: asStringOrFallback(row.title, ""),
    artist: asStringOrNull(row.artist),
    sourceType,
    url: sourceType === "url_audio" ? asStringOrNull(row.url) : null,
    youtubeVideoId: sourceType === "youtube" ? asStringOrNull(row.youtubeVideoId) : null,
    isActive: row.isActive !== false,
    updatedAt: row.updatedAt ?? null,
  };
}

export type ParsedJukeboxQueueItemDoc = {
  status: string;
  votesUp: number;
  votesDown: number;
  requestedAt: Timestamp | null;
  playedEndedAt: Timestamp | null;
};

export function parseJukeboxQueueItemDoc(value: unknown): ParsedJukeboxQueueItemDoc {
  const row = asRecord(value);
  return {
    status: asStringOrFallback(row.status, "queued"),
    votesUp: asInt(row.votesUp, 0),
    votesDown: asInt(row.votesDown, 0),
    requestedAt: asTimestampOrNull(row.requestedAt),
    playedEndedAt: asTimestampOrNull(row.playedEndedAt),
  };
}

export function parseVoteValue(value: unknown): 1 | -1 | null {
  if (value === 1 || value === -1) return value;
  return null;
}

export type ParsedJukeboxStateDoc = {
  nowPlayingItemId: string | null;
  isPlaying: boolean;
};

export function parseJukeboxStateDoc(value: unknown): ParsedJukeboxStateDoc {
  const row = asRecord(value);
  return {
    nowPlayingItemId: asStringOrNull(row.nowPlayingItemId),
    isPlaying: row.isPlaying === true,
  };
}
