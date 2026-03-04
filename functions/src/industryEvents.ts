export const INDUSTRY_EVENT_MODES = ["local", "remote", "hybrid"] as const;
export type IndustryEventMode = (typeof INDUSTRY_EVENT_MODES)[number];
export type IndustryEventModeFilter = IndustryEventMode | "all";

export const INDUSTRY_EVENT_STATUSES = ["draft", "published", "cancelled"] as const;
export type IndustryEventStatus = (typeof INDUSTRY_EVENT_STATUSES)[number];
export const INDUSTRY_EVENT_REVIEW_STALE_MS = 21 * 24 * 60 * 60 * 1000;
export const INDUSTRY_EVENT_RETIRE_PAST_MS = 48 * 60 * 60 * 1000;

export type IndustryEventFreshnessOutcome = "fresh" | "stale_review" | "retired" | "non_published";

export type IndustryEvent = {
  id: string;
  title: string;
  summary: string;
  description: string;
  mode: IndustryEventMode;
  status: IndustryEventStatus;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  location: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  remoteUrl: string | null;
  registrationUrl: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  featured: boolean;
  tags: string[];
  verifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  freshnessState: string | null;
  needsReview: boolean;
  reviewByAt: string | null;
  freshnessCheckedAt: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
};

export type FilterIndustryEventsOptions = {
  mode?: IndustryEventModeFilter;
  includePast?: boolean;
  includeDrafts?: boolean;
  includeCancelled?: boolean;
  featuredOnly?: boolean;
  limit?: number;
  nowMs?: number;
};

export type EvaluateIndustryEventFreshnessOptions = {
  nowMs?: number;
  staleReviewMs?: number;
  retirePastMs?: number;
};

export type IndustryEventFreshnessDecision = {
  outcome: IndustryEventFreshnessOutcome;
  nextStatus: IndustryEventStatus;
  needsReview: boolean;
  freshnessState: "fresh" | "stale_review" | "retired" | "non_published";
  reviewByAt: string | null;
  shouldRetire: boolean;
  retiredReason: string | null;
};

type TimestampLike = {
  toDate?: () => Date;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
    return null;
  }
  if (typeof value === "object") {
    const maybe = value as TimestampLike;
    if (typeof maybe.toDate === "function") {
      try {
        const parsed = maybe.toDate();
        if (parsed instanceof Date && Number.isFinite(parsed.getTime())) {
          return parsed.toISOString();
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIndustryEventStatus(value: unknown): IndustryEventStatus {
  const normalized = readString(value).toLowerCase();
  if (normalized === "published" || normalized === "cancelled" || normalized === "draft") {
    return normalized;
  }
  return "draft";
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const normalized = readString(entry).toLowerCase();
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= 20) break;
  }
  return out;
}

export function normalizeIndustryEventMode(
  value: unknown,
  context?: { location?: string | null; remoteUrl?: string | null }
): IndustryEventMode {
  const explicit = readString(value).toLowerCase();
  if (explicit === "local" || explicit === "remote" || explicit === "hybrid") {
    return explicit;
  }

  const hasLocation = readString(context?.location).length > 0;
  const hasRemoteUrl = readString(context?.remoteUrl).length > 0;
  if (hasLocation && hasRemoteUrl) return "hybrid";
  if (hasRemoteUrl) return "remote";
  return "local";
}

export function normalizeIndustryEvent(id: string, rawValue: unknown): IndustryEvent {
  const raw = asRecord(rawValue);
  const title = readString(raw["title"]) || "Industry event";
  const summary =
    readString(raw["summary"]) || readString(raw["subtitle"]) || "Curated ceramic industry event.";
  const description = readString(raw["description"]);

  const location = readString(raw["location"]) || readString(raw["venue"]) || null;
  const remoteUrl = readString(raw["remoteUrl"]) || readString(raw["virtualUrl"]) || null;

  return {
    id,
    title,
    summary,
    description,
    mode: normalizeIndustryEventMode(raw["mode"], { location, remoteUrl }),
    status: normalizeIndustryEventStatus(raw["status"]),
    startAt: toIso(raw["startAt"] ?? raw["startsAt"]),
    endAt: toIso(raw["endAt"] ?? raw["endsAt"]),
    timezone: readString(raw["timezone"]) || null,
    location,
    city: readString(raw["city"]) || null,
    region: readString(raw["region"]) || readString(raw["state"]) || null,
    country: readString(raw["country"]) || null,
    remoteUrl,
    registrationUrl: readString(raw["registrationUrl"]) || readString(raw["registerUrl"]) || null,
    sourceName: readString(raw["sourceName"]) || readString(raw["source"]) || null,
    sourceUrl: readString(raw["sourceUrl"]) || readString(raw["sourceLink"]) || null,
    featured: readBoolean(raw["featured"], false),
    tags: normalizeTags(raw["tags"]),
    verifiedAt: toIso(raw["verifiedAt"] ?? raw["sourceVerifiedAt"]),
    createdAt: toIso(raw["createdAt"]),
    updatedAt: toIso(raw["updatedAt"]),
    freshnessState: readString(raw["freshnessState"]) || null,
    needsReview: readBoolean(raw["needsReview"], false),
    reviewByAt: toIso(raw["reviewByAt"]),
    freshnessCheckedAt: toIso(raw["freshnessCheckedAt"]),
    retiredAt: toIso(raw["retiredAt"]),
    retiredReason: readString(raw["retiredReason"]) || null,
  };
}

export function isIndustryEventPast(event: Pick<IndustryEvent, "startAt" | "endAt">, nowMs = Date.now()): boolean {
  const cutoff = toMs(event.endAt) ?? toMs(event.startAt);
  if (cutoff === null) return false;
  return cutoff < nowMs;
}

export function sortIndustryEvents(events: IndustryEvent[], nowMs = Date.now()): IndustryEvent[] {
  return [...events].sort((left, right) => {
    if (left.featured !== right.featured) return left.featured ? -1 : 1;

    const leftPast = isIndustryEventPast(left, nowMs);
    const rightPast = isIndustryEventPast(right, nowMs);
    if (leftPast !== rightPast) return leftPast ? 1 : -1;

    const leftStartMs = toMs(left.startAt);
    const rightStartMs = toMs(right.startAt);

    if (!leftPast) {
      if (leftStartMs === null && rightStartMs !== null) return 1;
      if (rightStartMs === null && leftStartMs !== null) return -1;
      if (leftStartMs !== null && rightStartMs !== null && leftStartMs !== rightStartMs) {
        return leftStartMs - rightStartMs;
      }
    } else {
      if (leftStartMs === null && rightStartMs !== null) return 1;
      if (rightStartMs === null && leftStartMs !== null) return -1;
      if (leftStartMs !== null && rightStartMs !== null && leftStartMs !== rightStartMs) {
        return rightStartMs - leftStartMs;
      }
    }

    return left.title.localeCompare(right.title);
  });
}

export function filterIndustryEvents(
  events: IndustryEvent[],
  options: FilterIndustryEventsOptions = {}
): IndustryEvent[] {
  const mode = options.mode ?? "all";
  const includePast = options.includePast === true;
  const includeDrafts = options.includeDrafts === true;
  const includeCancelled = options.includeCancelled === true;
  const featuredOnly = options.featuredOnly === true;
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.min(Math.max(Number(options.limit ?? events.length) || events.length, 1), 200);

  const filtered = events.filter((event) => {
    if (!includeDrafts && event.status === "draft") return false;
    if (!includeCancelled && event.status === "cancelled") return false;
    if (!includePast && isIndustryEventPast(event, nowMs)) return false;
    if (mode !== "all" && event.mode !== mode) return false;
    if (featuredOnly && !event.featured) return false;
    return true;
  });

  return sortIndustryEvents(filtered, nowMs).slice(0, limit);
}

export function evaluateIndustryEventFreshness(
  event: Pick<IndustryEvent, "status" | "startAt" | "endAt" | "verifiedAt">,
  options: EvaluateIndustryEventFreshnessOptions = {}
): IndustryEventFreshnessDecision {
  const nowMs = options.nowMs ?? Date.now();
  const staleReviewMs = Math.max(60_000, options.staleReviewMs ?? INDUSTRY_EVENT_REVIEW_STALE_MS);
  const retirePastMs = Math.max(60_000, options.retirePastMs ?? INDUSTRY_EVENT_RETIRE_PAST_MS);
  const eventCutoffMs = toMs(event.endAt) ?? toMs(event.startAt);

  if (event.status !== "published") {
    return {
      outcome: "non_published",
      nextStatus: event.status,
      needsReview: false,
      freshnessState: "non_published",
      reviewByAt: null,
      shouldRetire: false,
      retiredReason: null,
    };
  }

  if (eventCutoffMs !== null && nowMs - eventCutoffMs >= retirePastMs) {
    return {
      outcome: "retired",
      nextStatus: "cancelled",
      needsReview: false,
      freshnessState: "retired",
      reviewByAt: null,
      shouldRetire: true,
      retiredReason: "past_event_auto_retire",
    };
  }

  const verifiedMs = toMs(event.verifiedAt);
  const needsReview = verifiedMs === null || nowMs - verifiedMs >= staleReviewMs;
  if (needsReview) {
    return {
      outcome: "stale_review",
      nextStatus: "published",
      needsReview: true,
      freshnessState: "stale_review",
      reviewByAt: verifiedMs === null ? null : new Date(verifiedMs + staleReviewMs).toISOString(),
      shouldRetire: false,
      retiredReason: null,
    };
  }

  return {
    outcome: "fresh",
    nextStatus: "published",
    needsReview: false,
    freshnessState: "fresh",
    reviewByAt: verifiedMs === null ? null : new Date(verifiedMs + staleReviewMs).toISOString(),
    shouldRetire: false,
    retiredReason: null,
  };
}
