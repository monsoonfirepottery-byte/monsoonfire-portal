import type {
  StudioCalendarEntry,
  StudioReservation,
  StudioSpace,
} from "../api/portalContracts";

export const STUDIO_TIME_ZONE = "America/Phoenix";
const PHOENIX_OFFSET = "-07:00";
const DAY_MS = 24 * 60 * 60 * 1000;

export type StudioSpaceRecord = StudioSpace & {
  resources: NonNullable<StudioSpace["resources"]>;
  templates: NonNullable<StudioSpace["templates"]>;
};

export type StudioReservationRecord = StudioReservation & {
  startAtDate: Date | null;
  endAtDate: Date | null;
};

export type StudioCalendarEntryRecord = StudioCalendarEntry & {
  startAtDate: Date | null;
  endAtDate: Date | null;
  availableResourceIds: string[];
  staffReservations: NonNullable<StudioCalendarEntry["staffReservations"]>;
};

export type StudioAgendaDay = {
  dayKey: string;
  openEntries: StudioCalendarEntryRecord[];
  fullEntries: StudioCalendarEntryRecord[];
  entries: StudioCalendarEntryRecord[];
};

export type StudioSpaceWeekSummary = {
  space: StudioSpaceRecord;
  agendaDays: StudioAgendaDay[];
  browseDays: StudioAgendaDay[];
  waitlistOnlyDays: StudioAgendaDay[];
  featuredEntry: StudioCalendarEntryRecord | null;
  alternateEntries: StudioCalendarEntryRecord[];
  openEntryCount: number;
  fullEntryCount: number;
  hasSelectableEntries: boolean;
  nextOpenEntry: StudioCalendarEntryRecord | null;
};

export function coerceStudioDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (typeof value === "object") {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === "function") {
      const parsed = candidate.toDate();
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
  }
  return null;
}

export function studioPhoenixDateKey(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

export function studioDateKeyToDate(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00${PHOENIX_OFFSET}`);
}

export function addStudioDays(dayKey: string, days: number): string {
  const start = studioDateKeyToDate(dayKey);
  return studioPhoenixDateKey(new Date(start.getTime() + days * DAY_MS));
}

export function normalizeStudioSpace(space: Partial<StudioSpace> & { id: string }): StudioSpaceRecord {
  return {
    id: space.id,
    slug: typeof space.slug === "string" ? space.slug : space.id,
    name: typeof space.name === "string" ? space.name : space.id,
    category: typeof space.category === "string" ? space.category : "Studio",
    description: typeof space.description === "string" ? space.description : null,
    memberHelpText: typeof space.memberHelpText === "string" ? space.memberHelpText : null,
    bookingMode: space.bookingMode === "resource" ? "resource" : "capacity",
    active: space.active !== false,
    capacity:
      typeof space.capacity === "number" && Number.isFinite(space.capacity) ? Math.max(1, Math.trunc(space.capacity)) : 1,
    colorToken: typeof space.colorToken === "string" ? space.colorToken : null,
    sortOrder:
      typeof space.sortOrder === "number" && Number.isFinite(space.sortOrder) ? Math.trunc(space.sortOrder) : 999,
    timezone: typeof space.timezone === "string" ? space.timezone : STUDIO_TIME_ZONE,
    resources: Array.isArray(space.resources)
      ? space.resources
          .filter((resource): resource is NonNullable<StudioSpace["resources"]>[number] => Boolean(resource))
          .map((resource, index) => ({
            id: typeof resource.id === "string" ? resource.id : `resource-${index + 1}`,
            label: typeof resource.label === "string" ? resource.label : `Resource ${index + 1}`,
            active: resource.active !== false,
          }))
      : [],
    templates: Array.isArray(space.templates)
      ? space.templates
          .filter((template): template is NonNullable<StudioSpace["templates"]>[number] => Boolean(template))
          .map((template, index) => ({
            id: typeof template.id === "string" ? template.id : `template-${index + 1}`,
            label: typeof template.label === "string" ? template.label : `Template ${index + 1}`,
            daysOfWeek: Array.isArray(template.daysOfWeek) ? template.daysOfWeek : [],
            windowStart: typeof template.windowStart === "string" ? template.windowStart : "09:00",
            windowEnd: typeof template.windowEnd === "string" ? template.windowEnd : "17:00",
            slotDurationMinutes:
              typeof template.slotDurationMinutes === "number" && Number.isFinite(template.slotDurationMinutes)
                ? Math.max(30, Math.trunc(template.slotDurationMinutes))
                : 120,
            slotIncrementMinutes:
              typeof template.slotIncrementMinutes === "number" && Number.isFinite(template.slotIncrementMinutes)
                ? Math.max(15, Math.trunc(template.slotIncrementMinutes))
                : 120,
            cleanupBufferMinutes:
              typeof template.cleanupBufferMinutes === "number" && Number.isFinite(template.cleanupBufferMinutes)
                ? Math.max(0, Math.trunc(template.cleanupBufferMinutes))
                : 0,
            leadTimeMinutes:
              typeof template.leadTimeMinutes === "number" && Number.isFinite(template.leadTimeMinutes)
                ? Math.max(0, Math.trunc(template.leadTimeMinutes))
                : 0,
            maxAdvanceDays:
              typeof template.maxAdvanceDays === "number" && Number.isFinite(template.maxAdvanceDays)
                ? Math.max(1, Math.trunc(template.maxAdvanceDays))
                : 28,
          }))
      : [],
  };
}

export function normalizeStudioReservation(
  reservation: Partial<StudioReservation> & { id: string }
): StudioReservationRecord {
  return {
    id: reservation.id,
    spaceId: typeof reservation.spaceId === "string" ? reservation.spaceId : "",
    spaceName: typeof reservation.spaceName === "string" ? reservation.spaceName : "Studio reservation",
    category: typeof reservation.category === "string" ? reservation.category : "Studio",
    bookingMode: reservation.bookingMode === "resource" ? "resource" : "capacity",
    status:
      reservation.status === "waitlisted" ||
      reservation.status === "cancelled" ||
      reservation.status === "completed"
        ? reservation.status
        : "booked",
    startAt: typeof reservation.startAt === "string" ? reservation.startAt : "",
    endAt: typeof reservation.endAt === "string" ? reservation.endAt : "",
    quantity:
      typeof reservation.quantity === "number" && Number.isFinite(reservation.quantity)
        ? Math.max(1, Math.trunc(reservation.quantity))
        : 1,
    requestedResourceIds: Array.isArray(reservation.requestedResourceIds)
      ? reservation.requestedResourceIds.filter((value): value is string => typeof value === "string")
      : [],
    assignedResourceIds: Array.isArray(reservation.assignedResourceIds)
      ? reservation.assignedResourceIds.filter((value): value is string => typeof value === "string")
      : [],
    note: typeof reservation.note === "string" ? reservation.note : null,
    ownerUid: typeof reservation.ownerUid === "string" ? reservation.ownerUid : null,
    ownerDisplayName: typeof reservation.ownerDisplayName === "string" ? reservation.ownerDisplayName : null,
    ownerEmail: typeof reservation.ownerEmail === "string" ? reservation.ownerEmail : null,
    createdAt: typeof reservation.createdAt === "string" ? reservation.createdAt : null,
    updatedAt: typeof reservation.updatedAt === "string" ? reservation.updatedAt : null,
    canCancel: reservation.canCancel === true,
    startAtDate: coerceStudioDate(reservation.startAt),
    endAtDate: coerceStudioDate(reservation.endAt),
  };
}

export function normalizeStudioCalendarEntry(
  entry: Partial<StudioCalendarEntry> & { id: string }
): StudioCalendarEntryRecord {
  return {
    id: entry.id,
    kind:
      entry.kind === "event" || entry.kind === "closure" || entry.kind === "maintenance"
        ? entry.kind
        : "availability",
    title: typeof entry.title === "string" ? entry.title : "Studio entry",
    description: typeof entry.description === "string" ? entry.description : null,
    location: typeof entry.location === "string" ? entry.location : null,
    startAt: typeof entry.startAt === "string" ? entry.startAt : "",
    endAt: typeof entry.endAt === "string" ? entry.endAt : "",
    status: typeof entry.status === "string" ? entry.status : "scheduled",
    spaceId: typeof entry.spaceId === "string" ? entry.spaceId : null,
    spaceName: typeof entry.spaceName === "string" ? entry.spaceName : null,
    category: typeof entry.category === "string" ? entry.category : null,
    bookingMode: entry.bookingMode === "resource" ? "resource" : entry.bookingMode === "capacity" ? "capacity" : null,
    capacity:
      typeof entry.capacity === "number" && Number.isFinite(entry.capacity) ? Math.max(0, Math.trunc(entry.capacity)) : null,
    bookedCount:
      typeof entry.bookedCount === "number" && Number.isFinite(entry.bookedCount) ? Math.max(0, Math.trunc(entry.bookedCount)) : null,
    waitlistCount:
      typeof entry.waitlistCount === "number" && Number.isFinite(entry.waitlistCount)
        ? Math.max(0, Math.trunc(entry.waitlistCount))
        : null,
    availableCount:
      typeof entry.availableCount === "number" && Number.isFinite(entry.availableCount)
        ? Math.max(0, Math.trunc(entry.availableCount))
        : null,
    availableResourceIds: Array.isArray(entry.availableResourceIds)
      ? entry.availableResourceIds.filter((value): value is string => typeof value === "string")
      : [],
    myReservationId: typeof entry.myReservationId === "string" ? entry.myReservationId : null,
    myWaitlistId: typeof entry.myWaitlistId === "string" ? entry.myWaitlistId : null,
    blockedBy: entry.blockedBy && typeof entry.blockedBy === "object" ? entry.blockedBy : null,
    staffReservations: Array.isArray(entry.staffReservations)
      ? entry.staffReservations.filter((row): row is NonNullable<StudioCalendarEntry["staffReservations"]>[number] => Boolean(row))
      : [],
    startAtDate: coerceStudioDate(entry.startAt),
    endAtDate: coerceStudioDate(entry.endAt),
  };
}

export function formatStudioDateLabel(date: Date | null, options?: Intl.DateTimeFormatOptions): string {
  if (!date) return "TBD";
  return date.toLocaleString("en-US", {
    timeZone: STUDIO_TIME_ZONE,
    month: "short",
    day: "numeric",
    ...options,
  });
}

export function formatStudioTimeRange(start: Date | null, end: Date | null): string {
  if (!start || !end) return "Time TBD";
  const startLabel = formatStudioTimeLabel(start);
  const endLabel = formatStudioTimeLabel(end);
  return `${startLabel} - ${endLabel}`;
}

export function formatStudioTimeLabel(date: Date | null): string {
  if (!date) return "Time TBD";
  return date.toLocaleTimeString("en-US", {
    timeZone: STUDIO_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function visibleStudioDayKeys(anchorDayKey: string, mode: "day" | "week"): string[] {
  return mode === "day"
    ? [anchorDayKey]
    : Array.from({ length: 7 }, (_, index) => addStudioDays(anchorDayKey, index));
}

export function isStudioSelectableAvailability(entry: StudioCalendarEntryRecord): boolean {
  return entry.kind === "availability" && entry.status !== "blocked";
}

export function isStudioOpenAvailability(entry: StudioCalendarEntryRecord): boolean {
  return isStudioSelectableAvailability(entry) && entry.status !== "full";
}

export function compareStudioAvailabilityEntries(
  left: StudioCalendarEntryRecord,
  right: StudioCalendarEntryRecord
): number {
  const leftMs = left.startAtDate?.getTime() ?? 0;
  const rightMs = right.startAtDate?.getTime() ?? 0;
  if (leftMs !== rightMs) return leftMs - rightMs;

  const leftStatusRank = left.status === "available" ? 0 : left.status === "partial" ? 1 : left.status === "full" ? 2 : 3;
  const rightStatusRank = right.status === "available" ? 0 : right.status === "partial" ? 1 : right.status === "full" ? 2 : 3;
  if (leftStatusRank !== rightStatusRank) return leftStatusRank - rightStatusRank;

  return (left.spaceName ?? left.title).localeCompare(right.spaceName ?? right.title);
}

export function recommendStudioOpenings(
  entries: StudioCalendarEntryRecord[],
  limit = 6
): StudioCalendarEntryRecord[] {
  return entries
    .filter(isStudioOpenAvailability)
    .slice()
    .sort(compareStudioAvailabilityEntries)
    .slice(0, limit);
}

export function groupStudioAgendaDays(
  entries: StudioCalendarEntryRecord[],
  dayKeys: string[]
): StudioAgendaDay[] {
  const grouped = new Map<string, StudioAgendaDay>();

  dayKeys.forEach((dayKey) => {
    grouped.set(dayKey, {
      dayKey,
      openEntries: [],
      fullEntries: [],
      entries: [],
    });
  });

  entries
    .filter(isStudioSelectableAvailability)
    .forEach((entry) => {
      const date = entry.startAtDate;
      if (!date) return;
      const dayKey = studioPhoenixDateKey(date);
      const group = grouped.get(dayKey);
      if (!group) return;
      if (entry.status === "full") {
        group.fullEntries.push(entry);
      } else {
        group.openEntries.push(entry);
      }
    });

  return dayKeys
    .map((dayKey) => {
      const group = grouped.get(dayKey);
      if (!group) {
        return {
          dayKey,
          openEntries: [],
          fullEntries: [],
          entries: [],
        };
      }
      group.openEntries.sort(compareStudioAvailabilityEntries);
      group.fullEntries.sort(compareStudioAvailabilityEntries);
      group.entries = [...group.openEntries, ...group.fullEntries];
      return group;
    })
    .filter((group) => group.entries.length > 0);
}

export function sortStudioSpaces(spaces: StudioSpaceRecord[]): StudioSpaceRecord[] {
  return spaces
    .slice()
    .sort((left, right) => {
      const leftOrder = typeof left.sortOrder === "number" ? left.sortOrder : Number.MAX_SAFE_INTEGER;
      const rightOrder = typeof right.sortOrder === "number" ? right.sortOrder : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.name.localeCompare(right.name);
    });
}

export function buildStudioSpaceWeekSummaries(
  spaces: StudioSpaceRecord[],
  entries: StudioCalendarEntryRecord[],
  dayKeys: string[],
  recommendationLimit = 4
): StudioSpaceWeekSummary[] {
  return sortStudioSpaces(spaces).map((space) => {
    const spaceEntries = entries.filter((entry) => entry.spaceId === space.id);
    const agendaDays = groupStudioAgendaDays(spaceEntries, dayKeys);
    const openEntries = agendaDays.flatMap((day) => day.openEntries);
    const recommendedEntries = recommendStudioOpenings(openEntries, recommendationLimit);
    const fullEntryCount = agendaDays.reduce((total, day) => total + day.fullEntries.length, 0);
    const browseDays = agendaDays.filter((day) => day.openEntries.length > 0);
    const waitlistOnlyDays = agendaDays.filter((day) => day.openEntries.length === 0 && day.fullEntries.length > 0);

    return {
      space,
      agendaDays,
      browseDays,
      waitlistOnlyDays,
      featuredEntry: recommendedEntries[0] ?? null,
      alternateEntries: recommendedEntries.slice(1),
      openEntryCount: openEntries.length,
      fullEntryCount,
      hasSelectableEntries: agendaDays.length > 0,
      nextOpenEntry: recommendedEntries[0] ?? null,
    };
  });
}
