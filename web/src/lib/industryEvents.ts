import type { IndustryEventMode, IndustryEventSummary } from "../api/portalContracts";

export type IndustryEventBrowseMode = IndustryEventMode | "all";

type FilterIndustryEventsOptions = {
  mode?: IndustryEventBrowseMode;
  search?: string;
  includePast?: boolean;
  nowMs?: number;
};

function toMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function isIndustryEventPast(event: Pick<IndustryEventSummary, "startAt" | "endAt">, nowMs = Date.now()): boolean {
  const cutoff = toMs(event.endAt) ?? toMs(event.startAt);
  if (cutoff === null) return false;
  return cutoff < nowMs;
}

export function sortIndustryEvents(events: IndustryEventSummary[], nowMs = Date.now()): IndustryEventSummary[] {
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
  events: IndustryEventSummary[],
  options: FilterIndustryEventsOptions = {}
): IndustryEventSummary[] {
  const mode = options.mode ?? "all";
  const includePast = options.includePast === true;
  const term = options.search?.trim().toLowerCase() ?? "";
  const nowMs = options.nowMs ?? Date.now();

  const filtered = events.filter((event) => {
    if (mode !== "all" && event.mode !== mode) return false;
    if (!includePast && isIndustryEventPast(event, nowMs)) return false;
    if (!term) return true;
    const haystack = [
      event.title,
      event.summary,
      event.location ?? "",
      event.city ?? "",
      event.region ?? "",
      event.country ?? "",
      ...(event.tags ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });

  return sortIndustryEvents(filtered, nowMs);
}

export function industryEventModeLabel(mode: IndustryEventMode): string {
  if (mode === "local") return "Local";
  if (mode === "remote") return "Remote";
  return "Hybrid";
}

export function industryEventLocationLabel(event: Pick<IndustryEventSummary, "mode" | "location" | "city" | "region">): string {
  if (event.mode === "remote") return "Remote";
  const cityRegion = [event.city, event.region].filter(Boolean).join(", ");
  return event.location || cityRegion || "Location announced soon";
}

