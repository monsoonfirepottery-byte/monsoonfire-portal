import * as logger from "firebase-functions/logger";
import { z } from "zod";
import {
  adminAuth,
  db,
  makeIdempotencyId,
  nowTs,
  safeString,
  Timestamp,
  type AuthContext,
} from "./shared";
import { isStaffFromDecoded } from "./shared";
import { STUDIO_RESERVATION_SPACE_SEED } from "./studioReservationInventory.js";

const PHOENIX_TIME_ZONE = "America/Phoenix";
const PHOENIX_OFFSET = "-07:00";
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const STUDIO_SPACES_COLLECTION = "studioSpaces";
const STUDIO_RESERVATIONS_COLLECTION = "studioSpaceReservations";
const STUDIO_CALENDAR_BLOCKS_COLLECTION = "studioCalendarBlocks";
const EVENTS_COLLECTION = "events";
const STAFF_NOTIFICATION_TYPE = "STUDIO_RESERVATION_ALERT";

type StudioBookingMode = "capacity" | "resource";
type StudioReservationStatus = "booked" | "waitlisted" | "cancelled" | "completed";
type StudioCalendarEntryKind = "availability" | "event" | "closure" | "maintenance";
type StudioCalendarBlockType = "closure" | "maintenance" | "private";

type StudioReservationErrorParams = {
  httpStatus: number;
  code: string;
  message: string;
  details?: unknown;
};

export class StudioReservationError extends Error {
  httpStatus: number;
  code: string;
  details?: unknown;

  constructor(params: StudioReservationErrorParams) {
    super(params.message);
    this.name = "StudioReservationError";
    this.httpStatus = params.httpStatus;
    this.code = params.code;
    this.details = params.details;
  }
}

const slotTemplateSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  windowStart: z.string().trim().regex(/^\d{2}:\d{2}$/),
  windowEnd: z.string().trim().regex(/^\d{2}:\d{2}$/),
  slotDurationMinutes: z.number().int().min(30).max(12 * 60),
  slotIncrementMinutes: z.number().int().min(15).max(12 * 60),
  cleanupBufferMinutes: z.number().int().min(0).max(180).optional(),
  leadTimeMinutes: z.number().int().min(0).max(30 * 24 * 60).optional(),
  maxAdvanceDays: z.number().int().min(1).max(365).optional(),
});

const spaceResourceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  active: z.boolean().optional(),
});

const baseSpaceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional().nullable(),
  memberHelpText: z.string().trim().max(300).optional().nullable(),
  bookingMode: z.enum(["capacity", "resource"]),
  active: z.boolean().optional(),
  capacity: z.number().int().min(1).max(40).optional().nullable(),
  colorToken: z.string().trim().max(80).optional().nullable(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  resources: z.array(spaceResourceSchema).max(40).optional().nullable(),
  templates: z.array(slotTemplateSchema).min(1).max(12),
});

type StudioSpaceRecord = z.infer<typeof baseSpaceSchema> & {
  timezone: typeof PHOENIX_TIME_ZONE;
};

const listStudioSpacesSchema = z.object({
  includeInactive: z.boolean().optional(),
});

const listStudioCalendarSchema = z.object({
  startAt: z.string().trim().min(1),
  endAt: z.string().trim().min(1),
  spaceIds: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
  includeMine: z.boolean().optional(),
});

const listMyStudioReservationsSchema = z.object({
  includeCancelled: z.boolean().optional(),
  limit: z.number().int().min(1).max(300).optional(),
});

const createStudioReservationSchema = z.object({
  spaceId: z.string().trim().min(1).max(120),
  startAt: z.string().trim().min(1),
  endAt: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(40).optional(),
  resourceIds: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
  note: z.string().trim().max(500).optional().nullable(),
  clientRequestId: z.string().trim().min(1).max(120).optional().nullable(),
});

const joinStudioWaitlistSchema = z.object({
  spaceId: z.string().trim().min(1).max(120),
  startAt: z.string().trim().min(1),
  endAt: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(40).optional(),
  note: z.string().trim().max(500).optional().nullable(),
  clientRequestId: z.string().trim().min(1).max(120).optional().nullable(),
});

const cancelStudioReservationSchema = z.object({
  reservationId: z.string().trim().min(1).max(160),
});

const staffUpsertStudioSpaceSchema = baseSpaceSchema.extend({
  timezone: z.string().trim().optional().nullable(),
});

const staffUpsertStudioCalendarBlockSchema = z.object({
  blockId: z.string().trim().min(1).max(160).optional().nullable(),
  type: z.enum(["closure", "maintenance", "private"]),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional().nullable(),
  spaceId: z.string().trim().min(1).max(120).optional().nullable(),
  startAt: z.string().trim().min(1),
  endAt: z.string().trim().min(1),
});

const staffManageStudioReservationSchema = z.object({
  reservationId: z.string().trim().min(1).max(160),
  action: z.enum(["cancel", "promote", "complete"]),
  note: z.string().trim().max(500).optional().nullable(),
  resourceIds: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
});

export type ListStudioSpacesInput = z.infer<typeof listStudioSpacesSchema>;
export type ListStudioCalendarInput = z.infer<typeof listStudioCalendarSchema>;
export type ListMyStudioReservationsInput = z.infer<typeof listMyStudioReservationsSchema>;
export type CreateStudioReservationInput = z.infer<typeof createStudioReservationSchema>;
export type JoinStudioWaitlistInput = z.infer<typeof joinStudioWaitlistSchema>;
export type CancelStudioReservationInput = z.infer<typeof cancelStudioReservationSchema>;
export type StaffUpsertStudioSpaceInput = z.infer<typeof staffUpsertStudioSpaceSchema>;
export type StaffUpsertStudioCalendarBlockInput = z.infer<typeof staffUpsertStudioCalendarBlockSchema>;
export type StaffManageStudioReservationInput = z.infer<typeof staffManageStudioReservationSchema>;

type CalendarRange = {
  start: Date;
  end: Date;
};

type StudioSlot = {
  id: string;
  spaceId: string;
  templateId: string;
  dayKey: string;
  start: Date;
  end: Date;
};

type StudioReservationDoc = {
  id: string;
  ownerUid: string;
  ownerDisplayName: string | null;
  ownerEmail: string | null;
  spaceId: string;
  spaceName: string;
  category: string;
  bookingMode: StudioBookingMode;
  slotTemplateId: string | null;
  slotDateKey: string | null;
  startAt: Date;
  endAt: Date;
  quantity: number;
  status: StudioReservationStatus;
  note: string | null;
  requestedResourceIds: string[];
  assignedResourceIds: string[];
  createdAt: Date | null;
  updatedAt: Date | null;
  cancelledAt: Date | null;
  cancelledByUid: string | null;
  staffNote: string | null;
};

type StudioCalendarBlockDoc = {
  id: string;
  type: StudioCalendarBlockType;
  title: string;
  description: string | null;
  spaceId: string | null;
  startAt: Date;
  endAt: Date;
};

type EventOverlayDoc = {
  id: string;
  title: string;
  summary: string | null;
  startAt: Date;
  endAt: Date;
  location: string | null;
};

function toStudioSpaceRecord(seed: (typeof STUDIO_RESERVATION_SPACE_SEED)[number]): StudioSpaceRecord {
  return {
    ...seed,
    resources: seed.resources.map((resource) => ({
      id: resource.id,
      label: resource.label,
      active: resource.active !== false,
    })),
    templates: seed.templates.map((template) => ({
      ...template,
      daysOfWeek: [...template.daysOfWeek],
    })),
    timezone: PHOENIX_TIME_ZONE,
  };
}

const DEFAULT_STUDIO_SPACES: readonly StudioSpaceRecord[] = STUDIO_RESERVATION_SPACE_SEED.map((space) =>
  toStudioSpaceRecord(space)
);

function readTrimmed(value: unknown): string | null {
  const normalized = safeString(value).trim();
  return normalized ? normalized : null;
}

function parseIsoDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (typeof value === "object") {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      const parsed = maybe.toDate();
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
  }
  return null;
}

function dateToIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function formatDateKey(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: PHOENIX_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

function dateKeyDayOfWeek(dayKey: string): number {
  const parsed = new Date(`${dayKey}T00:00:00${PHOENIX_OFFSET}`);
  return parsed.getUTCDay();
}

function parsePhoenixWallTime(dayKey: string, hhmm: string): Date {
  return new Date(`${dayKey}T${hhmm}:00${PHOENIX_OFFSET}`);
}

function dayKeyFromParts(date: Date): string {
  return formatDateKey(date);
}

function nextDayKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00${PHOENIX_OFFSET}`);
  return dayKeyFromParts(new Date(date.getTime() + DAY_MS));
}

function dateKeyRange(range: CalendarRange): string[] {
  const output: string[] = [];
  let dayKey = formatDateKey(range.start);
  let safety = 0;
  while (safety < 400) {
    const dayStart = parsePhoenixWallTime(dayKey, "00:00");
    if (dayStart >= range.end) break;
    output.push(dayKey);
    dayKey = nextDayKey(dayKey);
    safety += 1;
  }
  return output;
}

function overlaps(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date): boolean {
  return leftStart.getTime() < rightEnd.getTime() && leftEnd.getTime() > rightStart.getTime();
}

function clampQuantity(value: number | null | undefined, fallback = 1): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(40, Math.trunc(value)));
}

function isStaffContext(ctx: AuthContext): boolean {
  return ctx.mode === "firebase" && isStaffFromDecoded(ctx.decoded);
}

function assertStaff(ctx: AuthContext) {
  if (!isStaffContext(ctx)) {
    throw new StudioReservationError({
      httpStatus: 403,
      code: "PERMISSION_DENIED",
      message: "Staff access required.",
    });
  }
}

function parseCalendarRange(inputStart: string, inputEnd: string): CalendarRange {
  const start = parseIsoDate(inputStart);
  const end = parseIsoDate(inputEnd);
  if (!start || !end) {
    throw new StudioReservationError({
      httpStatus: 400,
      code: "INVALID_ARGUMENT",
      message: "startAt and endAt must be valid ISO timestamps.",
    });
  }
  if (end <= start) {
    throw new StudioReservationError({
      httpStatus: 400,
      code: "INVALID_ARGUMENT",
      message: "endAt must be after startAt.",
    });
  }
  if (end.getTime() - start.getTime() > 62 * DAY_MS) {
    throw new StudioReservationError({
      httpStatus: 400,
      code: "INVALID_ARGUMENT",
      message: "Calendar range cannot exceed 62 days.",
    });
  }
  return { start, end };
}

function normalizeSpaceRecord(id: string, raw: Record<string, unknown>): StudioSpaceRecord {
  const parsed = baseSpaceSchema.safeParse({
    id,
    slug: readTrimmed(raw.slug) ?? id,
    name: readTrimmed(raw.name) ?? id,
    category: readTrimmed(raw.category) ?? "Studio",
    description: readTrimmed(raw.description),
    memberHelpText: readTrimmed(raw.memberHelpText),
    bookingMode: readTrimmed(raw.bookingMode) === "resource" ? "resource" : "capacity",
    active: raw.active !== false,
    capacity: typeof raw.capacity === "number" ? raw.capacity : null,
    colorToken: readTrimmed(raw.colorToken),
    sortOrder: typeof raw.sortOrder === "number" ? Math.trunc(raw.sortOrder) : 999,
    resources: Array.isArray(raw.resources) ? raw.resources : [],
    templates: Array.isArray(raw.templates) ? raw.templates : [],
  });
  if (!parsed.success) {
    logger.warn("invalid studio space config", {
      id,
      issues: parsed.error.issues.map((issue) => issue.message),
    });
    const fallback = DEFAULT_STUDIO_SPACES.find((space) => space.id === id);
    if (fallback) {
      return fallback;
    }
    throw new StudioReservationError({
      httpStatus: 500,
      code: "INTERNAL",
      message: `Studio space ${id} is misconfigured.`,
    });
  }
  return {
    ...parsed.data,
    active: parsed.data.active !== false,
    resources:
      parsed.data.bookingMode === "resource"
        ? parsed.data.resources?.filter((resource) => resource.active !== false) ?? []
        : [],
    timezone: PHOENIX_TIME_ZONE,
  };
}

async function loadStudioSpaces(includeInactive = false): Promise<{ spaces: StudioSpaceRecord[]; generatedDefaults: boolean }> {
  const snap = await db.collection(STUDIO_SPACES_COLLECTION).get();
  const hasStoredDocs = snap.docs.length > 0;
  const sourceSpaces = hasStoredDocs
    ? snap.docs.map((docSnap) => normalizeSpaceRecord(docSnap.id, docSnap.data() as Record<string, unknown>))
    : [...DEFAULT_STUDIO_SPACES];
  const spaces = sourceSpaces
    .filter((space) => includeInactive || space.active !== false)
    .sort((left, right) => {
      if ((left.sortOrder ?? 999) !== (right.sortOrder ?? 999)) {
        return (left.sortOrder ?? 999) - (right.sortOrder ?? 999);
      }
      return left.name.localeCompare(right.name);
    });
  return {
    spaces,
    generatedDefaults: !hasStoredDocs,
  };
}

function parseStudioReservationDoc(id: string, raw: Record<string, unknown>): StudioReservationDoc | null {
  const ownerUid = readTrimmed(raw.ownerUid);
  const spaceId = readTrimmed(raw.spaceId);
  const spaceName = readTrimmed(raw.spaceName);
  const category = readTrimmed(raw.category);
  const startAt = parseIsoDate(raw.startAt);
  const endAt = parseIsoDate(raw.endAt);
  if (!ownerUid || !spaceId || !spaceName || !category || !startAt || !endAt) {
    return null;
  }
  const bookingMode = readTrimmed(raw.bookingMode) === "resource" ? "resource" : "capacity";
  const statusRaw = readTrimmed(raw.status)?.toLowerCase();
  const status: StudioReservationStatus =
    statusRaw === "waitlisted" || statusRaw === "cancelled" || statusRaw === "completed"
      ? statusRaw
      : "booked";
  const requestedResourceIds = Array.isArray(raw.requestedResourceIds)
    ? raw.requestedResourceIds.map((value) => safeString(value).trim()).filter(Boolean)
    : [];
  const assignedResourceIds = Array.isArray(raw.assignedResourceIds)
    ? raw.assignedResourceIds.map((value) => safeString(value).trim()).filter(Boolean)
    : [];
  return {
    id,
    ownerUid,
    ownerDisplayName: readTrimmed(raw.ownerDisplayName),
    ownerEmail: readTrimmed(raw.ownerEmail),
    spaceId,
    spaceName,
    category,
    bookingMode,
    slotTemplateId: readTrimmed(raw.slotTemplateId),
    slotDateKey: readTrimmed(raw.slotDateKey),
    startAt,
    endAt,
    quantity: clampQuantity(typeof raw.quantity === "number" ? raw.quantity : null, 1),
    status,
    note: readTrimmed(raw.note),
    requestedResourceIds,
    assignedResourceIds,
    createdAt: parseIsoDate(raw.createdAt),
    updatedAt: parseIsoDate(raw.updatedAt),
    cancelledAt: parseIsoDate(raw.cancelledAt),
    cancelledByUid: readTrimmed(raw.cancelledByUid),
    staffNote: readTrimmed(raw.staffNote),
  };
}

async function loadReservationDocs(): Promise<StudioReservationDoc[]> {
  const snap = await db.collection(STUDIO_RESERVATIONS_COLLECTION).get();
  return snap.docs
    .map((docSnap) => parseStudioReservationDoc(docSnap.id, docSnap.data() as Record<string, unknown>))
    .filter((row): row is StudioReservationDoc => Boolean(row));
}

function parseStudioCalendarBlockDoc(id: string, raw: Record<string, unknown>): StudioCalendarBlockDoc | null {
  const startAt = parseIsoDate(raw.startAt);
  const endAt = parseIsoDate(raw.endAt);
  const title = readTrimmed(raw.title);
  const typeRaw = readTrimmed(raw.type)?.toLowerCase();
  if (!startAt || !endAt || !title) return null;
  const type: StudioCalendarBlockType =
    typeRaw === "maintenance" || typeRaw === "private" ? typeRaw : "closure";
  return {
    id,
    type,
    title,
    description: readTrimmed(raw.description),
    spaceId: readTrimmed(raw.spaceId),
    startAt,
    endAt,
  };
}

async function loadStudioCalendarBlocks(): Promise<StudioCalendarBlockDoc[]> {
  const snap = await db.collection(STUDIO_CALENDAR_BLOCKS_COLLECTION).get();
  return snap.docs
    .map((docSnap) => parseStudioCalendarBlockDoc(docSnap.id, docSnap.data() as Record<string, unknown>))
    .filter((row): row is StudioCalendarBlockDoc => Boolean(row));
}

function parseEventOverlayDoc(id: string, raw: Record<string, unknown>): EventOverlayDoc | null {
  const status = readTrimmed(raw.status)?.toLowerCase() ?? "draft";
  if (status !== "published" && status !== "scheduled") return null;
  const startAt = parseIsoDate(raw.startAt);
  if (!startAt) return null;
  const endAt = parseIsoDate(raw.endAt) ?? new Date(startAt.getTime() + 2 * 60 * MINUTE_MS);
  return {
    id,
    title: readTrimmed(raw.title) ?? "Workshop",
    summary: readTrimmed(raw.summary),
    startAt,
    endAt,
    location: readTrimmed(raw.location),
  };
}

async function loadEventOverlays(): Promise<EventOverlayDoc[]> {
  const snap = await db.collection(EVENTS_COLLECTION).get();
  return snap.docs
    .map((docSnap) => parseEventOverlayDoc(docSnap.id, docSnap.data() as Record<string, unknown>))
    .filter((row): row is EventOverlayDoc => Boolean(row));
}

function buildSlotsForSpace(space: StudioSpaceRecord, range: CalendarRange, now = new Date()): StudioSlot[] {
  const output: StudioSlot[] = [];
  const dayKeys = dateKeyRange(range);
  for (const dayKey of dayKeys) {
    const dayOfWeek = dateKeyDayOfWeek(dayKey);
    for (const template of space.templates) {
      if (!template.daysOfWeek.includes(dayOfWeek)) continue;
      const windowStart = parsePhoenixWallTime(dayKey, template.windowStart);
      const windowEnd = parsePhoenixWallTime(dayKey, template.windowEnd);
      const maxAdvance = now.getTime() + (template.maxAdvanceDays ?? 28) * DAY_MS;
      const leadThreshold = now.getTime() + (template.leadTimeMinutes ?? 0) * MINUTE_MS;
      for (
        let cursorMs = windowStart.getTime();
        cursorMs + template.slotDurationMinutes * MINUTE_MS <= windowEnd.getTime();
        cursorMs += template.slotIncrementMinutes * MINUTE_MS
      ) {
        const slotStart = new Date(cursorMs);
        const slotEnd = new Date(cursorMs + template.slotDurationMinutes * MINUTE_MS);
        if (slotStart.getTime() < leadThreshold) continue;
        if (slotStart.getTime() > maxAdvance) continue;
        if (!overlaps(slotStart, slotEnd, range.start, range.end)) continue;
        output.push({
          id: `${space.id}:${template.id}:${slotStart.toISOString()}`,
          spaceId: space.id,
          templateId: template.id,
          dayKey,
          start: slotStart,
          end: slotEnd,
        });
      }
    }
  }
  return output.sort((left, right) => left.start.getTime() - right.start.getTime());
}

function totalSpaceCapacity(space: StudioSpaceRecord): number {
  if (space.bookingMode === "resource") {
    return Math.max(1, (space.resources ?? []).filter((resource) => resource.active !== false).length);
  }
  return Math.max(1, space.capacity ?? 1);
}

function slotBlockForSpace(
  slot: StudioSlot,
  blocks: StudioCalendarBlockDoc[],
  spaceId: string
): StudioCalendarBlockDoc | null {
  return (
    blocks.find((block) => {
      if (block.spaceId && block.spaceId !== spaceId) return false;
      return overlaps(slot.start, slot.end, block.startAt, block.endAt);
    }) ?? null
  );
}

function slotReservationsForSpace(
  slot: StudioSlot,
  reservations: StudioReservationDoc[],
  spaceId: string
): StudioReservationDoc[] {
  return reservations.filter((reservation) => {
    if (reservation.spaceId !== spaceId) return false;
    if (reservation.status === "cancelled") return false;
    return overlaps(slot.start, slot.end, reservation.startAt, reservation.endAt);
  });
}

function activeResourceIds(space: StudioSpaceRecord): string[] {
  return (space.resources ?? [])
    .filter((resource) => resource.active !== false)
    .map((resource) => resource.id);
}

function computeSlotAvailability(space: StudioSpaceRecord, slotReservations: StudioReservationDoc[]) {
  const booked = slotReservations.filter((reservation) => reservation.status === "booked");
  const waitlisted = slotReservations.filter((reservation) => reservation.status === "waitlisted");
  if (space.bookingMode === "resource") {
    const allResourceIds = activeResourceIds(space);
    const bookedResourceIds = new Set(
      booked.flatMap((reservation) => reservation.assignedResourceIds.length > 0 ? reservation.assignedResourceIds : reservation.requestedResourceIds)
    );
    const availableResourceIds = allResourceIds.filter((resourceId) => !bookedResourceIds.has(resourceId));
    return {
      capacity: allResourceIds.length,
      bookedCount: bookedResourceIds.size,
      waitlistCount: waitlisted.length,
      availableCount: availableResourceIds.length,
      availableResourceIds,
    };
  }
  const capacity = totalSpaceCapacity(space);
  const bookedCount = booked.reduce((sum, reservation) => sum + clampQuantity(reservation.quantity, 1), 0);
  return {
    capacity,
    bookedCount,
    waitlistCount: waitlisted.length,
    availableCount: Math.max(0, capacity - bookedCount),
    availableResourceIds: [] as string[],
  };
}

function validateSlotAgainstSpace(space: StudioSpaceRecord, startAt: Date, endAt: Date): StudioSlot {
  const validationRange: CalendarRange = {
    start: new Date(startAt.getTime() - DAY_MS),
    end: new Date(endAt.getTime() + DAY_MS),
  };
  const slots = buildSlotsForSpace(space, validationRange);
  const match = slots.find(
    (slot) => slot.start.getTime() === startAt.getTime() && slot.end.getTime() === endAt.getTime()
  );
  if (!match) {
    throw new StudioReservationError({
      httpStatus: 400,
      code: "INVALID_ARGUMENT",
      message: "That reservation slot is not available for this space.",
    });
  }
  return match;
}

function ensureSpaceBookingPayload(params: {
  space: StudioSpaceRecord;
  quantity?: number;
  resourceIds?: string[];
  status: "booked" | "waitlisted";
}) {
  const quantity = clampQuantity(params.quantity, 1);
  const requestedResourceIds = (params.resourceIds ?? []).map((value) => value.trim()).filter(Boolean);
  if (params.space.bookingMode === "resource") {
    const allResourceIds = new Set(activeResourceIds(params.space));
    if (params.status === "booked" && requestedResourceIds.length === 0) {
      throw new StudioReservationError({
        httpStatus: 400,
        code: "INVALID_ARGUMENT",
        message: "Choose at least one resource for this booking.",
      });
    }
    for (const resourceId of requestedResourceIds) {
      if (!allResourceIds.has(resourceId)) {
        throw new StudioReservationError({
          httpStatus: 400,
          code: "INVALID_ARGUMENT",
          message: `Unknown resource ${resourceId} for ${params.space.name}.`,
        });
      }
    }
    return {
      quantity: Math.max(1, requestedResourceIds.length || quantity),
      requestedResourceIds,
      assignedResourceIds: params.status === "booked" ? requestedResourceIds : [],
    };
  }
  return {
    quantity,
    requestedResourceIds: [] as string[],
    assignedResourceIds: [] as string[],
  };
}

async function resolveCurrentUserProfile(ctx: AuthContext) {
  const profile = await adminAuth.getUser(ctx.uid);
  return {
    displayName: readTrimmed(profile.displayName) ?? readTrimmed(profile.email) ?? ctx.uid,
    email: readTrimmed(profile.email),
  };
}

async function listStaffRecipientUids(): Promise<string[]> {
  const recipients: string[] = [];
  let nextPageToken: string | undefined;
  let safety = 0;
  do {
    const batch = await adminAuth.listUsers(1000, nextPageToken);
    for (const userRecord of batch.users) {
      if (isStaffFromDecoded((userRecord.customClaims ?? {}) as never)) {
        recipients.push(userRecord.uid);
      }
    }
    nextPageToken = batch.pageToken;
    safety += 1;
  } while (nextPageToken && safety < 10);
  return recipients;
}

async function writeStaffNotifications(params: {
  actorUid: string;
  title: string;
  body: string;
  routePath: string;
  dedupeKey: string;
  calendarDateKey: string;
  spaceId: string;
  reservationId: string;
}) {
  const staffUids = await listStaffRecipientUids();
  if (staffUids.length === 0) {
    logger.warn("studio reservation notification skipped: no staff recipients", {
      reservationId: params.reservationId,
    });
    return;
  }
  const now = nowTs();
  await Promise.all(
    staffUids
      .filter((uid) => uid !== params.actorUid)
      .map(async (uid) => {
        const notificationId = makeIdempotencyId("studio-reservation-alert", uid, params.dedupeKey);
        await db
          .collection("users")
          .doc(uid)
          .collection("notifications")
          .doc(notificationId)
          .set(
            {
              type: STAFF_NOTIFICATION_TYPE,
              title: params.title,
              body: params.body,
              createdAt: now,
              updatedAt: now,
              dedupeKey: params.dedupeKey,
              data: {
                destination: "reservations",
                routePath: params.routePath,
                calendarDateKey: params.calendarDateKey,
                spaceId: params.spaceId,
                reservationId: params.reservationId,
              },
            },
            { merge: true }
          );
      })
  );
}

function ownerCanSeeReservation(ctx: AuthContext, reservation: StudioReservationDoc): boolean {
  return reservation.ownerUid === ctx.uid;
}

function toStudioReservationPayload(
  reservation: StudioReservationDoc,
  ctx: AuthContext,
  isStaff: boolean
) {
  const ownerVisible = ownerCanSeeReservation(ctx, reservation);
  const canSeeIdentity = isStaff || ownerVisible;
  return {
    id: reservation.id,
    spaceId: reservation.spaceId,
    spaceName: reservation.spaceName,
    category: reservation.category,
    bookingMode: reservation.bookingMode,
    status: reservation.status,
    startAt: reservation.startAt.toISOString(),
    endAt: reservation.endAt.toISOString(),
    quantity: reservation.quantity,
    requestedResourceIds: ownerVisible || isStaff ? reservation.requestedResourceIds : [],
    assignedResourceIds: ownerVisible || isStaff ? reservation.assignedResourceIds : [],
    note: ownerVisible || isStaff ? reservation.note : null,
    ownerUid: canSeeIdentity ? reservation.ownerUid : null,
    ownerDisplayName: canSeeIdentity ? reservation.ownerDisplayName : null,
    ownerEmail: isStaff ? reservation.ownerEmail : null,
    createdAt: dateToIso(reservation.createdAt),
    updatedAt: dateToIso(reservation.updatedAt),
    canCancel: reservation.status !== "cancelled" && reservation.status !== "completed" && reservation.endAt.getTime() > Date.now() && (ownerVisible || isStaff),
  };
}

function toStudioSpacePayload(space: StudioSpaceRecord) {
  return {
    id: space.id,
    slug: space.slug,
    name: space.name,
    category: space.category,
    description: space.description ?? null,
    memberHelpText: space.memberHelpText ?? null,
    bookingMode: space.bookingMode,
    active: space.active !== false,
    capacity: space.bookingMode === "capacity" ? totalSpaceCapacity(space) : totalSpaceCapacity(space),
    colorToken: space.colorToken ?? null,
    sortOrder: space.sortOrder ?? 999,
    timezone: PHOENIX_TIME_ZONE,
    resources: (space.resources ?? []).map((resource) => ({
      id: resource.id,
      label: resource.label,
      active: resource.active !== false,
    })),
    templates: space.templates.map((template) => ({
      id: template.id,
      label: template.label,
      daysOfWeek: template.daysOfWeek,
      windowStart: template.windowStart,
      windowEnd: template.windowEnd,
      slotDurationMinutes: template.slotDurationMinutes,
      slotIncrementMinutes: template.slotIncrementMinutes,
      cleanupBufferMinutes: template.cleanupBufferMinutes ?? 0,
      leadTimeMinutes: template.leadTimeMinutes ?? 0,
      maxAdvanceDays: template.maxAdvanceDays ?? 28,
    })),
  };
}

function buildCalendarEntries(params: {
  ctx: AuthContext;
  isStaff: boolean;
  spaces: StudioSpaceRecord[];
  reservations: StudioReservationDoc[];
  blocks: StudioCalendarBlockDoc[];
  events: EventOverlayDoc[];
  range: CalendarRange;
  selectedSpaceIds: Set<string>;
}) {
  const entries: Array<Record<string, unknown>> = [];
  const reservationsForFeed: Array<Record<string, unknown>> = [];

  for (const reservation of params.reservations) {
    if (!overlaps(reservation.startAt, reservation.endAt, params.range.start, params.range.end)) continue;
    if (params.selectedSpaceIds.size > 0 && !params.selectedSpaceIds.has(reservation.spaceId)) continue;
    if (params.isStaff || ownerCanSeeReservation(params.ctx, reservation)) {
      reservationsForFeed.push(toStudioReservationPayload(reservation, params.ctx, params.isStaff));
    }
  }

  for (const space of params.spaces) {
    if (params.selectedSpaceIds.size > 0 && !params.selectedSpaceIds.has(space.id)) continue;
    const spaceSlots = buildSlotsForSpace(space, params.range);
    for (const slot of spaceSlots) {
      const block = slotBlockForSpace(slot, params.blocks, space.id);
      const slotReservations = slotReservationsForSpace(slot, params.reservations, space.id);
      const availability = computeSlotAvailability(space, slotReservations);
      const myBookedReservation = slotReservations.find(
        (reservation) => reservation.status === "booked" && reservation.ownerUid === params.ctx.uid
      );
      const myWaitlistedReservation = slotReservations.find(
        (reservation) => reservation.status === "waitlisted" && reservation.ownerUid === params.ctx.uid
      );
      const status = block
        ? "blocked"
        : availability.availableCount <= 0
          ? "full"
          : availability.availableCount < availability.capacity
            ? "partial"
            : "available";
      entries.push({
        id: slot.id,
        kind: "availability" satisfies StudioCalendarEntryKind | "availability",
        spaceId: space.id,
        spaceName: space.name,
        category: space.category,
        title: `${space.name} slot`,
        startAt: slot.start.toISOString(),
        endAt: slot.end.toISOString(),
        bookingMode: space.bookingMode,
        status,
        capacity: availability.capacity,
        bookedCount: availability.bookedCount,
        waitlistCount: availability.waitlistCount,
        availableCount: availability.availableCount,
        availableResourceIds: availability.availableResourceIds,
        myReservationId: myBookedReservation?.id ?? null,
        myWaitlistId: myWaitlistedReservation?.id ?? null,
        blockedBy: block
          ? {
              blockId: block.id,
              type: block.type,
              title: block.title,
            }
          : null,
        staffReservations:
          params.isStaff
            ? slotReservations.map((reservation) => ({
                id: reservation.id,
                ownerUid: reservation.ownerUid,
                ownerDisplayName: reservation.ownerDisplayName,
                status: reservation.status,
                quantity: reservation.quantity,
                assignedResourceIds: reservation.assignedResourceIds,
              }))
            : [],
      });
    }
  }

  for (const block of params.blocks) {
    if (!overlaps(block.startAt, block.endAt, params.range.start, params.range.end)) continue;
    if (block.spaceId && params.selectedSpaceIds.size > 0 && !params.selectedSpaceIds.has(block.spaceId)) continue;
    entries.push({
      id: `block:${block.id}`,
      kind: block.type === "maintenance" ? "maintenance" : "closure",
      spaceId: block.spaceId,
      title: block.title,
      description: block.description ?? null,
      startAt: block.startAt.toISOString(),
      endAt: block.endAt.toISOString(),
      status: "blocked",
    });
  }

  for (const event of params.events) {
    if (!overlaps(event.startAt, event.endAt, params.range.start, params.range.end)) continue;
    entries.push({
      id: `event:${event.id}`,
      kind: "event",
      title: event.title,
      description: event.summary ?? null,
      location: event.location ?? null,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      status: "scheduled",
    });
  }

  entries.sort((left, right) => {
    const leftStart = parseIsoDate((left as { startAt?: unknown }).startAt)?.getTime() ?? 0;
    const rightStart = parseIsoDate((right as { startAt?: unknown }).startAt)?.getTime() ?? 0;
    if (leftStart !== rightStart) return leftStart - rightStart;
    return safeString((left as { title?: unknown }).title).localeCompare(safeString((right as { title?: unknown }).title));
  });

  reservationsForFeed.sort((left, right) => {
    const leftStart = parseIsoDate((left as { startAt?: unknown }).startAt)?.getTime() ?? 0;
    const rightStart = parseIsoDate((right as { startAt?: unknown }).startAt)?.getTime() ?? 0;
    return leftStart - rightStart;
  });

  return { entries, reservationsForFeed };
}

async function resolveSpaceOrThrow(spaceId: string, includeInactive = true): Promise<StudioSpaceRecord> {
  const { spaces } = await loadStudioSpaces(includeInactive);
  const match = spaces.find((space) => space.id === spaceId);
  if (!match) {
    throw new StudioReservationError({
      httpStatus: 404,
      code: "NOT_FOUND",
      message: "Studio space not found.",
    });
  }
  if (match.active === false) {
    throw new StudioReservationError({
      httpStatus: 409,
      code: "FAILED_PRECONDITION",
      message: "That studio space is not currently bookable.",
    });
  }
  return match;
}

function buildReservationDeepLink(startAt: Date, spaceId: string): string {
  const dayKey = formatDateKey(startAt);
  return `/reservations?date=${encodeURIComponent(dayKey)}&space=${encodeURIComponent(spaceId)}`;
}

export async function listStudioSpaces(
  _ctx: AuthContext,
  input: unknown
) {
  const parsed = listStudioSpacesSchema.parse(input);
  const { spaces, generatedDefaults } = await loadStudioSpaces(parsed.includeInactive === true);
  return {
    spaces: spaces.map(toStudioSpacePayload),
    timezone: PHOENIX_TIME_ZONE,
    generatedDefaults,
  };
}

export async function listStudioCalendar(
  ctx: AuthContext,
  input: unknown
) {
  const parsed = listStudioCalendarSchema.parse(input);
  const isStaff = isStaffContext(ctx);
  const range = parseCalendarRange(parsed.startAt, parsed.endAt);
  const { spaces, generatedDefaults } = await loadStudioSpaces(false);
  const selectedSpaceIds = new Set((parsed.spaceIds ?? []).map((value) => value.trim()).filter(Boolean));
  const [reservations, blocks, events] = await Promise.all([
    loadReservationDocs(),
    loadStudioCalendarBlocks(),
    loadEventOverlays(),
  ]);
  const { entries, reservationsForFeed } = buildCalendarEntries({
    ctx,
    isStaff,
    spaces,
    reservations,
    blocks,
    events,
    range,
    selectedSpaceIds,
  });
  return {
    spaces: spaces.map(toStudioSpacePayload),
    entries,
    reservations: reservationsForFeed,
    timezone: PHOENIX_TIME_ZONE,
    generatedDefaults,
  };
}

export async function listMyStudioReservations(
  ctx: AuthContext,
  input: unknown
) {
  const parsed = listMyStudioReservationsSchema.parse(input);
  const rows = (await loadReservationDocs())
    .filter((reservation) => reservation.ownerUid === ctx.uid)
    .filter((reservation) => parsed.includeCancelled === true || reservation.status !== "cancelled")
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime())
    .slice(0, parsed.limit ?? 120)
    .map((reservation) => toStudioReservationPayload(reservation, ctx, isStaffContext(ctx)));
  return {
    reservations: rows,
    timezone: PHOENIX_TIME_ZONE,
  };
}

export async function createStudioReservation(
  ctx: AuthContext,
  input: unknown
) {
  const parsed = createStudioReservationSchema.parse(input);
  const isStaff = isStaffContext(ctx);
  const startAt = parseIsoDate(parsed.startAt);
  const endAt = parseIsoDate(parsed.endAt);
  if (!startAt || !endAt || endAt <= startAt) {
    throw new StudioReservationError({
      httpStatus: 400,
      code: "INVALID_ARGUMENT",
      message: "Reservation startAt/endAt are invalid.",
    });
  }
  const space = await resolveSpaceOrThrow(parsed.spaceId);
  const slot = validateSlotAgainstSpace(space, startAt, endAt);
  const bookingPayload = ensureSpaceBookingPayload({
    space,
    quantity: parsed.quantity,
    resourceIds: parsed.resourceIds,
    status: "booked",
  });
  const ownerProfile = await resolveCurrentUserProfile(ctx);
  const note = readTrimmed(parsed.note);
  const clientRequestId = readTrimmed(parsed.clientRequestId);
  const reservationRef = clientRequestId
    ? db.collection(STUDIO_RESERVATIONS_COLLECTION).doc(makeIdempotencyId("studio-booking", ctx.uid, clientRequestId))
    : db.collection(STUDIO_RESERVATIONS_COLLECTION).doc();

  const now = nowTs();
  await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(reservationRef);
    if ((existingSnap as { exists?: boolean }).exists === true) {
      return;
    }
    const reservationsSnap = await tx.get(db.collection(STUDIO_RESERVATIONS_COLLECTION));
    const blocksSnap = await tx.get(db.collection(STUDIO_CALENDAR_BLOCKS_COLLECTION));
    const reservations = (reservationsSnap as { docs?: Array<{ id: string; data: () => Record<string, unknown> }> }).docs ?? [];
    const blocks = (blocksSnap as { docs?: Array<{ id: string; data: () => Record<string, unknown> }> }).docs ?? [];
    const activeReservations = reservations
      .map((docSnap) => parseStudioReservationDoc(docSnap.id, docSnap.data()))
      .filter((row): row is StudioReservationDoc => Boolean(row));
    const activeBlocks = blocks
      .map((docSnap) => parseStudioCalendarBlockDoc(docSnap.id, docSnap.data()))
      .filter((row): row is StudioCalendarBlockDoc => Boolean(row));
    const block = slotBlockForSpace(slot, activeBlocks, space.id);
    if (block) {
      throw new StudioReservationError({
        httpStatus: 409,
        code: "SLOT_BLOCKED",
        message: `${space.name} is blocked for that time.`,
      });
    }
    const slotReservations = slotReservationsForSpace(slot, activeReservations, space.id);
    const availability = computeSlotAvailability(space, slotReservations);
    if (space.bookingMode === "resource") {
      const unavailable = bookingPayload.assignedResourceIds.filter(
        (resourceId) => !availability.availableResourceIds.includes(resourceId)
      );
      if (unavailable.length > 0) {
        throw new StudioReservationError({
          httpStatus: 409,
          code: "SLOT_FULL",
          message: "One or more selected resources are already booked.",
          details: { unavailableResourceIds: unavailable },
        });
      }
    } else if (bookingPayload.quantity > availability.availableCount) {
      throw new StudioReservationError({
        httpStatus: 409,
        code: "SLOT_FULL",
        message: "That slot is already full.",
        details: {
          availableCount: availability.availableCount,
        },
      });
    }
    tx.set(reservationRef, {
      ownerUid: ctx.uid,
      ownerDisplayName: ownerProfile.displayName,
      ownerEmail: ownerProfile.email,
      spaceId: space.id,
      spaceName: space.name,
      category: space.category,
      bookingMode: space.bookingMode,
      slotTemplateId: slot.templateId,
      slotDateKey: slot.dayKey,
      startAt: Timestamp.fromDate(startAt),
      endAt: Timestamp.fromDate(endAt),
      quantity: bookingPayload.quantity,
      requestedResourceIds: bookingPayload.requestedResourceIds,
      assignedResourceIds: bookingPayload.assignedResourceIds,
      status: "booked",
      note: note ?? null,
      staffNote: null,
      createdByUid: ctx.uid,
      createdByRole: isStaff ? "staff" : "member",
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
      cancelledByUid: null,
    });
  });

  await writeStaffNotifications({
    actorUid: ctx.uid,
    title: "New studio reservation",
    body: `${ownerProfile.displayName} booked ${space.name} on ${startAt.toLocaleString("en-US", {
      timeZone: PHOENIX_TIME_ZONE,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}.`,
    routePath: buildReservationDeepLink(startAt, space.id),
    dedupeKey: `booked:${reservationRef.id}:${ctx.uid}`,
    calendarDateKey: formatDateKey(startAt),
    spaceId: space.id,
    reservationId: reservationRef.id,
  });

  return {
    reservationId: reservationRef.id,
    status: "booked",
    routePath: buildReservationDeepLink(startAt, space.id),
    calendarDateKey: formatDateKey(startAt),
  };
}

export async function joinStudioWaitlist(
  ctx: AuthContext,
  input: unknown
) {
  const parsed = joinStudioWaitlistSchema.parse(input);
  const startAt = parseIsoDate(parsed.startAt);
  const endAt = parseIsoDate(parsed.endAt);
  if (!startAt || !endAt || endAt <= startAt) {
    throw new StudioReservationError({
      httpStatus: 400,
      code: "INVALID_ARGUMENT",
      message: "Waitlist startAt/endAt are invalid.",
    });
  }
  const space = await resolveSpaceOrThrow(parsed.spaceId);
  const slot = validateSlotAgainstSpace(space, startAt, endAt);
  const ownerProfile = await resolveCurrentUserProfile(ctx);
  const note = readTrimmed(parsed.note);
  const clientRequestId = readTrimmed(parsed.clientRequestId);
  const reservationRef = clientRequestId
    ? db.collection(STUDIO_RESERVATIONS_COLLECTION).doc(makeIdempotencyId("studio-waitlist", ctx.uid, clientRequestId))
    : db.collection(STUDIO_RESERVATIONS_COLLECTION).doc();
  const now = nowTs();

  await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(reservationRef);
    if ((existingSnap as { exists?: boolean }).exists === true) {
      return;
    }
    const reservationsSnap = await tx.get(db.collection(STUDIO_RESERVATIONS_COLLECTION));
    const reservations = (reservationsSnap as { docs?: Array<{ id: string; data: () => Record<string, unknown> }> }).docs ?? [];
    const activeReservations = reservations
      .map((docSnap) => parseStudioReservationDoc(docSnap.id, docSnap.data()))
      .filter((row): row is StudioReservationDoc => Boolean(row));
    const alreadyQueued = activeReservations.find((reservation) => {
      return (
        reservation.ownerUid === ctx.uid &&
        reservation.spaceId === space.id &&
        reservation.startAt.getTime() === startAt.getTime() &&
        reservation.endAt.getTime() === endAt.getTime() &&
        reservation.status !== "cancelled"
      );
    });
    if (alreadyQueued) {
      throw new StudioReservationError({
        httpStatus: 409,
        code: "CONFLICT",
        message: "You already have a booking or waitlist entry for that slot.",
      });
    }
    tx.set(reservationRef, {
      ownerUid: ctx.uid,
      ownerDisplayName: ownerProfile.displayName,
      ownerEmail: ownerProfile.email,
      spaceId: space.id,
      spaceName: space.name,
      category: space.category,
      bookingMode: space.bookingMode,
      slotTemplateId: slot.templateId,
      slotDateKey: slot.dayKey,
      startAt: Timestamp.fromDate(startAt),
      endAt: Timestamp.fromDate(endAt),
      quantity: clampQuantity(parsed.quantity, 1),
      requestedResourceIds: [],
      assignedResourceIds: [],
      status: "waitlisted",
      note: note ?? null,
      staffNote: null,
      createdByUid: ctx.uid,
      createdByRole: "member",
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
      cancelledByUid: null,
    });
  });

  await writeStaffNotifications({
    actorUid: ctx.uid,
    title: "New studio waitlist request",
    body: `${ownerProfile.displayName} joined the waitlist for ${space.name} on ${startAt.toLocaleString("en-US", {
      timeZone: PHOENIX_TIME_ZONE,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}.`,
    routePath: buildReservationDeepLink(startAt, space.id),
    dedupeKey: `waitlisted:${reservationRef.id}:${ctx.uid}`,
    calendarDateKey: formatDateKey(startAt),
    spaceId: space.id,
    reservationId: reservationRef.id,
  });

  return {
    reservationId: reservationRef.id,
    status: "waitlisted",
    routePath: buildReservationDeepLink(startAt, space.id),
    calendarDateKey: formatDateKey(startAt),
  };
}

export async function cancelStudioReservation(
  ctx: AuthContext,
  input: unknown
) {
  const parsed = cancelStudioReservationSchema.parse(input);
  const isStaff = isStaffContext(ctx);
  const reservationRef = db.collection(STUDIO_RESERVATIONS_COLLECTION).doc(parsed.reservationId);
  const now = nowTs();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reservationRef);
    if (!(snap as { exists?: boolean }).exists) {
      throw new StudioReservationError({
        httpStatus: 404,
        code: "NOT_FOUND",
        message: "Studio reservation not found.",
      });
    }
    const reservation = parseStudioReservationDoc(parsed.reservationId, (snap as { data: () => Record<string, unknown> }).data());
    if (!reservation) {
      throw new StudioReservationError({
        httpStatus: 500,
        code: "INTERNAL",
        message: "Studio reservation is malformed.",
      });
    }
    if (reservation.ownerUid !== ctx.uid && !isStaff) {
      throw new StudioReservationError({
        httpStatus: 403,
        code: "PERMISSION_DENIED",
        message: "You cannot cancel this reservation.",
      });
    }
    if (reservation.status === "cancelled") {
      return;
    }
    if (reservation.endAt.getTime() <= Date.now() && !isStaff) {
      throw new StudioReservationError({
        httpStatus: 409,
        code: "FAILED_PRECONDITION",
        message: "Past reservations cannot be canceled here.",
      });
    }
    tx.set(
      reservationRef,
      {
        status: "cancelled",
        updatedAt: now,
        cancelledAt: now,
        cancelledByUid: ctx.uid,
      },
      { merge: true }
    );
  });

  return {
    reservationId: parsed.reservationId,
    status: "cancelled",
  };
}

export async function staffUpsertStudioSpace(
  ctx: AuthContext,
  input: unknown
) {
  assertStaff(ctx);
  const parsed = staffUpsertStudioSpaceSchema.parse(input);
  const ref = db.collection(STUDIO_SPACES_COLLECTION).doc(parsed.id);
  const payload = {
    id: parsed.id,
    slug: parsed.slug,
    name: parsed.name,
    category: parsed.category,
    description: parsed.description ?? null,
    memberHelpText: parsed.memberHelpText ?? null,
    bookingMode: parsed.bookingMode,
    active: parsed.active !== false,
    capacity: parsed.bookingMode === "capacity" ? clampQuantity(parsed.capacity ?? 1, 1) : null,
    colorToken: parsed.colorToken ?? null,
    sortOrder: parsed.sortOrder ?? 999,
    resources:
      parsed.bookingMode === "resource"
        ? (parsed.resources ?? []).map((resource) => ({
            id: resource.id,
            label: resource.label,
            active: resource.active !== false,
          }))
        : [],
    templates: parsed.templates.map((template) => ({
      id: template.id,
      label: template.label,
      daysOfWeek: template.daysOfWeek,
      windowStart: template.windowStart,
      windowEnd: template.windowEnd,
      slotDurationMinutes: template.slotDurationMinutes,
      slotIncrementMinutes: template.slotIncrementMinutes,
      cleanupBufferMinutes: template.cleanupBufferMinutes ?? 0,
      leadTimeMinutes: template.leadTimeMinutes ?? 0,
      maxAdvanceDays: template.maxAdvanceDays ?? 28,
    })),
    timezone: PHOENIX_TIME_ZONE,
    updatedAt: nowTs(),
    updatedByUid: ctx.uid,
  };
  await ref.set(payload, { merge: true });
  return {
    space: toStudioSpacePayload(normalizeSpaceRecord(parsed.id, payload)),
  };
}

export async function staffUpsertStudioCalendarBlock(
  ctx: AuthContext,
  input: unknown
) {
  assertStaff(ctx);
  const parsed = staffUpsertStudioCalendarBlockSchema.parse(input);
  const startAt = parseIsoDate(parsed.startAt);
  const endAt = parseIsoDate(parsed.endAt);
  if (!startAt || !endAt || endAt <= startAt) {
    throw new StudioReservationError({
      httpStatus: 400,
      code: "INVALID_ARGUMENT",
      message: "Calendar block times are invalid.",
    });
  }
  if (parsed.spaceId) {
    await resolveSpaceOrThrow(parsed.spaceId);
  }
  const ref = parsed.blockId
    ? db.collection(STUDIO_CALENDAR_BLOCKS_COLLECTION).doc(parsed.blockId)
    : db.collection(STUDIO_CALENDAR_BLOCKS_COLLECTION).doc();
  await ref.set(
    {
      type: parsed.type,
      title: parsed.title,
      description: parsed.description ?? null,
      spaceId: parsed.spaceId ?? null,
      startAt: Timestamp.fromDate(startAt),
      endAt: Timestamp.fromDate(endAt),
      updatedAt: nowTs(),
      updatedByUid: ctx.uid,
    },
    { merge: true }
  );
  return {
    blockId: ref.id,
    type: parsed.type,
  };
}

export async function staffManageStudioReservation(
  ctx: AuthContext,
  input: unknown
) {
  assertStaff(ctx);
  const parsed = staffManageStudioReservationSchema.parse(input);
  const reservationRef = db.collection(STUDIO_RESERVATIONS_COLLECTION).doc(parsed.reservationId);
  const now = nowTs();

  await db.runTransaction(async (tx) => {
    const reservationSnap = await tx.get(reservationRef);
    if (!(reservationSnap as { exists?: boolean }).exists) {
      throw new StudioReservationError({
        httpStatus: 404,
        code: "NOT_FOUND",
        message: "Studio reservation not found.",
      });
    }
    const reservation = parseStudioReservationDoc(
      parsed.reservationId,
      (reservationSnap as { data: () => Record<string, unknown> }).data()
    );
    if (!reservation) {
      throw new StudioReservationError({
        httpStatus: 500,
        code: "INTERNAL",
        message: "Studio reservation is malformed.",
      });
    }

    if (parsed.action === "cancel") {
      tx.set(
        reservationRef,
        {
          status: "cancelled",
          updatedAt: now,
          cancelledAt: now,
          cancelledByUid: ctx.uid,
          staffNote: readTrimmed(parsed.note),
        },
        { merge: true }
      );
      return;
    }

    if (parsed.action === "complete") {
      tx.set(
        reservationRef,
        {
          status: "completed",
          updatedAt: now,
          staffNote: readTrimmed(parsed.note),
        },
        { merge: true }
      );
      return;
    }

    const space = await resolveSpaceOrThrow(reservation.spaceId);
    const slot = validateSlotAgainstSpace(space, reservation.startAt, reservation.endAt);
    const requestedResourceIds = (parsed.resourceIds ?? reservation.requestedResourceIds).map((value) => value.trim()).filter(Boolean);
    const bookingPayload = ensureSpaceBookingPayload({
      space,
      quantity: reservation.quantity,
      resourceIds: requestedResourceIds,
      status: "booked",
    });
    const reservationsSnap = await tx.get(db.collection(STUDIO_RESERVATIONS_COLLECTION));
    const reservations = (reservationsSnap as { docs?: Array<{ id: string; data: () => Record<string, unknown> }> }).docs ?? [];
    const activeReservations = reservations
      .map((docSnap) => parseStudioReservationDoc(docSnap.id, docSnap.data()))
      .filter((row): row is StudioReservationDoc => Boolean(row))
      .filter((row) => row.id !== parsed.reservationId);
    const slotReservations = slotReservationsForSpace(slot, activeReservations, space.id);
    const availability = computeSlotAvailability(space, slotReservations);

    if (space.bookingMode === "resource") {
      const unavailable = bookingPayload.assignedResourceIds.filter(
        (resourceId) => !availability.availableResourceIds.includes(resourceId)
      );
      if (unavailable.length > 0) {
        throw new StudioReservationError({
          httpStatus: 409,
          code: "SLOT_FULL",
          message: "No resource is free to promote this waitlist entry.",
        });
      }
    } else if (bookingPayload.quantity > availability.availableCount) {
      throw new StudioReservationError({
        httpStatus: 409,
        code: "SLOT_FULL",
        message: "No capacity is free to promote this waitlist entry.",
      });
    }

    tx.set(
      reservationRef,
      {
        status: "booked",
        assignedResourceIds: bookingPayload.assignedResourceIds,
        requestedResourceIds: bookingPayload.requestedResourceIds,
        updatedAt: now,
        promotedAt: now,
        promotedByUid: ctx.uid,
        staffNote: readTrimmed(parsed.note),
      },
      { merge: true }
    );
  });

  return {
    reservationId: parsed.reservationId,
    status: parsed.action === "complete" ? "completed" : parsed.action === "cancel" ? "cancelled" : "booked",
  };
}
