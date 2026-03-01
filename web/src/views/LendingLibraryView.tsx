import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import {
  V1_LIBRARY_LOANS_CHECKIN_FN,
  V1_LIBRARY_LOANS_CHECKOUT_FN,
  V1_LIBRARY_LOANS_LIST_MINE_FN,
  V1_LIBRARY_RECOMMENDATIONS_CREATE_FN,
  V1_LIBRARY_RECOMMENDATIONS_FEEDBACK_SUBMIT_FN,
  V1_LIBRARY_RECOMMENDATIONS_LIST_FN,
  V1_LIBRARY_RATINGS_UPSERT_FN,
  V1_LIBRARY_READING_STATUS_UPSERT_FN,
  V1_LIBRARY_REVIEWS_CREATE_FN,
  V1_LIBRARY_REVIEWS_UPDATE_FN,
  V1_LIBRARY_TAG_SUBMISSIONS_CREATE_FN,
  type LibraryCatalogAvailabilityFilter,
  type LibraryExternalLookupRequest,
  type LibraryExternalLookupSource,
  type LibraryItemsSort,
  type LibraryRolloutConfigGetRequest,
  type LibraryRolloutPhase,
  type LibraryRecommendationsCreateRequest,
  type LibraryRecommendationsCreateResponse,
  type LibraryRecommendationsFeedbackSubmitRequest,
  type LibraryRecommendationsFeedbackSubmitResponse,
  type LibraryRecommendationsListRequest,
  type LibraryRecommendationsListResponse,
  type LibraryTagSubmissionCreateRequest,
  type LibraryTagSubmissionCreateResponse,
} from "../api/portalContracts";
import { createFunctionsClient } from "../api/functionsClient";
import { createPortalApi } from "../api/portalApi";
import { db } from "../firebase";
import { track } from "../lib/analytics";
import type { AnalyticsProps } from "../lib/analytics";
import {
  normalizeLibraryExternalLookupResult,
  normalizeLibraryItem,
  normalizeLibraryLoan,
  normalizeLibraryRecommendation,
  normalizeLibraryRequest,
  resolveMemberApprovedLibraryCoverUrl,
} from "../lib/normalizers/library";
import type {
  LibraryDifficulty,
  LibraryExternalLookupResult,
  LibraryItem,
  LibraryLoan,
  LibraryRecommendation,
  LibraryRecommendationFeedbackKind,
  LibraryRequest,
} from "../types/library";
import { formatMaybeTimestamp } from "../utils/format";
import { toVoidHandler } from "../utils/toVoidHandler";
import "./LendingLibraryView.css";

const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
type ImportMetaEnvShape = { VITE_FUNCTIONS_BASE_URL?: string };
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;
const MAX_LOANS = 2;
const LOAN_LENGTH_LABEL = "1 month";
const NOTIFY_PREFS_STORAGE_KEY = "mf_lending_notify_prefs";
const LENDING_HANDOFF_STORAGE_SLOT = "mf_lending_handoff_v1";
const ACQUISITION_REQUEST_SECTION_ID = "acquisition-request-panel";
const PUBLIC_LIBRARY_SEARCH_BASE_URL = "https://www.worldcat.org/search?q=";
const CATALOG_SEARCH_DEBOUNCE_MS = 280;

type CatalogAvailability = "all" | LibraryCatalogAvailabilityFilter;
type DiscoverySectionKey = "staff_picks" | "most_borrowed" | "recently_added" | "recently_reviewed";
type WorkshopRequestLevel = "all-levels" | "beginner" | "intermediate" | "advanced";
type WorkshopRequestSchedule =
  | "weekday-evening"
  | "weekday-daytime"
  | "weekend-morning"
  | "weekend-afternoon"
  | "flexible";
type ReadingStatusValue = "have" | "borrowed" | "want_to_read" | "recommended";

type LendingHandoffPayload = {
  search?: string;
  focusTechnique?: string;
  filter?: CatalogAvailability;
  source?: string;
  atIso?: string;
};

type Props = {
  user: User;
  adminToken?: string;
  isStaff: boolean;
};

type ReviewEntry = {
  id: string;
  itemId: string;
  itemTitle: string;
  practicality: number;
  difficulty: LibraryDifficulty;
  bestFor: string;
  reflection: string | null;
  reviewerUid: string | null;
  createdAt: { toDate?: () => Date } | null;
};

type ReviewAggregate = {
  reviewCount: number;
  averagePracticality: number | null;
  topDifficulty: LibraryDifficulty | null;
  topBestFor: string | null;
  reflectionsCount: number;
  latestReflection: string | null;
};

type DiscoveryRail = {
  key: DiscoverySectionKey;
  title: string;
  subtitle: string;
  items: LibraryItem[];
};

type CatalogFilters = {
  mediaTypes: string[];
  genre: string;
  studioCategoryInput: string;
  availability: CatalogAvailability;
  ratingMin: number | null;
  ratingMax: number | null;
  sort: LibraryItemsSort;
};

const DISCOVERY_RAIL_CONFIG: Array<{
  key: DiscoverySectionKey;
  title: string;
  subtitle: string;
}> = [
  {
    key: "staff_picks",
    title: "Staff picks",
    subtitle: "Curated by staff with practical rationale for studio use.",
  },
  {
    key: "most_borrowed",
    title: "Most borrowed",
    subtitle: "Frequently checked out by members this season.",
  },
  {
    key: "recently_added",
    title: "Recently added",
    subtitle: "New arrivals and newly surfaced catalog entries.",
  },
  {
    key: "recently_reviewed",
    title: "Recently reviewed",
    subtitle: "Titles with fresh member review activity.",
  },
];

const MEDIA_TYPE_OPTIONS = [
  { value: "book", label: "Book" },
  { value: "media", label: "Media" },
  { value: "tool", label: "Tool" },
  { value: "other", label: "Other" },
];

const SORT_OPTIONS: Array<{ value: LibraryItemsSort; label: string }> = [
  { value: "recently_added", label: "Recently added" },
  { value: "recently_reviewed", label: "Recently reviewed" },
  { value: "most_borrowed", label: "Most borrowed" },
  { value: "highest_rated", label: "Highest rated" },
  { value: "staff_picks", label: "Staff picks" },
];
const SORT_VALUE_SET = new Set<LibraryItemsSort>(SORT_OPTIONS.map((option) => option.value));
const AVAILABILITY_VALUE_SET = new Set<CatalogAvailability>([
  "all",
  "available",
  "checked_out",
  "overdue",
  "lost",
  "unavailable",
  "archived",
]);
const MEDIA_TYPE_VALUE_SET = new Set(MEDIA_TYPE_OPTIONS.map((option) => option.value));

const DEFAULT_CATALOG_FILTERS: CatalogFilters = {
  mediaTypes: [],
  genre: "",
  studioCategoryInput: "",
  availability: "all",
  ratingMin: null,
  ratingMax: null,
  sort: "recently_added",
};

type RecommendationComposerDraft = {
  title: string;
  author: string;
  reason: string;
  isbn: string;
  techniques: string;
  studioRelevance: string;
  intentContext: string;
  linkUrl: string;
  coverUrl: string;
  sourceLabel: string;
  sourceUrl: string;
};

type CatalogUrlState = {
  search: string;
  filters: CatalogFilters;
  selectedItemId: string | null;
};

function resolveFunctionsBaseUrl() {
  const env =
    typeof import.meta !== "undefined" && ENV.VITE_FUNCTIONS_BASE_URL
      ? String(ENV.VITE_FUNCTIONS_BASE_URL)
      : "";
  return env || DEFAULT_FUNCTIONS_BASE_URL;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatAvailability(item: LibraryItem) {
  const total = typeof item.totalCopies === "number" ? item.totalCopies : 1;
  const available = typeof item.availableCopies === "number" ? item.availableCopies : 0;
  return `${available} available - ${total} total`;
}

function memberCoverPlaceholderLabel(item: LibraryItem): string {
  const coverUrl = typeof item.coverUrl === "string" ? item.coverUrl.trim() : "";
  if (!coverUrl || item.coverQualityStatus === "missing") {
    return "No cover";
  }
  return "Cover pending review";
}

function renderMemberLibraryCover(item: LibraryItem) {
  const approvedCoverUrl = resolveMemberApprovedLibraryCoverUrl(item);
  if (approvedCoverUrl) {
    return <img className="library-cover" src={approvedCoverUrl} alt={item.title} />;
  }
  return <div className="library-cover placeholder">{memberCoverPlaceholderLabel(item)}</div>;
}

function requestIsActive(status: string) {
  return status === "pending_approval" || status === "approved";
}

function loanIsActive(status: string) {
  return status !== "returned";
}

function asMs(value: { toDate?: () => Date } | null | undefined) {
  return value?.toDate?.()?.getTime() ?? 0;
}

function normalizeDifficulty(value: unknown): LibraryDifficulty {
  if (value === "beginner" || value === "intermediate" || value === "advanced" || value === "all-levels") {
    return value;
  }
  return "all-levels";
}

function normalizePracticality(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  if (parsed < 1) return 1;
  if (parsed > 5) return 5;
  return Math.round(parsed);
}

function capitalizeWords(value: string) {
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function normalizeReadingStatus(value: unknown): ReadingStatusValue | null {
  if (value === "have" || value === "borrowed" || value === "want_to_read" || value === "recommended") {
    return value;
  }
  return null;
}

function formatTechniqueLabel(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return "Technique";
  return capitalizeWords(cleaned);
}

function parseCatalogUrlState(searchValue: string): CatalogUrlState {
  const params = new URLSearchParams(searchValue);
  const search = (params.get("q") ?? "").trim().slice(0, 200);
  const sortRaw = params.get("sort");
  const availabilityRaw = params.get("availability");
  const genre = (params.get("genre") ?? "").trim().slice(0, 120);
  const studioCategoryInput = (params.get("studioCategory") ?? "").trim().slice(0, 200);
  const mediaTypes = (params.get("mediaType") ?? "")
    .split(/[,\s]+/g)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0 && MEDIA_TYPE_VALUE_SET.has(entry));
  const dedupedMediaTypes = Array.from(new Set(mediaTypes)).slice(0, 6);
  const ratingMinRaw = Number(params.get("ratingMin"));
  const ratingMaxRaw = Number(params.get("ratingMax"));
  const ratingMin =
    Number.isFinite(ratingMinRaw) && ratingMinRaw >= 1 && ratingMinRaw <= 5
      ? Math.round(ratingMinRaw)
      : null;
  const ratingMax =
    Number.isFinite(ratingMaxRaw) && ratingMaxRaw >= 1 && ratingMaxRaw <= 5
      ? Math.round(ratingMaxRaw)
      : null;
  const selectedItemIdRaw = (params.get("item") ?? "").trim();
  const selectedItemId = selectedItemIdRaw ? selectedItemIdRaw.slice(0, 200) : null;

  return {
    search,
    filters: {
      mediaTypes: dedupedMediaTypes,
      genre,
      studioCategoryInput,
      availability: AVAILABILITY_VALUE_SET.has(availabilityRaw as CatalogAvailability)
        ? (availabilityRaw as CatalogAvailability)
        : "all",
      ratingMin,
      ratingMax,
      sort: SORT_VALUE_SET.has(sortRaw as LibraryItemsSort)
        ? (sortRaw as LibraryItemsSort)
        : DEFAULT_CATALOG_FILTERS.sort,
    },
    selectedItemId,
  };
}

function buildCatalogUrlQuery(searchValue: string, filters: CatalogFilters, selectedItemId: string | null): string {
  const params = new URLSearchParams();
  const trimmedSearch = searchValue.trim();
  if (trimmedSearch) params.set("q", trimmedSearch);
  if (filters.sort !== DEFAULT_CATALOG_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.mediaTypes.length > 0) params.set("mediaType", filters.mediaTypes.join(","));
  if (filters.genre.trim()) params.set("genre", filters.genre.trim());
  if (filters.studioCategoryInput.trim()) params.set("studioCategory", filters.studioCategoryInput.trim());
  if (filters.availability !== "all") params.set("availability", filters.availability);
  if (typeof filters.ratingMin === "number") params.set("ratingMin", String(filters.ratingMin));
  if (typeof filters.ratingMax === "number") params.set("ratingMax", String(filters.ratingMax));
  if (selectedItemId) params.set("item", selectedItemId);
  return params.toString();
}

function countActiveCatalogFilters(filters: CatalogFilters, searchValue: string): number {
  let count = 0;
  if (searchValue.trim().length > 0) count += 1;
  if (filters.mediaTypes.length > 0) count += 1;
  if (filters.genre.trim().length > 0) count += 1;
  if (filters.studioCategoryInput.trim().length > 0) count += 1;
  if (filters.availability !== "all") count += 1;
  if (typeof filters.ratingMin === "number") count += 1;
  if (typeof filters.ratingMax === "number") count += 1;
  if (filters.sort !== DEFAULT_CATALOG_FILTERS.sort) count += 1;
  return count;
}

function formatStars(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "No ratings";
  return `${value.toFixed(1)} / 5 practical`;
}

function buildPublicLibrarySearchUrl(query: string) {
  const trimmed = query.trim();
  return `${PUBLIC_LIBRARY_SEARCH_BASE_URL}${encodeURIComponent(trimmed || "ceramics library")}`;
}

function createEmptyDiscoveryRails(): DiscoveryRail[] {
  return DISCOVERY_RAIL_CONFIG.map((rail) => ({ ...rail, items: [] }));
}

function readDiscoverySectionRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
}

function normalizeFilterTokens(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n;]+/g)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 20);
}

function itemRating(item: LibraryItem): number | null {
  const aggregateRating =
    typeof item.aggregateRating === "number" && Number.isFinite(item.aggregateRating) ? item.aggregateRating : null;
  if (aggregateRating !== null) return aggregateRating;
  const summaryRating = item.reviewSummary?.averagePracticality;
  return typeof summaryRating === "number" && Number.isFinite(summaryRating) ? summaryRating : null;
}

function itemLastReviewedMs(item: LibraryItem): number {
  if (typeof item.lastReviewedAtIso === "string") {
    const parsed = Date.parse(item.lastReviewedAtIso);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeLibraryToken(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError";
  }
  return error instanceof Error && error.name === "AbortError";
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [delayMs, value]);

  return debounced;
}

function recommendationCreatedLabel(entry: LibraryRecommendation) {
  if (entry.createdAt?.toDate) {
    return entry.createdAt.toDate().toLocaleDateString();
  }
  if (entry.createdAtIso) {
    const parsed = Date.parse(entry.createdAtIso);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toLocaleDateString();
    }
  }
  return "Recently";
}

function daysUntil(value: { toDate?: () => Date } | null | undefined): number | null {
  const dueMs = asMs(value);
  if (!dueMs) return null;
  const delta = dueMs - Date.now();
  return Math.ceil(delta / (1000 * 60 * 60 * 24));
}

function recommendationTimeMs(entry: LibraryRecommendation): number {
  if (entry.createdAt?.toDate) {
    return entry.createdAt.toDate().getTime();
  }
  if (entry.createdAtIso) {
    const parsed = Date.parse(entry.createdAtIso);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeTagToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseRecommendationContextInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n;]+/g)
        .map((entry) => normalizeTagToken(entry))
        .filter(Boolean)
    )
  ).slice(0, 8);
}

function normalizeTagSubmissionLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .replace(/[^a-z0-9+\-/&.\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n;]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function buildRecommendationContextTags(args: {
  techniques: string[];
  studioRelevance: string[];
  intentContext: string;
}): string[] {
  const tags = [
    ...args.techniques.map((value) => `technique:${value}`),
    ...args.studioRelevance.map((value) => `studio:${value}`),
  ];
  const intentToken = normalizeTagToken(args.intentContext);
  if (intentToken) {
    tags.push(`intent:${intentToken}`);
  }
  return Array.from(new Set(tags)).slice(0, 20);
}

function recommendationBelongsToViewer(entry: LibraryRecommendation, viewerUid: string): boolean {
  return entry.isMine === true || entry.recommenderUid === viewerUid || entry.recommendedByUid === viewerUid;
}

function recommendationVisibleForViewer(entry: LibraryRecommendation, viewerUid: string, isStaff: boolean): boolean {
  if (isStaff) return true;
  if (entry.moderationStatus === "approved") return true;
  if (!recommendationBelongsToViewer(entry, viewerUid)) return false;
  return entry.moderationStatus === "pending_review" || entry.moderationStatus === "rejected";
}

function recommendationModerationLabel(status: string): string {
  if (status === "pending_review") return "Pending review";
  if (status === "rejected") return "Needs staff revision";
  if (status === "hidden") return "Hidden";
  if (status === "approved") return "Approved";
  return capitalizeWords(status || "pending_review");
}

function normalizeExternalLookupProviders(value: unknown): LibraryExternalLookupSource[] {
  if (!Array.isArray(value)) return [];
  const out: LibraryExternalLookupSource[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const provider = safeString(row.provider);
    if (!provider) continue;
    out.push({
      provider,
      ok: safeBoolean(row.ok),
      itemCount: typeof row.itemCount === "number" && Number.isFinite(row.itemCount) ? Math.max(0, Math.round(row.itemCount)) : 0,
      cached: safeBoolean(row.cached),
      disabled: safeBoolean(row.disabled),
    });
  }
  return out;
}

function externalProviderLabel(provider: string): string {
  if (provider === "openlibrary") return "Open Library";
  if (provider === "googlebooks") return "Google Books";
  return capitalizeWords(provider);
}

function buildExternalLookupDiagnostics(
  degraded: boolean,
  policyLimited: boolean,
  providers: LibraryExternalLookupSource[]
): string {
  if (!degraded && !policyLimited && providers.length === 0) return "";
  const policyDisabledProviders = providers
    .filter((provider) => provider.disabled === true)
    .map((provider) => externalProviderLabel(provider.provider));
  if (policyDisabledProviders.length > 0) {
    return `Provider diagnostics: ${policyDisabledProviders.join(", ")} paused by staff policy.`;
  }
  const unavailableProviders = providers.filter((provider) => !provider.ok).map((provider) => externalProviderLabel(provider.provider));
  if (unavailableProviders.length > 0) {
    return `Provider diagnostics: ${unavailableProviders.join(", ")} unavailable. Results may be partial.`;
  }
  if (policyLimited) {
    return "Provider diagnostics: partner lookup is currently policy-limited by staff controls.";
  }
  if (degraded) {
    return "Provider diagnostics: partner lookup is degraded. Results may be partial.";
  }
  if (providers.length > 0 && providers.every((provider) => provider.cached)) {
    return "Provider diagnostics: showing cached partner responses.";
  }
  return "";
}

function trackLending(eventName: string, props: AnalyticsProps) {
  track(eventName, props);

  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem("mf_lending_telemetry");
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const rows: Array<Record<string, unknown>> = Array.isArray(parsed)
      ? parsed.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
      : [];
    const entry = {
      event: eventName,
      atIso: new Date().toISOString(),
      props,
    };
    const next = [...rows.slice(-199), entry];
    window.localStorage.setItem("mf_lending_telemetry", JSON.stringify(next));
  } catch {
    // Local telemetry is best-effort only.
  }
}

function readLendingHandoffPayload(): LendingHandoffPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LENDING_HANDOFF_STORAGE_SLOT);
    if (!raw) return null;
    window.localStorage.removeItem(LENDING_HANDOFF_STORAGE_SLOT);
    const parsed = JSON.parse(raw) as LendingHandoffPayload;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function safeString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function safeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeLibraryRolloutPhase(
  value: unknown,
  fallback: LibraryRolloutPhase = "phase_3_admin_full"
): LibraryRolloutPhase {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "phase_1_read_only" || normalized === "1" || normalized === "phase1") {
      return "phase_1_read_only";
    }
    if (normalized === "phase_2_member_writes" || normalized === "2" || normalized === "phase2") {
      return "phase_2_member_writes";
    }
    if (normalized === "phase_3_admin_full" || normalized === "3" || normalized === "phase3") {
      return "phase_3_admin_full";
    }
  }
  return fallback;
}

function libraryRolloutPhaseLabel(phase: LibraryRolloutPhase): string {
  if (phase === "phase_1_read_only") return "Phase 1";
  if (phase === "phase_2_member_writes") return "Phase 2";
  return "Phase 3";
}

function libraryRolloutMemberWritesEnabledForPhase(phase: LibraryRolloutPhase): boolean {
  return phase !== "phase_1_read_only";
}

function shouldBlockWriteFallback(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as {
    kind?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
    debugMessage?: unknown;
  };
  const kind = safeString(row.kind)?.toLowerCase() ?? "";
  const statusCode =
    typeof row.statusCode === "number" && Number.isFinite(row.statusCode) ? Math.trunc(row.statusCode) : 0;
  const code = safeString(row.code)?.toLowerCase() ?? "";
  const message = `${safeString(row.message) ?? ""} ${safeString(row.debugMessage) ?? ""}`.toLowerCase();

  if (kind === "auth") return true;
  if (statusCode === 401 || statusCode === 403) return true;
  if (code === "unauthenticated" || code === "permission_denied" || code === "forbidden" || code === "unauthorized") {
    return true;
  }
  if (
    code.includes("phase") ||
    code.includes("rollout") ||
    code.includes("phase_lock") ||
    code.includes("member_writes_disabled") ||
    code.includes("writes_disabled")
  ) {
    return true;
  }
  if (
    message.includes("phase lock") ||
    message.includes("phase-lock") ||
    message.includes("phase locked") ||
    message.includes("member writes are disabled") ||
    message.includes("member writes disabled")
  ) {
    return true;
  }
  if (message.includes("rollout") && (message.includes("phase") || message.includes("disabled") || message.includes("paused"))) {
    return true;
  }

  return false;
}

function resolvePublicLibraryUrl(result: LibraryExternalLookupResult) {
  if (result.publicLibraryUrl) return result.publicLibraryUrl;
  const query = [result.title, result.author, result.isbn13 ?? result.isbn10].filter(Boolean).join(" ");
  return buildPublicLibrarySearchUrl(query);
}

function normalizeRecommendationRow(raw: Record<string, unknown>, fallbackId: string): LibraryRecommendation {
  const id = safeString(raw.id) ?? safeString(raw.recommendationId) ?? fallbackId;
  const helpfulCount = typeof raw.helpfulCount === "number" && Number.isFinite(raw.helpfulCount) ? raw.helpfulCount : 0;
  const feedbackCount = typeof raw.feedbackCount === "number" && Number.isFinite(raw.feedbackCount) ? raw.feedbackCount : 0;
  const viewerFeedbackRaw = safeString(raw.viewerFeedback) ?? safeString(raw.myFeedback);
  const viewerFeedback: LibraryRecommendationFeedbackKind | null =
    viewerFeedbackRaw === "helpful" || viewerFeedbackRaw === "not_helpful" ? viewerFeedbackRaw : null;

  return normalizeLibraryRecommendation(id, {
    id,
    itemId: safeString(raw.itemId),
    title: safeString(raw.title) ?? safeString(raw.itemTitle) ?? "",
    author: safeString(raw.author) ?? "",
    rationale: safeString(raw.rationale) ?? safeString(raw.reason) ?? safeString(raw.note) ?? "",
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    isbn: safeString(raw.isbn),
    linkUrl: safeString(raw.linkUrl) ?? safeString(raw.externalUrl),
    coverUrl: safeString(raw.coverUrl),
    sourceLabel: safeString(raw.sourceLabel),
    sourceUrl: safeString(raw.sourceUrl),
    techniques: readStringArray(raw.techniques),
    studioRelevance: readStringArray(raw.studioRelevance),
    intentContext: safeString(raw.intentContext),
    moderationStatus: safeString(raw.moderationStatus) ?? "pending_review",
    recommenderUid: safeString(raw.recommenderUid) ?? safeString(raw.recommendedByUid),
    recommenderName: safeString(raw.recommenderName) ?? safeString(raw.recommendedByName),
    isMine: raw.isMine === true,
    helpfulCount,
    feedbackCount,
    viewerFeedback,
    createdAt: (raw.createdAt as { toDate?: () => Date } | null) ?? null,
    createdAtIso: safeString(raw.createdAtIso),
    updatedAtIso: safeString(raw.updatedAtIso),
  });
}

function summarizeQueueContext(item: LibraryItem, request: LibraryRequest | undefined) {
  const queuePosition = typeof request?.queuePosition === "number" ? request.queuePosition : null;
  const queueDepth =
    typeof request?.queueDepth === "number"
      ? request.queueDepth
      : typeof item.lifecycle?.queueDepth === "number"
        ? item.lifecycle.queueDepth
        : typeof item.lifecycle?.waitlistCount === "number"
          ? item.lifecycle.waitlistCount
          : null;

  if (queuePosition && queueDepth && queueDepth >= queuePosition) {
    return `Queue ${queuePosition} of ${queueDepth}`;
  }
  if (queuePosition) {
    return `Queue position ${queuePosition}`;
  }
  if (queueDepth && queueDepth > 0) {
    return `${queueDepth} members currently waiting`;
  }
  if (request?.type === "waitlist") {
    return "You are on the waitlist. Staff will notify you when inventory opens.";
  }
  if ((item.availableCopies ?? 0) === 0) {
    return "Currently checked out. Join waitlist to hold your place.";
  }
  return "Copies are currently available.";
}

function summarizeEtaContext(item: LibraryItem, request: LibraryRequest | undefined) {
  if (request?.etaLabel) return request.etaLabel;

  if (typeof item.lifecycle?.etaDays === "number" && item.lifecycle.etaDays > 0) {
    return `Estimated availability in ~${item.lifecycle.etaDays} day${item.lifecycle.etaDays === 1 ? "" : "s"}.`;
  }

  if (item.lifecycle?.nextAvailableIso) {
    const parsed = Date.parse(item.lifecycle.nextAvailableIso);
    if (Number.isFinite(parsed)) {
      return `Likely available around ${new Date(parsed).toLocaleDateString()}.`;
    }
  }

  return "No ETA posted yet.";
}

export default function LendingLibraryView({ user, adminToken, isStaff }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState("");
  const [itemsSource, setItemsSource] = useState<"api_v1" | "firestore">("api_v1");
  const [itemsTotal, setItemsTotal] = useState<number>(0);

  const [discoveryRails, setDiscoveryRails] = useState<DiscoveryRail[]>(() => createEmptyDiscoveryRails());
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [discoveryError, setDiscoveryError] = useState("");

  const [requests, setRequests] = useState<LibraryRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState("");

  const [loans, setLoans] = useState<LibraryLoan[]>([]);
  const [loansLoading, setLoansLoading] = useState(true);
  const [loansError, setLoansError] = useState("");

  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState("");

  const [search, setSearch] = useState("");
  const [catalogFilters, setCatalogFilters] = useState<CatalogFilters>(DEFAULT_CATALOG_FILTERS);
  const [filtersPanelOpen, setFiltersPanelOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState("");

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItemDetail, setSelectedItemDetail] = useState<LibraryItem | null>(null);
  const [selectedItemDetailLoading, setSelectedItemDetailLoading] = useState(false);
  const [selectedItemDetailError, setSelectedItemDetailError] = useState("");

  const [notifyPrefs, setNotifyPrefs] = useState<Record<string, boolean>>({});
  const [notifyBusyById, setNotifyBusyById] = useState<Record<string, boolean>>({});

  const [reviewItemId, setReviewItemId] = useState<string | null>(null);
  const [reviewPracticality, setReviewPracticality] = useState(4);
  const [reviewDifficulty, setReviewDifficulty] = useState<LibraryDifficulty>("all-levels");
  const [reviewBestFor, setReviewBestFor] = useState("quick-reference");
  const [reviewReflection, setReviewReflection] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewStatus, setReviewStatus] = useState("");
  const [tagSubmissionDraftByItem, setTagSubmissionDraftByItem] = useState<Record<string, string>>({});
  const [tagSubmissionBusyByItem, setTagSubmissionBusyByItem] = useState<Record<string, boolean>>({});
  const [tagSubmissionStatus, setTagSubmissionStatus] = useState("");
  const [readingStatusByItem, setReadingStatusByItem] = useState<Record<string, ReadingStatusValue>>({});
  const [readingStatusBusyByItem, setReadingStatusBusyByItem] = useState<Record<string, boolean>>({});
  const [readingStatusMessage, setReadingStatusMessage] = useState("");

  const [workshopTechnique, setWorkshopTechnique] = useState("");
  const [workshopLevel, setWorkshopLevel] = useState<WorkshopRequestLevel>("all-levels");
  const [workshopSchedule, setWorkshopSchedule] = useState<WorkshopRequestSchedule>("weekday-evening");
  const [workshopNote, setWorkshopNote] = useState("");
  const [workshopBusy, setWorkshopBusy] = useState(false);
  const [workshopStatus, setWorkshopStatus] = useState("");

  const [donationIsbn, setDonationIsbn] = useState("");
  const [donationTitle, setDonationTitle] = useState("");
  const [donationAuthor, setDonationAuthor] = useState("");
  const [donationFormat, setDonationFormat] = useState("");
  const [donationNotes, setDonationNotes] = useState("");
  const [donationBusy, setDonationBusy] = useState(false);
  const [donationStatus, setDonationStatus] = useState("");

  const [externalLookupResults, setExternalLookupResults] = useState<LibraryExternalLookupResult[]>([]);
  const [externalLookupBusy, setExternalLookupBusy] = useState(false);
  const [externalLookupStatus, setExternalLookupStatus] = useState("");
  const [externalLookupDiagnostics, setExternalLookupDiagnostics] = useState("");
  const [externalLookupQuery, setExternalLookupQuery] = useState("");

  const [recommendations, setRecommendations] = useState<LibraryRecommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);
  const [recommendationsError, setRecommendationsError] = useState("");
  const [recommendationDraft, setRecommendationDraft] = useState<RecommendationComposerDraft>({
    title: "",
    author: "",
    reason: "",
    isbn: "",
    techniques: "",
    studioRelevance: "",
    intentContext: "",
    linkUrl: "",
    coverUrl: "",
    sourceLabel: "",
    sourceUrl: "",
  });
  const [recommendationBusy, setRecommendationBusy] = useState(false);
  const [recommendationStatus, setRecommendationStatus] = useState("");
  const [recommendationFeedbackBusyById, setRecommendationFeedbackBusyById] = useState<Record<string, boolean>>({});
  const [recommendationFeedbackCommentById, setRecommendationFeedbackCommentById] = useState<Record<string, string>>({});
  const [recommendationFeedbackStatus, setRecommendationFeedbackStatus] = useState("");
  const [libraryRolloutPhase, setLibraryRolloutPhase] = useState<LibraryRolloutPhase>("phase_3_admin_full");
  const [libraryRolloutMemberWritesEnabled, setLibraryRolloutMemberWritesEnabled] = useState(true);
  const [libraryRolloutNote, setLibraryRolloutNote] = useState("");

  const itemsAbortRef = useRef<AbortController | null>(null);
  const itemsRequestSeqRef = useRef(0);
  const discoveryAbortRef = useRef<AbortController | null>(null);
  const discoveryRequestSeqRef = useRef(0);
  const detailAbortRef = useRef<AbortController | null>(null);
  const detailRequestSeqRef = useRef(0);
  const externalLookupAbortRef = useRef<AbortController | null>(null);
  const hydratedUrlStateRef = useRef(false);

  const baseUrl = useMemo(() => resolveFunctionsBaseUrl(), []);
  const debouncedSearch = useDebouncedValue(search.trim(), CATALOG_SEARCH_DEBOUNCE_MS);

  const portalApi = useMemo(() => createPortalApi({ baseUrl }), [baseUrl]);

  const client = useMemo(() => {
    return createFunctionsClient({
      baseUrl,
      getIdToken: async () => await user.getIdToken(),
      getAdminToken: () => adminToken,
    });
  }, [adminToken, baseUrl, user]);

  useEffect(() => {
    let isActive = true;

    const loadRolloutConfig = async () => {
      try {
        const idToken = await user.getIdToken();
        const payload: LibraryRolloutConfigGetRequest = {};
        const response = await portalApi.getLibraryRolloutConfig({
          idToken,
          adminToken,
          payload,
        });
        if (!isActive) return;
        const responsePayload =
          response.data?.data && typeof response.data.data === "object" ? response.data.data : {};
        const phase = normalizeLibraryRolloutPhase(responsePayload?.phase, "phase_3_admin_full");
        const memberWritesEnabled =
          typeof responsePayload?.memberWritesEnabled === "boolean"
            ? responsePayload.memberWritesEnabled
            : libraryRolloutMemberWritesEnabledForPhase(phase);

        setLibraryRolloutPhase(phase);
        setLibraryRolloutMemberWritesEnabled(memberWritesEnabled);
        setLibraryRolloutNote(safeString(responsePayload?.note) ?? "");
      } catch {
        // Keep member interactions available when rollout config is unavailable.
        if (!isActive) return;
        setLibraryRolloutPhase("phase_3_admin_full");
        setLibraryRolloutMemberWritesEnabled(true);
        setLibraryRolloutNote("");
      }
    };

    void loadRolloutConfig();
    return () => {
      isActive = false;
    };
  }, [adminToken, portalApi, user]);

  const loadLibraryItemsFromFirestore = useCallback(async (): Promise<LibraryItem[]> => {
    const itemsQuery = query(collection(db, "libraryItems"), orderBy("title", "asc"), limit(1200));
    const snap = await getDocs(itemsQuery);
    return snap.docs.map((docSnap) => normalizeLibraryItem(docSnap.id, docSnap.data() as Partial<LibraryItem>));
  }, []);

  const reloadItems = useCallback(async () => {
    const requestSeq = itemsRequestSeqRef.current + 1;
    itemsRequestSeqRef.current = requestSeq;
    itemsAbortRef.current?.abort();
    const abortController = new AbortController();
    itemsAbortRef.current = abortController;

    setItemsLoading(true);
    setItemsError("");

    const ratingMin = catalogFilters.ratingMin;
    const ratingMax = catalogFilters.ratingMax;
    const normalizedRatingMin =
      typeof ratingMin === "number" && typeof ratingMax === "number" && ratingMin > ratingMax
        ? ratingMax
        : ratingMin;
    const normalizedRatingMax =
      typeof ratingMin === "number" && typeof ratingMax === "number" && ratingMin > ratingMax
        ? ratingMin
        : ratingMax;
    const studioCategories = normalizeFilterTokens(catalogFilters.studioCategoryInput);
    const mediaTypes = catalogFilters.mediaTypes.map((entry) => entry.trim().toLowerCase()).filter(Boolean);

    try {
      let source: "api_v1" | "firestore" = "api_v1";
      let rows: LibraryItem[] = [];
      let total = 0;

      try {
        const idToken = await user.getIdToken();
        const response = await portalApi.listLibraryItems({
          idToken,
          adminToken,
          payload: {
            q: debouncedSearch || undefined,
            mediaType: mediaTypes.length > 0 ? mediaTypes : undefined,
            genre: catalogFilters.genre.trim() || undefined,
            studioCategory: studioCategories.length > 0 ? studioCategories : undefined,
            availability: catalogFilters.availability === "all" ? undefined : catalogFilters.availability,
            ratingMin: normalizedRatingMin ?? undefined,
            ratingMax: normalizedRatingMax ?? undefined,
            sort: catalogFilters.sort,
            page: 1,
            pageSize: 120,
          },
          signal: abortController.signal,
        });
        const payload =
          response.data?.data && typeof response.data.data === "object"
            ? response.data.data
            : response.data;
        const rawItems = Array.isArray(payload?.items) ? payload.items : [];
        rows = rawItems
          .map((row) => {
            const itemId = safeString(row?.id);
            if (!itemId) return null;
            return normalizeLibraryItem(itemId, row as Partial<LibraryItem>);
          })
          .filter((entry): entry is LibraryItem => Boolean(entry));
        total =
          typeof payload?.total === "number" && Number.isFinite(payload.total)
            ? Math.max(0, Math.round(payload.total))
            : rows.length;
      } catch (error: unknown) {
        if (isAbortError(error)) return;
        source = "firestore";
        rows = await loadLibraryItemsFromFirestore();
        total = rows.length;
      }

      if (abortController.signal.aborted || requestSeq !== itemsRequestSeqRef.current) return;
      setItems(rows);
      setItemsSource(source);
      setItemsTotal(total);
      setSelectedItemId((prev) => {
        if (prev && rows.some((entry) => entry.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
      trackLending("lending_items_loaded", {
        section: "catalog",
        count: rows.length,
        source,
        userRole: isStaff ? "staff" : "member",
        hasSearch: Boolean(debouncedSearch),
        sort: catalogFilters.sort,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      setItemsError(`Library items failed: ${getErrorMessage(error)}`);
      setItemsSource("firestore");
    } finally {
      if (requestSeq === itemsRequestSeqRef.current) {
        setItemsLoading(false);
      }
      if (itemsAbortRef.current === abortController) {
        itemsAbortRef.current = null;
      }
    }
  }, [adminToken, catalogFilters, debouncedSearch, isStaff, loadLibraryItemsFromFirestore, portalApi, user]);

  useEffect(() => {
    void reloadItems();
  }, [reloadItems]);

  const buildDiscoveryRailsFromRows = useCallback((rows: LibraryItem[], limit: number): DiscoveryRail[] => {
    const byTitle = (a: LibraryItem, b: LibraryItem) => normalizeLibraryToken(a.title).localeCompare(normalizeLibraryToken(b.title));
    const staffPicks = rows
      .filter((entry) => entry.curation?.staffPick === true)
      .sort((a, b) => {
        const rankA = typeof a.curation?.shelfRank === "number" ? a.curation.shelfRank : Number.POSITIVE_INFINITY;
        const rankB = typeof b.curation?.shelfRank === "number" ? b.curation.shelfRank : Number.POSITIVE_INFINITY;
        if (rankA !== rankB) return rankA - rankB;
        return byTitle(a, b);
      })
      .slice(0, limit);
    const mostBorrowed = [...rows]
      .sort((a, b) => {
        const delta = (b.borrowCount ?? 0) - (a.borrowCount ?? 0);
        if (delta !== 0) return delta;
        return byTitle(a, b);
      })
      .slice(0, limit);
    const recentlyAdded = [...rows]
      .sort((a, b) => {
        const delta = asMs(b.createdAt) - asMs(a.createdAt);
        if (delta !== 0) return delta;
        return byTitle(a, b);
      })
      .slice(0, limit);
    const recentlyReviewed = [...rows]
      .sort((a, b) => {
        const delta = itemLastReviewedMs(b) - itemLastReviewedMs(a);
        if (delta !== 0) return delta;
        return byTitle(a, b);
      })
      .slice(0, limit);
    const byKey: Record<DiscoverySectionKey, LibraryItem[]> = {
      staff_picks: staffPicks,
      most_borrowed: mostBorrowed,
      recently_added: recentlyAdded,
      recently_reviewed: recentlyReviewed,
    };
    return DISCOVERY_RAIL_CONFIG.map((rail) => ({ ...rail, items: byKey[rail.key] ?? [] }));
  }, []);

  const reloadDiscovery = useCallback(async () => {
    const requestSeq = discoveryRequestSeqRef.current + 1;
    discoveryRequestSeqRef.current = requestSeq;
    discoveryAbortRef.current?.abort();
    const abortController = new AbortController();
    discoveryAbortRef.current = abortController;

    setDiscoveryLoading(true);
    setDiscoveryError("");
    try {
      const limit = 8;
      let rails = createEmptyDiscoveryRails();
      let source: "api_v1" | "firestore" = "api_v1";
      try {
        const idToken = await user.getIdToken();
        const response = await portalApi.getLibraryDiscovery({
          idToken,
          adminToken,
          payload: { limit },
          signal: abortController.signal,
        });
        const payload =
          response.data?.data && typeof response.data.data === "object"
            ? response.data.data
            : response.data;
        const staffPicks = readDiscoverySectionRows(payload?.staffPicks).map((row, index) =>
          normalizeLibraryItem(safeString(row.id) ?? `staff-pick-${index + 1}`, row as Partial<LibraryItem>)
        );
        const mostBorrowed = readDiscoverySectionRows(payload?.mostBorrowed).map((row, index) =>
          normalizeLibraryItem(safeString(row.id) ?? `most-borrowed-${index + 1}`, row as Partial<LibraryItem>)
        );
        const recentlyAdded = readDiscoverySectionRows(payload?.recentlyAdded).map((row, index) =>
          normalizeLibraryItem(safeString(row.id) ?? `recently-added-${index + 1}`, row as Partial<LibraryItem>)
        );
        const recentlyReviewed = readDiscoverySectionRows(payload?.recentlyReviewed).map((row, index) =>
          normalizeLibraryItem(safeString(row.id) ?? `recently-reviewed-${index + 1}`, row as Partial<LibraryItem>)
        );
        const byKey: Record<DiscoverySectionKey, LibraryItem[]> = {
          staff_picks: staffPicks,
          most_borrowed: mostBorrowed,
          recently_added: recentlyAdded,
          recently_reviewed: recentlyReviewed,
        };
        rails = DISCOVERY_RAIL_CONFIG.map((rail) => ({ ...rail, items: byKey[rail.key] ?? [] }));
      } catch (error: unknown) {
        if (isAbortError(error)) return;
        source = "firestore";
        const fallbackRows = await loadLibraryItemsFromFirestore();
        rails = buildDiscoveryRailsFromRows(fallbackRows, limit);
      }

      if (abortController.signal.aborted || requestSeq !== discoveryRequestSeqRef.current) return;
      setDiscoveryRails(rails);
      trackLending("lending_discovery_loaded", {
        section: "discovery",
        source,
        railsWithItems: rails.filter((entry) => entry.items.length > 0).length,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      setDiscoveryError(`Discovery rails unavailable: ${getErrorMessage(error)}`);
    } finally {
      if (requestSeq === discoveryRequestSeqRef.current) {
        setDiscoveryLoading(false);
      }
      if (discoveryAbortRef.current === abortController) {
        discoveryAbortRef.current = null;
      }
    }
  }, [adminToken, buildDiscoveryRailsFromRows, loadLibraryItemsFromFirestore, portalApi, user]);

  useEffect(() => {
    void reloadDiscovery();
  }, [reloadDiscovery]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyLocationState = () => {
      const state = parseCatalogUrlState(window.location.search);
      setSearch(state.search);
      setCatalogFilters(state.filters);
      setSelectedItemId(state.selectedItemId);
    };

    applyLocationState();
    hydratedUrlStateRef.current = true;

    const onPopState = () => {
      applyLocationState();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hydratedUrlStateRef.current) return;

    const query = buildCatalogUrlQuery(search, catalogFilters, selectedItemId);
    const hash = window.location.hash;
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [catalogFilters, search, selectedItemId]);

  useEffect(() => {
    return () => {
      itemsAbortRef.current?.abort();
      discoveryAbortRef.current?.abort();
      detailAbortRef.current?.abort();
      externalLookupAbortRef.current?.abort();
    };
  }, []);

  const reloadRequests = useCallback(async () => {
    setRequestsLoading(true);
    setRequestsError("");
    try {
      const requestsQuery = query(
        collection(db, "libraryRequests"),
        where("requesterUid", "==", user.uid),
        limit(200)
      );
      const snap = await getDocs(requestsQuery);
      const rows: LibraryRequest[] = snap.docs.map((docSnap) =>
        normalizeLibraryRequest(docSnap.id, docSnap.data() as Partial<LibraryRequest>)
      );
      rows.sort((a, b) => asMs(b.requestedAt) - asMs(a.requestedAt));
      setRequests(rows);
    } catch (error: unknown) {
      setRequestsError(`Requests failed: ${getErrorMessage(error)}`);
    } finally {
      setRequestsLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    void reloadRequests();
  }, [reloadRequests]);

  const reloadLoans = useCallback(async () => {
    setLoansLoading(true);
    setLoansError("");
    try {
      const loadFromApiV1 = async (): Promise<LibraryLoan[] | null> => {
        const response = await client.postJson<{ data?: { loans?: Array<Record<string, unknown>> } }>(
          V1_LIBRARY_LOANS_LIST_MINE_FN,
          { limit: 50 }
        );
        const rawLoans = response?.data?.loans;
        if (!Array.isArray(rawLoans)) return null;
        return rawLoans
          .map((row) => {
            const loanId = safeString(row.id);
            if (!loanId) return null;
            return normalizeLibraryLoan(loanId, row as Partial<LibraryLoan>);
          })
          .filter((entry): entry is LibraryLoan => Boolean(entry));
      };

      const loadFromFirestore = async (): Promise<LibraryLoan[]> => {
        const loansQuery = query(
          collection(db, "libraryLoans"),
          where("borrowerUid", "==", user.uid),
          limit(50)
        );
        const snap = await getDocs(loansQuery);
        return snap.docs.map((docSnap) => normalizeLibraryLoan(docSnap.id, docSnap.data() as Partial<LibraryLoan>));
      };

      let rows = await loadFromApiV1();
      if (!rows) {
        rows = await loadFromFirestore();
      }

      rows.sort((a, b) => asMs(b.loanedAt) - asMs(a.loanedAt));
      setLoans(rows);
    } catch (error: unknown) {
      setLoansError(`Loans failed: ${getErrorMessage(error)}`);
    } finally {
      setLoansLoading(false);
    }
  }, [client, user.uid]);

  useEffect(() => {
    void reloadLoans();
  }, [reloadLoans]);

  const reloadRecommendations = useCallback(async () => {
    setRecommendationsLoading(true);
    setRecommendationsError("");
    try {
      let source: "api_v1" | "firestore" = "api_v1";

      const loadFromApiV1 = async (): Promise<LibraryRecommendation[] | null> => {
        const payload: LibraryRecommendationsListRequest = { limit: 120 };
        const response = await client.postJson<LibraryRecommendationsListResponse>(
          V1_LIBRARY_RECOMMENDATIONS_LIST_FN,
          payload
        );
        const apiRows = Array.isArray(response?.data?.recommendations)
          ? response.data.recommendations
          : Array.isArray((response as { recommendations?: unknown }).recommendations)
            ? ((response as { recommendations?: unknown[] }).recommendations ?? [])
            : null;
        if (!apiRows) return null;
        return apiRows
          .map((row, index) => {
            if (!row || typeof row !== "object") return null;
            return normalizeRecommendationRow(
              row as Record<string, unknown>,
              `recommendation-api-${index + 1}`
            );
          })
          .filter((entry): entry is LibraryRecommendation => Boolean(entry));
      };

      const loadFromFirestore = async (): Promise<LibraryRecommendation[]> => {
        const recommendationsQuery = query(
          collection(db, "libraryRecommendations"),
          orderBy("createdAt", "desc"),
          limit(150)
        );
        const snap = await getDocs(recommendationsQuery);
        return snap.docs.map((docSnap) =>
          normalizeRecommendationRow(
            docSnap.data() as Record<string, unknown>,
            docSnap.id
          )
        );
      };

      let rows: LibraryRecommendation[] = [];
      try {
        const apiRows = await loadFromApiV1();
        if (apiRows) {
          rows = apiRows;
        } else {
          source = "firestore";
          rows = await loadFromFirestore();
        }
      } catch {
        source = "firestore";
        rows = await loadFromFirestore();
      }

      rows.sort((a, b) => recommendationTimeMs(b) - recommendationTimeMs(a));
      const visibleRows = rows.filter((entry) => recommendationVisibleForViewer(entry, user.uid, isStaff));
      setRecommendations(visibleRows);
      trackLending("lending_recommendations_loaded", {
        section: "community_recommendations",
        source,
        count: visibleRows.length,
        totalFetched: rows.length,
      });
    } catch (error: unknown) {
      setRecommendationsError(`Recommendations failed: ${getErrorMessage(error)}`);
    } finally {
      setRecommendationsLoading(false);
    }
  }, [client, isStaff, user.uid]);

  useEffect(() => {
    void reloadRecommendations();
  }, [reloadRecommendations]);

  useEffect(() => {
    const loadReviews = async () => {
      setReviewsLoading(true);
      setReviewsError("");
      try {
        const reviewsQuery = query(collection(db, "libraryReviews"), orderBy("createdAt", "desc"), limit(800));
        const snap = await getDocs(reviewsQuery);
        const rows: ReviewEntry[] = snap.docs
          .map((docSnap) => {
            const data = docSnap.data() as Record<string, unknown>;
            const itemId = safeString(data.itemId) ?? "";
            if (!itemId) return null;
            return {
              id: docSnap.id,
              itemId,
              itemTitle: safeString(data.itemTitle) ?? "Library item",
              practicality: normalizePracticality(data.practicality),
              difficulty: normalizeDifficulty(data.difficulty),
              bestFor: safeString(data.bestFor) ?? "general-practice",
              reflection: safeString(data.reflection),
              reviewerUid: safeString(data.reviewerUid),
              createdAt: (data.createdAt as { toDate?: () => Date } | null) ?? null,
            };
          })
          .filter((entry): entry is ReviewEntry => Boolean(entry));
        setReviews(rows);
      } catch (error: unknown) {
        setReviewsError(`Reviews are currently unavailable: ${getErrorMessage(error)}`);
      } finally {
        setReviewsLoading(false);
      }
    };

    void loadReviews();
  }, []);

  useEffect(() => {
    const loadReadingStatuses = async () => {
      try {
        const statusQuery = query(
          collection(db, "libraryReadingStatus"),
          where("userId", "==", user.uid),
          limit(600)
        );
        const snap = await getDocs(statusQuery);
        const next: Record<string, ReadingStatusValue> = {};
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          const itemId = safeString(data.itemId);
          const status = normalizeReadingStatus(data.status);
          if (!itemId || !status) return;
          next[itemId] = status;
        });
        setReadingStatusByItem(next);
      } catch {
        // Keep selector usable even if status hydration fails.
      }
    };

    void loadReadingStatuses();
  }, [user.uid]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const key = `${NOTIFY_PREFS_STORAGE_KEY}:${user.uid}`;
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Record<string, boolean> = {};
      Object.entries(parsed).forEach(([itemId, enabled]) => {
        if (typeof itemId === "string" && safeBoolean(enabled)) {
          next[itemId] = true;
        }
      });
      setNotifyPrefs(next);
    } catch {
      // ignore malformed local storage
    }
  }, [user.uid]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const key = `${NOTIFY_PREFS_STORAGE_KEY}:${user.uid}`;
      window.localStorage.setItem(key, JSON.stringify(notifyPrefs));
    } catch {
      // ignore persistence failures
    }
  }, [notifyPrefs, user.uid]);

  useEffect(() => {
    const payload = readLendingHandoffPayload();
    if (!payload) return;
    const nextSearch = typeof payload.search === "string" ? payload.search.trim() : "";
    const nextTechnique = typeof payload.focusTechnique === "string" ? payload.focusTechnique.trim() : "";
    const nextAvailability =
      payload.filter === "all" ||
      payload.filter === "available" ||
      payload.filter === "checked_out" ||
      payload.filter === "overdue" ||
      payload.filter === "lost" ||
      payload.filter === "unavailable" ||
      payload.filter === "archived"
        ? payload.filter
        : null;

    if (nextSearch) {
      setSearch(nextSearch);
    }
    if (nextAvailability) {
      setCatalogFilters((prev) => ({ ...prev, availability: nextAvailability }));
    }
    if (nextTechnique) {
      setWorkshopTechnique(nextTechnique);
    }
    if (nextSearch || nextTechnique) {
      setWorkshopStatus(
        `Loaded ${nextTechnique || nextSearch} from Workshops. You can request a related workshop directly below.`
      );
    }
    trackLending("lending_handoff_applied", {
      section: "technique_workshop_bridge",
      source: payload.source || "unknown",
      hasSearch: Boolean(nextSearch),
      hasTechnique: Boolean(nextTechnique),
      hasFilter: Boolean(nextAvailability),
    });
  }, []);

  const activeLoans = useMemo(() => loans.filter((loan) => loanIsActive(loan.status)), [loans]);
  const activeLoanCount = activeLoans.length;

  const requestMap = useMemo(() => {
    const map = new Map<string, LibraryRequest>();
    requests.forEach((request) => {
      if (requestIsActive(request.status)) {
        map.set(request.itemId, request);
      }
    });
    return map;
  }, [requests]);

  const loanMap = useMemo(() => {
    const map = new Map<string, LibraryLoan>();
    activeLoans.forEach((loan) => {
      map.set(loan.itemId, loan);
    });
    return map;
  }, [activeLoans]);

  const itemMap = useMemo(() => {
    return new Map(items.map((item) => [item.id, item]));
  }, [items]);
  const discoveryItemMap = useMemo(() => {
    const map = new Map<string, LibraryItem>();
    discoveryRails.forEach((rail) => {
      rail.items.forEach((item) => map.set(item.id, item));
    });
    return map;
  }, [discoveryRails]);

  const reviewAggregateMap = useMemo(() => {
    const map = new Map<string, ReviewAggregate>();

    const fromDocSummary = (item: LibraryItem): ReviewAggregate | null => {
      const summary = item.reviewSummary;
      if (!summary) return null;
      return {
        reviewCount: summary.reviewCount ?? 0,
        averagePracticality: summary.averagePracticality ?? null,
        topDifficulty: summary.topDifficulty ?? null,
        topBestFor: summary.topBestFor ?? null,
        reflectionsCount: summary.reflectionsCount ?? 0,
        latestReflection: summary.latestReflection ?? null,
      };
    };

    items.forEach((item) => {
      const base = fromDocSummary(item);
      if (base) {
        map.set(item.id, base);
      }
    });

    const grouped = new Map<string, ReviewEntry[]>();
    reviews.forEach((entry) => {
      const bucket = grouped.get(entry.itemId);
      if (bucket) {
        bucket.push(entry);
      } else {
        grouped.set(entry.itemId, [entry]);
      }
    });

    grouped.forEach((entries, itemId) => {
      const reviewCount = entries.length;
      if (!reviewCount) return;

      const practicalityTotal = entries.reduce((sum, entry) => sum + entry.practicality, 0);

      const difficultyVotes: Record<LibraryDifficulty, number> = {
        "all-levels": 0,
        beginner: 0,
        intermediate: 0,
        advanced: 0,
      };
      entries.forEach((entry) => {
        difficultyVotes[entry.difficulty] += 1;
      });
      const topDifficulty = (Object.entries(difficultyVotes).sort((a, b) => b[1] - a[1])[0]?.[0] ??
        "all-levels") as LibraryDifficulty;

      const bestForVotes = new Map<string, number>();
      entries.forEach((entry) => {
        bestForVotes.set(entry.bestFor, (bestForVotes.get(entry.bestFor) ?? 0) + 1);
      });
      const topBestFor = [...bestForVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      const reflections = entries.filter((entry) => Boolean(entry.reflection));
      const latestReflection =
        reflections.sort((a, b) => asMs(b.createdAt) - asMs(a.createdAt))[0]?.reflection ?? null;

      map.set(itemId, {
        reviewCount,
        averagePracticality: practicalityTotal / reviewCount,
        topDifficulty,
        topBestFor,
        reflectionsCount: reflections.length,
        latestReflection,
      });
    });

    return map;
  }, [items, reviews]);

  const filteredItems = useMemo(() => {
    if (itemsSource === "api_v1") return items;

    const searchTerm = debouncedSearch.toLowerCase();
    const genreToken = normalizeLibraryToken(catalogFilters.genre);
    const studioCategories = new Set(normalizeFilterTokens(catalogFilters.studioCategoryInput));
    const mediaTypes = new Set(catalogFilters.mediaTypes.map((entry) => normalizeLibraryToken(entry)).filter(Boolean));
    const availability = catalogFilters.availability;
    const ratingMin = catalogFilters.ratingMin;
    const ratingMax = catalogFilters.ratingMax;

    const rows = items.filter((item) => {
      if (mediaTypes.size > 0 && !mediaTypes.has(normalizeLibraryToken(item.mediaType))) return false;
      if (genreToken) {
        const itemGenre = normalizeLibraryToken(item.genre || item.primaryGenre);
        if (itemGenre !== genreToken) return false;
      }
      if (studioCategories.size > 0 && !studioCategories.has(normalizeLibraryToken(item.studioCategory))) {
        return false;
      }
      if (availability !== "all" && normalizeLibraryToken(item.status) !== availability) {
        return false;
      }
      const rating = itemRating(item);
      if (typeof ratingMin === "number" && (rating === null || rating < ratingMin)) return false;
      if (typeof ratingMax === "number" && (rating === null || rating > ratingMax)) return false;
      if (!searchTerm) return true;
      const haystack = [
        item.title,
        item.subtitle,
        ...(item.authors ?? []),
        ...(item.subjects ?? []),
        ...(item.techniques ?? []),
        item.identifiers?.isbn10,
        item.identifiers?.isbn13,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(searchTerm);
    });

    rows.sort((a, b) => {
      const titleDelta = normalizeLibraryToken(a.title).localeCompare(normalizeLibraryToken(b.title));
      if (catalogFilters.sort === "staff_picks") {
        const staffDelta = Number(b.curation?.staffPick === true) - Number(a.curation?.staffPick === true);
        if (staffDelta !== 0) return staffDelta;
        const rankA = typeof a.curation?.shelfRank === "number" ? a.curation.shelfRank : Number.POSITIVE_INFINITY;
        const rankB = typeof b.curation?.shelfRank === "number" ? b.curation.shelfRank : Number.POSITIVE_INFINITY;
        if (rankA !== rankB) return rankA - rankB;
        return titleDelta;
      }
      if (catalogFilters.sort === "highest_rated") {
        const ratingDelta = (itemRating(b) ?? 0) - (itemRating(a) ?? 0);
        if (ratingDelta !== 0) return ratingDelta;
        const countDelta = (b.aggregateRatingCount ?? 0) - (a.aggregateRatingCount ?? 0);
        if (countDelta !== 0) return countDelta;
        return titleDelta;
      }
      if (catalogFilters.sort === "most_borrowed") {
        const borrowDelta = (b.borrowCount ?? 0) - (a.borrowCount ?? 0);
        if (borrowDelta !== 0) return borrowDelta;
        return titleDelta;
      }
      if (catalogFilters.sort === "recently_reviewed") {
        const reviewedDelta = itemLastReviewedMs(b) - itemLastReviewedMs(a);
        if (reviewedDelta !== 0) return reviewedDelta;
        return titleDelta;
      }
      const createdDelta = asMs(b.createdAt) - asMs(a.createdAt);
      if (createdDelta !== 0) return createdDelta;
      return titleDelta;
    });
    return rows;
  }, [catalogFilters, debouncedSearch, items, itemsSource]);
  const activeFilterCount = useMemo(
    () => countActiveCatalogFilters(catalogFilters, search),
    [catalogFilters, search],
  );

  const searchTerm = search.trim();
  const hasExternalResultsForSearch = externalLookupQuery === searchTerm && externalLookupResults.length > 0;
  const shouldShowExternalFallbackPanel =
    searchTerm.length >= 3 &&
    !itemsLoading &&
    (filteredItems.length <= 2 || hasExternalResultsForSearch);
  const localSearchResultState: "empty" | "weak" | "healthy" =
    filteredItems.length === 0 ? "empty" : filteredItems.length <= 2 ? "weak" : "healthy";
  const publicLibrarySearchUrl = useMemo(() => buildPublicLibrarySearchUrl(searchTerm), [searchTerm]);

  const rails = discoveryRails;
  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    if (selectedItemDetail?.id === selectedItemId) return selectedItemDetail;
    return itemMap.get(selectedItemId) ?? discoveryItemMap.get(selectedItemId) ?? null;
  }, [discoveryItemMap, itemMap, selectedItemDetail, selectedItemId]);

  useEffect(() => {
    if (!selectedItemId) {
      setSelectedItemDetail(null);
      setSelectedItemDetailError("");
      return;
    }
    const requestSeq = detailRequestSeqRef.current + 1;
    detailRequestSeqRef.current = requestSeq;
    detailAbortRef.current?.abort();
    const abortController = new AbortController();
    detailAbortRef.current = abortController;

    const loadDetail = async () => {
      setSelectedItemDetailLoading(true);
      setSelectedItemDetailError("");
      try {
        const idToken = await user.getIdToken();
        const response = await portalApi.getLibraryItem({
          idToken,
          adminToken,
          payload: { itemId: selectedItemId },
          signal: abortController.signal,
        });
        const payload =
          response.data?.data && typeof response.data.data === "object"
            ? response.data.data
            : response.data;
        const rawItem =
          payload?.item && typeof payload.item === "object"
            ? (payload.item as Record<string, unknown>)
            : null;
        if (!rawItem) {
          throw new Error("Item detail payload missing.");
        }
        const resolvedId = safeString(rawItem.id) ?? selectedItemId;
        const detailRow = normalizeLibraryItem(resolvedId, rawItem as Partial<LibraryItem>);
        if (abortController.signal.aborted || requestSeq !== detailRequestSeqRef.current) return;
        setSelectedItemDetail(detailRow);
      } catch (error: unknown) {
        if (isAbortError(error)) return;
        const fallback = itemMap.get(selectedItemId) ?? discoveryItemMap.get(selectedItemId) ?? null;
        if (requestSeq !== detailRequestSeqRef.current) return;
        setSelectedItemDetail(fallback);
        setSelectedItemDetailError(
          fallback
            ? "Live detail is unavailable right now. Showing latest known data."
            : `Item detail failed: ${getErrorMessage(error)}`
        );
      } finally {
        if (requestSeq === detailRequestSeqRef.current) {
          setSelectedItemDetailLoading(false);
        }
        if (detailAbortRef.current === abortController) {
          detailAbortRef.current = null;
        }
      }
    };

    void loadDetail();
  }, [adminToken, discoveryItemMap, itemMap, portalApi, selectedItemId, user]);

  const selectedItemReflections = useMemo(() => {
    if (!selectedItemId) return [];
    return reviews
      .filter((entry) => entry.itemId === selectedItemId && entry.reflection)
      .slice(0, 3);
  }, [reviews, selectedItemId]);

  const selectedItemMyReview = useMemo(() => {
    if (!selectedItemId) return null;
    return reviews.find((entry) => entry.itemId === selectedItemId && entry.reviewerUid === user.uid) ?? null;
  }, [reviews, selectedItemId, user.uid]);

  const canRequest = activeLoanCount < MAX_LOANS;
  const memberInteractionsPaused = !libraryRolloutMemberWritesEnabled;
  const memberInteractionsPauseNotice = `Member interactions are temporarily paused during ${libraryRolloutPhaseLabel(libraryRolloutPhase)}. You can still browse, search, and plan your next reads.`;
  const memberInteractionsPauseNote = libraryRolloutNote.trim();

  useEffect(() => {
    trackLending("lending_view_open", {
      section: "lending_library",
      userRole: isStaff ? "staff" : "member",
    });
  }, [isStaff]);

  useEffect(() => {
    rails.forEach((rail) => {
      if (rail.items.length > 0) {
        trackLending("lending_section_impression", {
          section: rail.key,
          itemCount: rail.items.length,
        });
      }
    });
  }, [rails]);

  useEffect(() => {
    if (!selectedItem) return;
    trackLending("lending_item_detail_open", {
      section: "item_detail",
      itemId: selectedItem.id,
      hasWorkshops: (selectedItem.relatedWorkshops?.length ?? 0) > 0,
    });
  }, [selectedItem]);

  const toggleMediaTypeFilter = (mediaType: string) => {
    setCatalogFilters((prev) => {
      const normalized = mediaType.trim().toLowerCase();
      const exists = prev.mediaTypes.includes(normalized);
      const mediaTypes = exists ? prev.mediaTypes.filter((entry) => entry !== normalized) : [...prev.mediaTypes, normalized];
      return { ...prev, mediaTypes };
    });
  };

  const clearCatalogFilters = () => {
    setCatalogFilters(DEFAULT_CATALOG_FILTERS);
    setFiltersPanelOpen(false);
  };

  const resetCatalogSearchAndFilters = () => {
    setSearch("");
    clearCatalogFilters();
  };

  const handleRequest = async (item: LibraryItem, type: "reserve" | "waitlist" | "return") => {
    if (memberInteractionsPaused) {
      setActionStatus(memberInteractionsPauseNotice);
      return;
    }
    if (actionBusy) return;
    if (type !== "return" && !canRequest) {
      setActionStatus(`Loan limit reached (${MAX_LOANS} active loans).`);
      return;
    }

    setActionBusy(true);
    setActionStatus("");
    try {
      const submitFirestoreRequest = async (
        requestType: "reserve" | "waitlist" | "return",
        source: "firestore" | "firestore_fallback"
      ) => {
        await addDoc(collection(db, "libraryRequests"), {
          itemId: item.id,
          itemTitle: item.title,
          type: requestType,
          status: "pending_approval",
          requesterUid: user.uid,
          requesterName: user.displayName || null,
          requesterEmail: user.email || null,
          requestedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          notes: null,
        });
        setActionStatus("Request sent. Staff will confirm shortly.");
        trackLending("lending_request_submitted", {
          section: "catalog",
          type: requestType,
          itemId: item.id,
          source,
        });
        await reloadRequests();
      };

      if (type === "reserve" && (item.availableCopies ?? 0) > 0) {
        try {
          await client.postJson<{
            data?: {
              loan?: { id?: string; status?: string };
              item?: { itemId?: string; status?: string; availableCopies?: number };
            };
          }>(V1_LIBRARY_LOANS_CHECKOUT_FN, { itemId: item.id });
          setActionStatus("Checked out. This title now appears in your active loans.");
          trackLending("lending_request_submitted", {
            section: "catalog",
            type: "reserve",
            itemId: item.id,
            source: "api_v1_checkout",
          });
          await Promise.all([reloadItems(), reloadLoans(), reloadRequests(), reloadDiscovery()]);
          return;
        } catch (error: unknown) {
          if (shouldBlockWriteFallback(error)) throw error;
          await submitFirestoreRequest("reserve", "firestore_fallback");
          return;
        }
      }

      if (type === "return") {
        const activeLoan = loanMap.get(item.id);
        if (activeLoan?.id) {
          try {
            await client.postJson<{ data?: { loan?: { id?: string; status?: string } } }>(
              V1_LIBRARY_LOANS_CHECKIN_FN,
              { loanId: activeLoan.id }
            );
            setActionStatus("Check-in recorded. Thanks for returning this title.");
            trackLending("lending_request_submitted", {
              section: "catalog",
              type: "return",
              itemId: item.id,
              loanId: activeLoan.id,
              source: "api_v1_check_in",
            });
            await Promise.all([reloadItems(), reloadLoans(), reloadRequests(), reloadDiscovery()]);
            return;
          } catch (error: unknown) {
            if (shouldBlockWriteFallback(error)) throw error;
            await submitFirestoreRequest("return", "firestore_fallback");
            return;
          }
        }
      }

      await submitFirestoreRequest(type, "firestore");
    } catch (error: unknown) {
      setActionStatus(`Request failed: ${getErrorMessage(error)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleNotifyToggle = async (item: LibraryItem) => {
    if (notifyBusyById[item.id]) return;
    const nextEnabled = !notifyPrefs[item.id];
    setNotifyBusyById((prev) => ({ ...prev, [item.id]: true }));

    try {
      const alertRef = doc(db, "libraryAvailabilityAlerts", `${user.uid}__${item.id}`);
      if (nextEnabled) {
        await setDoc(
          alertRef,
          {
            itemId: item.id,
            itemTitle: item.title,
            uid: user.uid,
            displayName: user.displayName || null,
            email: user.email || null,
            source: "lending-library",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        await deleteDoc(alertRef);
      }

      setNotifyPrefs((prev) => ({
        ...prev,
        [item.id]: nextEnabled,
      }));

      trackLending("lending_notify_toggle", {
        section: "lifecycle",
        itemId: item.id,
        enabled: nextEnabled,
      });
    } catch (error: unknown) {
      setActionStatus(`Notify preference failed: ${getErrorMessage(error)}`);
    } finally {
      setNotifyBusyById((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const upsertReadingStatus = async (item: LibraryItem, status: ReadingStatusValue) => {
    if (memberInteractionsPaused) {
      setReadingStatusMessage(memberInteractionsPauseNotice);
      return;
    }
    if (readingStatusBusyByItem[item.id]) return;

    const previousStatus = readingStatusByItem[item.id];
    setReadingStatusBusyByItem((prev) => ({ ...prev, [item.id]: true }));
    setReadingStatusMessage("");
    setReadingStatusByItem((prev) => ({ ...prev, [item.id]: status }));

    try {
      let source: "api_v1" | "firestore" = "api_v1";
      try {
        await client.postJson<{ data?: { readingStatus?: { id?: string; status?: ReadingStatusValue } } }>(
          V1_LIBRARY_READING_STATUS_UPSERT_FN,
          {
            itemId: item.id,
            status,
          }
        );
      } catch (error: unknown) {
        if (shouldBlockWriteFallback(error)) throw error;
        source = "firestore";
        const fallbackPayload: Record<string, unknown> = {
          userId: user.uid,
          itemId: item.id,
          status,
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
        };
        if (!previousStatus) {
          fallbackPayload.createdAt = serverTimestamp();
        }
        await setDoc(doc(db, "libraryReadingStatus", `${user.uid}__${item.id}`), fallbackPayload, { merge: true });
      }

      setReadingStatusMessage("Reading status saved.");
      trackLending("lending_reading_status_saved", {
        section: "item_detail",
        itemId: item.id,
        status,
        source,
      });
    } catch (error: unknown) {
      setReadingStatusByItem((prev) => {
        const next = { ...prev };
        if (previousStatus) {
          next[item.id] = previousStatus;
        } else {
          delete next[item.id];
        }
        return next;
      });
      setReadingStatusMessage(`Reading status failed: ${getErrorMessage(error)}`);
    } finally {
      setReadingStatusBusyByItem((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const submitReview = async (item: LibraryItem) => {
    if (memberInteractionsPaused) {
      setReviewStatus(memberInteractionsPauseNotice);
      return;
    }
    if (reviewBusy) return;

    setReviewBusy(true);
    setReviewStatus("");

    try {
      const normalizedReflection = reviewReflection.trim() || null;
      const existingReview = reviews.find((entry) => entry.itemId === item.id && entry.reviewerUid === user.uid) ?? null;
      const canUpdateExistingReview = Boolean(existingReview && existingReview.id && !existingReview.id.startsWith("local-"));
      const reviewPayload = {
        itemId: item.id,
        practicality: reviewPracticality,
        difficulty: reviewDifficulty,
        bestFor: reviewBestFor,
        reflection: normalizedReflection,
      };
      let source: "api_v1" | "firestore" = "api_v1";
      let ratingSource: "api_v1" | "firestore_only_fallback" = "api_v1";

      try {
        if (canUpdateExistingReview && existingReview) {
          await client.postJson<{ data?: { review?: { id?: string } } }>(
            V1_LIBRARY_REVIEWS_UPDATE_FN,
            {
              reviewId: existingReview.id,
              practicality: reviewPracticality,
              difficulty: reviewDifficulty,
              bestFor: reviewBestFor,
              reflection: normalizedReflection,
            }
          );
        } else {
          await client.postJson<{ data?: { review?: { id?: string } } }>(
            V1_LIBRARY_REVIEWS_CREATE_FN,
            reviewPayload
          );
        }
      } catch (error: unknown) {
        if (shouldBlockWriteFallback(error)) throw error;
        source = "firestore";
        if (canUpdateExistingReview && existingReview) {
          await setDoc(
            doc(db, "libraryReviews", existingReview.id),
            {
              practicality: reviewPracticality,
              difficulty: reviewDifficulty,
              bestFor: reviewBestFor,
              reflection: normalizedReflection,
              updatedAt: serverTimestamp(),
              updatedByUid: user.uid,
            },
            { merge: true }
          );
        } else {
          await addDoc(collection(db, "libraryReviews"), {
            itemId: item.id,
            itemTitle: item.title,
            reviewerUid: user.uid,
            reviewerDisplayName: user.displayName || null,
            practicality: reviewPracticality,
            difficulty: reviewDifficulty,
            bestFor: reviewBestFor,
            reflection: normalizedReflection,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      try {
        await client.postJson<{ data?: { rating?: { id?: string; stars?: number } } }>(
          V1_LIBRARY_RATINGS_UPSERT_FN,
          {
            itemId: item.id,
            stars: reviewPracticality,
          }
        );
      } catch {
        ratingSource = "firestore_only_fallback";
      }

      const optimisticEntry: ReviewEntry = {
        id: existingReview?.id ?? `local-${Date.now()}`,
        itemId: item.id,
        itemTitle: item.title,
        reviewerUid: user.uid,
        practicality: reviewPracticality,
        difficulty: reviewDifficulty,
        bestFor: reviewBestFor,
        reflection: normalizedReflection,
        createdAt: existingReview?.createdAt ?? { toDate: () => new Date() },
      };
      setReviews((prev) => {
        if (canUpdateExistingReview && existingReview) {
          return prev.map((entry) => (entry.id === existingReview.id ? optimisticEntry : entry));
        }
        return [optimisticEntry, ...prev];
      });

      setReviewStatus(canUpdateExistingReview ? "Your practical review was updated." : "Thanks. Your practical review was saved.");
      setReviewReflection("");
      setReviewBestFor("quick-reference");
      setReviewDifficulty("all-levels");
      setReviewPracticality(4);
      setReviewItemId(null);

      trackLending("lending_review_submitted", {
        section: "learning_signals",
        itemId: item.id,
        mode: canUpdateExistingReview ? "update" : "create",
        source,
        ratingSource,
        rating: reviewPracticality,
        hasReflection: Boolean(normalizedReflection),
      });
    } catch (error: unknown) {
      setReviewStatus(`Review failed: ${getErrorMessage(error)}`);
    } finally {
      setReviewBusy(false);
    }
  };

  const submitTagSuggestion = async (item: LibraryItem) => {
    if (memberInteractionsPaused) {
      setTagSubmissionStatus(memberInteractionsPauseNotice);
      return;
    }
    if (tagSubmissionBusyByItem[item.id]) return;
    const rawDraft = tagSubmissionDraftByItem[item.id] ?? "";
    const tag = normalizeTagSubmissionLabel(rawDraft);
    if (!tag) {
      setTagSubmissionStatus("Add a tag before submitting.");
      return;
    }

    setTagSubmissionBusyByItem((prev) => ({ ...prev, [item.id]: true }));
    setTagSubmissionStatus("");

    try {
      let source: "api_v1" | "firestore" = "api_v1";
      const payload: LibraryTagSubmissionCreateRequest = {
        itemId: item.id,
        tag,
      };
      try {
        await client.postJson<LibraryTagSubmissionCreateResponse>(
          V1_LIBRARY_TAG_SUBMISSIONS_CREATE_FN,
          payload
        );
      } catch (error: unknown) {
        if (shouldBlockWriteFallback(error)) throw error;
        source = "firestore";
        await addDoc(collection(db, "libraryTagSubmissions"), {
          itemId: item.id,
          itemTitle: item.title,
          tag,
          normalizedTag: tag.replace(/[^a-z0-9]+/g, "-"),
          status: "pending",
          submittedByUid: user.uid,
          submittedByName: user.displayName || user.email || "Member",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      setTagSubmissionDraftByItem((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setTagSubmissionStatus(`Tag suggestion "${tag}" submitted for moderation.`);
      trackLending("lending_tag_submission_created", {
        section: "item_detail",
        itemId: item.id,
        source,
      });
    } catch (error: unknown) {
      setTagSubmissionStatus(`Tag suggestion failed: ${getErrorMessage(error)}`);
    } finally {
      setTagSubmissionBusyByItem((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const submitWorkshopRequest = async (item: LibraryItem) => {
    if (workshopBusy) return;
    const technique = workshopTechnique.trim();
    if (!technique) {
      setWorkshopStatus("Choose a technique first so staff can route your request.");
      return;
    }

    setWorkshopBusy(true);
    setWorkshopStatus("");

    try {
      await addDoc(collection(db, "supportRequests"), {
        uid: user.uid,
        subject: `Workshop request from lending: ${technique}`,
        body: [
          `Item: ${item.title}`,
          `Technique/topic: ${technique}`,
          `Skill level: ${workshopLevel}`,
          `Schedule preference: ${workshopSchedule}`,
          workshopNote.trim() ? `Notes: ${workshopNote.trim()}` : "Notes: (none)",
        ].join("\n"),
        category: "Workshops",
        status: "new",
        urgency: "non-urgent",
        channel: "portal",
        source: "lending-technique-bridge",
        createdAt: serverTimestamp(),
        displayName: user.displayName || null,
        email: user.email || null,
      });

      setWorkshopNote("");
      setWorkshopStatus("Workshop request sent. Staff will group demand by technique.");

      trackLending("lending_workshop_request_submitted", {
        section: "technique_workshop_bridge",
        itemId: item.id,
        technique,
      });
    } catch (error: unknown) {
      setWorkshopStatus(getErrorMessage(error));
    } finally {
      setWorkshopBusy(false);
    }
  };

  const requestRenewal = async (loan: LibraryLoan) => {
    if (memberInteractionsPaused) {
      setActionStatus(memberInteractionsPauseNotice);
      return;
    }
    if (actionBusy) return;

    setActionBusy(true);
    setActionStatus("");

    try {
      await addDoc(collection(db, "supportRequests"), {
        uid: user.uid,
        subject: `Lending renewal request: ${loan.itemTitle}`,
        body: [
          `Loan ID: ${loan.id}`,
          `Item: ${loan.itemTitle}`,
          `Current due date: ${formatMaybeTimestamp(loan.dueAt)}`,
          `Renewal policy note: ${loan.renewalPolicyNote ?? "(none listed)"}`,
        ].join("\n"),
        category: "Lending",
        status: "new",
        urgency: "non-urgent",
        channel: "portal",
        source: "lending-renewal",
        createdAt: serverTimestamp(),
        displayName: user.displayName || null,
        email: user.email || null,
      });

      setActionStatus("Renewal request sent. Staff will confirm eligibility and due-date updates.");

      trackLending("lending_renewal_request_submitted", {
        section: "loan_lifecycle",
        loanId: loan.id,
        itemId: loan.itemId,
      });
    } catch (error: unknown) {
      setActionStatus(`Renewal request failed: ${getErrorMessage(error)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleDonation = async () => {
    if (donationBusy) return;
    setDonationStatus("");
    setDonationBusy(true);

    const isbn = donationIsbn.trim();
    const title = donationTitle.trim();
    const author = donationAuthor.trim();
    const format = donationFormat.trim();
    const notes = donationNotes.trim();

    if (!isbn && !title) {
      setDonationStatus("Add at least an ISBN or title.");
      setDonationBusy(false);
      return;
    }

    try {
      await addDoc(collection(db, "libraryDonationRequests"), {
        isbn: isbn || null,
        title: title || null,
        author: author || null,
        format: format || null,
        notes: notes || null,
        status: "pending",
        donorUid: user.uid,
        donorName: user.displayName || null,
        donorEmail: user.email || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setDonationStatus("Thanks. We received your acquisition request.");
      setDonationIsbn("");
      setDonationTitle("");
      setDonationAuthor("");
      setDonationFormat("");
      setDonationNotes("");
      trackLending("lending_donation_submitted", {
        section: "donation",
        hasIsbn: Boolean(isbn),
        hasTitle: Boolean(title),
      });
    } catch (error: unknown) {
      setDonationStatus(`Donation request failed: ${getErrorMessage(error)}`);
    } finally {
      setDonationBusy(false);
    }
  };

  const runExternalLookup = async () => {
    if (externalLookupBusy) return;
    const queryText = search.trim();
    if (queryText.length < 3) {
      setExternalLookupStatus("Type at least 3 characters before searching external sources.");
      setExternalLookupDiagnostics("");
      return;
    }

    setExternalLookupBusy(true);
    setExternalLookupStatus("");
    setExternalLookupDiagnostics("");
    externalLookupAbortRef.current?.abort();
    const abortController = new AbortController();
    externalLookupAbortRef.current = abortController;
    try {
      const payload: LibraryExternalLookupRequest = {
        q: queryText,
        limit: 8,
      };
      const idToken = await user.getIdToken();
      const response = await portalApi.externalLookupLibrary({
        idToken,
        adminToken,
        payload,
        signal: abortController.signal,
      });
      const responsePayload =
        response.data?.data && typeof response.data.data === "object"
          ? response.data.data
          : response.data;
      const rawRows = Array.isArray(responsePayload?.items)
        ? responsePayload.items
        : [];

      const rows = rawRows
        .map((row, index) => {
          if (!row || typeof row !== "object") return null;
          return normalizeLibraryExternalLookupResult(row as Record<string, unknown>, index);
        })
        .filter((entry): entry is LibraryExternalLookupResult => Boolean(entry));
      const degraded = safeBoolean(responsePayload?.degraded);
      const providers = normalizeExternalLookupProviders(responsePayload?.providers);
      const policyLimited = safeBoolean(responsePayload?.policyLimited);

      setExternalLookupResults(rows);
      setExternalLookupQuery(queryText);
      setExternalLookupDiagnostics(buildExternalLookupDiagnostics(degraded, policyLimited, providers));
      setExternalLookupStatus(
        rows.length > 0
          ? `Found ${rows.length} external match${rows.length === 1 ? "" : "es"} from partner sources.`
          : "No external matches yet. Try author + title or ISBN."
      );
      trackLending("lending_external_lookup_completed", {
        section: "external_lookup",
        queryLength: queryText.length,
        resultCount: rows.length,
        degraded,
        policyLimited,
        unavailableProviders: providers.filter((provider) => !provider.ok).length,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      setExternalLookupStatus(`External lookup failed: ${getErrorMessage(error)}`);
      setExternalLookupDiagnostics("");
    } finally {
      if (externalLookupAbortRef.current === abortController) {
        externalLookupAbortRef.current = null;
      }
      if (!abortController.signal.aborted) {
        setExternalLookupBusy(false);
      }
    }
  };

  const prefillAcquisitionRequest = (result: LibraryExternalLookupResult) => {
    setDonationTitle(result.title);
    setDonationAuthor(result.author);
    setDonationIsbn(result.isbn13 ?? result.isbn10 ?? "");
    setDonationFormat("Book");
    setDonationNotes(
      [
        `Acquisition request prefilled from external discovery (${result.sourceLabel ?? result.source}).`,
        result.summary ? `Why this title matters: ${result.summary}` : null,
        result.sourceUrl ? `Source reference: ${result.sourceUrl}` : null,
      ]
        .filter(Boolean)
        .join(" ")
    );
    setDonationStatus(`Acquisition request prefilled for "${result.title}". Review and submit below.`);

    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        document.getElementById(ACQUISITION_REQUEST_SECTION_ID)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 40);
    }

    trackLending("lending_external_prefill_acquisition", {
      section: "external_lookup",
      source: result.source,
      hasIsbn: Boolean(result.isbn13 || result.isbn10),
    });
  };

  const submitRecommendation = async () => {
    if (memberInteractionsPaused) {
      setRecommendationStatus(memberInteractionsPauseNotice);
      return;
    }
    if (recommendationBusy) return;

    const title = recommendationDraft.title.trim();
    const author = recommendationDraft.author.trim();
    const reason = recommendationDraft.reason.trim();
    const isbn = recommendationDraft.isbn.trim();
    const linkUrl = recommendationDraft.linkUrl.trim();
    const coverUrl = recommendationDraft.coverUrl.trim();
    const sourceLabel = recommendationDraft.sourceLabel.trim();
    const sourceUrl = recommendationDraft.sourceUrl.trim();
    const techniques = parseRecommendationContextInput(recommendationDraft.techniques);
    const studioRelevance = parseRecommendationContextInput(recommendationDraft.studioRelevance);
    const intentContext = recommendationDraft.intentContext.trim();
    const tags = buildRecommendationContextTags({
      techniques,
      studioRelevance,
      intentContext,
    });
    const matchingItem = items.find((item) => item.title.trim().toLowerCase() === title.toLowerCase()) ?? null;

    if (!title || !author || !reason) {
      setRecommendationStatus("Add title, author, and why this recommendation is useful.");
      return;
    }

    setRecommendationBusy(true);
    setRecommendationStatus("");
    try {
      let source: "api_v1" | "firestore" = "api_v1";
      let createdEntry: LibraryRecommendation | null = null;

      const payload: LibraryRecommendationsCreateRequest = {
        itemId: matchingItem?.id ?? null,
        title: title || null,
        author: author || null,
        isbn: isbn || null,
        rationale: reason,
        tags,
        linkUrl: linkUrl || null,
        coverUrl: coverUrl || null,
        sourceLabel: sourceLabel || null,
        sourceUrl: sourceUrl || null,
        techniques,
        studioRelevance,
        intentContext: intentContext || null,
      };

      try {
        const response = await client.postJson<LibraryRecommendationsCreateResponse>(
          V1_LIBRARY_RECOMMENDATIONS_CREATE_FN,
          payload
        );
        const recommendationRecord = response?.data?.recommendation;
        if (recommendationRecord && typeof recommendationRecord === "object") {
          createdEntry = normalizeRecommendationRow(
            {
              itemId: matchingItem?.id ?? null,
              title,
              author,
              rationale: reason,
              tags,
              isbn: isbn || null,
              linkUrl: linkUrl || null,
              coverUrl: coverUrl || null,
              sourceLabel: sourceLabel || null,
              sourceUrl: sourceUrl || null,
              techniques,
              studioRelevance,
              intentContext: intentContext || null,
              recommenderUid: user.uid,
              recommenderName: user.displayName || user.email || "Member",
              isMine: true,
              ...(recommendationRecord as Record<string, unknown>),
            },
            `recommendation-${Date.now()}`
          );
        }
      } catch (error: unknown) {
        if (shouldBlockWriteFallback(error)) throw error;
        source = "firestore";
        const docRef = await addDoc(collection(db, "libraryRecommendations"), {
          itemId: matchingItem?.id ?? null,
          title,
          author,
          rationale: reason,
          tags,
          isbn: isbn || null,
          linkUrl: linkUrl || null,
          coverUrl: coverUrl || null,
          sourceLabel: sourceLabel || null,
          sourceUrl: sourceUrl || null,
          techniques,
          studioRelevance,
          intentContext: intentContext || null,
          moderationStatus: "pending_review",
          recommenderUid: user.uid,
          recommenderName: user.displayName || user.email || "Member",
          helpfulCount: 0,
          feedbackCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        createdEntry = normalizeLibraryRecommendation(docRef.id, {
          id: docRef.id,
          itemId: matchingItem?.id ?? null,
          title,
          author,
          rationale: reason,
          tags,
          isbn: isbn || null,
          linkUrl: linkUrl || null,
          coverUrl: coverUrl || null,
          sourceLabel: sourceLabel || null,
          sourceUrl: sourceUrl || null,
          techniques,
          studioRelevance,
          intentContext: intentContext || null,
          moderationStatus: "pending_review",
          recommenderUid: user.uid,
          recommenderName: user.displayName || user.email || "Member",
          isMine: true,
          helpfulCount: 0,
          feedbackCount: 0,
          createdAt: { toDate: () => new Date() },
        });
      }

      if (!createdEntry) {
        createdEntry = normalizeLibraryRecommendation(`recommendation-local-${Date.now()}`, {
          itemId: matchingItem?.id ?? null,
          title,
          author,
          rationale: reason,
          tags,
          isbn: isbn || null,
          linkUrl: linkUrl || null,
          coverUrl: coverUrl || null,
          sourceLabel: sourceLabel || null,
          sourceUrl: sourceUrl || null,
          techniques,
          studioRelevance,
          intentContext: intentContext || null,
          moderationStatus: "pending_review",
          recommenderUid: user.uid,
          recommenderName: user.displayName || user.email || "Member",
          isMine: true,
          helpfulCount: 0,
          feedbackCount: 0,
          createdAt: { toDate: () => new Date() },
        });
      }

      setRecommendations((prev) =>
        [createdEntry as LibraryRecommendation, ...prev].filter((entry) =>
          recommendationVisibleForViewer(entry, user.uid, isStaff)
        )
      );
      setRecommendationDraft({
        title: "",
        author: "",
        reason: "",
        isbn: "",
        techniques: "",
        studioRelevance: "",
        intentContext: "",
        linkUrl: "",
        coverUrl: "",
        sourceLabel: "",
        sourceUrl: "",
      });
      setRecommendationStatus("Recommendation shared. Thanks for helping the studio community.");
      setRecommendationFeedbackStatus("");
      trackLending("lending_recommendation_created", {
        section: "community_recommendations",
        source,
        hasIsbn: Boolean(isbn),
        linkedItem: matchingItem?.id ?? null,
        hasContextMetadata: tags.length > 0,
        hasSourceContext: Boolean(sourceLabel || sourceUrl),
      });
    } catch (error: unknown) {
      setRecommendationStatus(`Recommendation failed: ${getErrorMessage(error)}`);
    } finally {
      setRecommendationBusy(false);
    }
  };

  const submitRecommendationFeedback = async (
    recommendation: LibraryRecommendation,
    feedback: LibraryRecommendationFeedbackKind,
    commentInput?: string
  ) => {
    if (memberInteractionsPaused) {
      setRecommendationFeedbackStatus(memberInteractionsPauseNotice);
      return;
    }
    if (recommendationFeedbackBusyById[recommendation.id]) return;
    const comment = (commentInput ?? recommendationFeedbackCommentById[recommendation.id] ?? "").trim();
    const previousFeedback = recommendation.viewerFeedback ?? null;
    const previousHelpful = recommendation.helpfulCount;
    const previousNotHelpful = recommendation.notHelpfulCount;

    setRecommendationFeedbackBusyById((prev) => ({ ...prev, [recommendation.id]: true }));
    setRecommendationFeedbackStatus("");
    setRecommendations((prev) =>
      prev.map((entry) => {
        if (entry.id !== recommendation.id) return entry;
        let helpfulCount = entry.helpfulCount;
        let notHelpfulCount = entry.notHelpfulCount;
        if (entry.viewerFeedback === "helpful") helpfulCount = Math.max(0, helpfulCount - 1);
        if (entry.viewerFeedback === "not_helpful") notHelpfulCount = Math.max(0, notHelpfulCount - 1);
        if (feedback === "helpful") helpfulCount += 1;
        if (feedback === "not_helpful") notHelpfulCount += 1;
        return {
          ...entry,
          viewerFeedback: feedback,
          helpfulCount,
          notHelpfulCount,
        };
      })
    );

    try {
      let source: "api_v1" | "firestore" = "api_v1";
      try {
        const helpful = feedback === "helpful";
        const payload: LibraryRecommendationsFeedbackSubmitRequest = {
          recommendationId: recommendation.id,
          helpful,
          comment: comment || null,
        };
        const response = await client.postJson<LibraryRecommendationsFeedbackSubmitResponse>(
          V1_LIBRARY_RECOMMENDATIONS_FEEDBACK_SUBMIT_FN,
          payload
        );
        const helpfulCount = response?.data?.recommendation?.helpfulCount;
        const feedbackCount = response?.data?.recommendation?.feedbackCount;
        if (typeof helpfulCount === "number" || typeof feedbackCount === "number") {
          setRecommendations((prev) =>
            prev.map((entry) =>
              entry.id === recommendation.id
                ? {
                    ...entry,
                    helpfulCount: typeof helpfulCount === "number" ? Math.max(0, Math.round(helpfulCount)) : entry.helpfulCount,
                    feedbackCount:
                      typeof feedbackCount === "number"
                        ? Math.max(0, Math.round(feedbackCount))
                        : entry.feedbackCount,
                    notHelpfulCount:
                      typeof helpfulCount === "number" && typeof feedbackCount === "number"
                        ? Math.max(0, Math.round(feedbackCount) - Math.round(helpfulCount))
                        : entry.notHelpfulCount,
                    viewerFeedback: feedback,
                  }
                : entry
            )
          );
        }
      } catch (error: unknown) {
        if (shouldBlockWriteFallback(error)) throw error;
        source = "firestore";
        await setDoc(
          doc(db, "libraryRecommendationFeedback", `${recommendation.id}__${user.uid}`),
          {
            recommendationId: recommendation.id,
            uid: user.uid,
            helpful: feedback === "helpful",
            comment: comment || null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (comment) {
        setRecommendationFeedbackCommentById((prev) => {
          const next = { ...prev };
          delete next[recommendation.id];
          return next;
        });
      }

      setRecommendationFeedbackStatus(
        comment
          ? "Feedback note saved. Thanks for adding context for peers."
          : feedback === "helpful"
            ? "Marked as helpful. Thanks for supporting peers."
            : "Feedback saved. Thanks for helping improve recommendations."
      );
      trackLending("lending_recommendation_feedback_submitted", {
        section: "community_recommendations",
        recommendationId: recommendation.id,
        feedback,
        hasComment: Boolean(comment),
        source,
      });
    } catch (error: unknown) {
      setRecommendations((prev) =>
        prev.map((entry) =>
          entry.id === recommendation.id
            ? {
                ...entry,
                viewerFeedback: previousFeedback,
                helpfulCount: previousHelpful,
                notHelpfulCount: previousNotHelpful,
              }
            : entry
        )
      );
      setRecommendationFeedbackStatus(`Feedback failed: ${getErrorMessage(error)}`);
    } finally {
      setRecommendationFeedbackBusyById((prev) => {
        const next = { ...prev };
        delete next[recommendation.id];
        return next;
      });
    }
  };

  const renderItemActions = (item: LibraryItem, context: "rail" | "catalog") => {
    const available = typeof item.availableCopies === "number" ? item.availableCopies : 0;
    const activeRequest = requestMap.get(item.id);
    const activeLoan = loanMap.get(item.id);
    const actionLabel = available > 0 ? "Reserve" : "Join waitlist";
    const actionType = available > 0 ? "reserve" : "waitlist";

    return (
      <div className="library-actions">
        {memberInteractionsPaused ? (
          <div className="pill">{`Interactions paused (${libraryRolloutPhaseLabel(libraryRolloutPhase)})`}</div>
        ) : activeLoan ? (
          <button
            className="btn btn-primary"
            onClick={toVoidHandler(() => handleRequest(item, "return"))}
            disabled={actionBusy}
          >
            {actionBusy ? "Requesting..." : "Request return"}
          </button>
        ) : activeRequest ? (
          <div className="pill">
            {activeRequest.type === "waitlist"
              ? "Waitlist pending"
              : activeRequest.type === "return"
                ? "Return pending"
                : "Reservation pending"}
          </div>
        ) : (
          <button
            className="btn btn-primary"
            onClick={toVoidHandler(async () => {
              trackLending("lending_section_action", {
                section: context,
                action: actionType,
                itemId: item.id,
              });
              await handleRequest(item, actionType);
            })}
            disabled={actionBusy || !canRequest}
          >
            {actionBusy ? "Requesting..." : actionLabel}
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => {
            setSelectedItemId(item.id);
            setWorkshopTechnique(item.techniques?.[0] ?? "");
            trackLending("lending_section_action", {
              section: context,
              action: "view_details",
              itemId: item.id,
            });
          }}
        >
          View details
        </button>
      </div>
    );
  };

  const renderSignalMeta = (item: LibraryItem) => {
    const summary = reviewAggregateMap.get(item.id);
    if (!summary) {
      return <div className="library-signal-meta">New title - be the first to review practical value</div>;
    }
    return (
      <div className="library-signal-meta">
        {formatStars(summary.averagePracticality)} - {summary.reviewCount} review{summary.reviewCount === 1 ? "" : "s"}
        {summary.topBestFor ? ` - best for ${formatTechniqueLabel(summary.topBestFor)}` : ""}
      </div>
    );
  };

  const renderDetailPrimaryActions = (item: LibraryItem) => {
    const availableCopies = typeof item.availableCopies === "number" ? item.availableCopies : 0;
    const activeRequest = requestMap.get(item.id);
    const activeLoan = loanMap.get(item.id);
    const primaryLabel = availableCopies > 0 ? "Reserve this title" : "Join waitlist";
    const primaryType: "reserve" | "waitlist" = availableCopies > 0 ? "reserve" : "waitlist";

    return (
      <div className="detail-action-bar">
        <div className="detail-action-main">
          {memberInteractionsPaused ? (
            <div className="pill">{`Interactions paused (${libraryRolloutPhaseLabel(libraryRolloutPhase)})`}</div>
          ) : activeLoan ? (
            <button
              className="btn btn-primary"
              onClick={toVoidHandler(() => handleRequest(item, "return"))}
              disabled={actionBusy}
            >
              {actionBusy ? "Submitting..." : "Request return"}
            </button>
          ) : activeRequest ? (
            <div className="pill">
              {activeRequest.type === "waitlist"
                ? "Waitlist request pending"
                : activeRequest.type === "return"
                  ? "Return request pending"
                  : "Reservation request pending"}
            </div>
          ) : (
            <button
              className="btn btn-primary"
              onClick={toVoidHandler(() => handleRequest(item, primaryType))}
              disabled={actionBusy || !canRequest}
            >
              {actionBusy ? "Submitting..." : primaryLabel}
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={toVoidHandler(() => handleNotifyToggle(item))}
            disabled={notifyBusyById[item.id]}
          >
            {notifyBusyById[item.id]
              ? "Updating..."
              : notifyPrefs[item.id]
                ? "Notifications on"
                : "Notify when available"}
          </button>
        </div>
        <div className="detail-action-note">
          {memberInteractionsPaused
            ? `Member interactions are paused in ${libraryRolloutPhaseLabel(libraryRolloutPhase)}. Browse and planning tools remain available.`
            : activeLoan
            ? "You currently have this title checked out."
            : activeRequest
              ? "Your request is queued with staff."
              : availableCopies > 0
                ? `${availableCopies} cop${availableCopies === 1 ? "y" : "ies"} available right now.`
                : "No copies available right now. Join the waitlist to hold your place."}
        </div>
      </div>
    );
  };

  return (
    <div className="page lending-library-page">
      <div className="page-header">
        <div>
          <h1>Lending Library</h1>
        </div>
      </div>

      <section className="card card-3d lending-hero">
        <div>
          <div className="card-title">Library policies</div>
          <p className="lending-copy">
            Loan length: {LOAN_LENGTH_LABEL}. Active loans: {activeLoanCount} / {MAX_LOANS}. Staff
            approval required for all reservations and waitlists.
          </p>
        </div>
        <div className="lending-hero-meta">
          <div>
            <span className="summary-label">Loan length</span>
            <span className="summary-value">{LOAN_LENGTH_LABEL}</span>
          </div>
          <div>
            <span className="summary-label">Max loans</span>
            <span className="summary-value">{MAX_LOANS}</span>
          </div>
          <div>
            <span className="summary-label">Role</span>
            <span className="summary-value">{isStaff ? "Staff" : "Client"}</span>
          </div>
          <div>
            <span className="summary-label">Signals</span>
            <span className="summary-value">{reviewsLoading ? "..." : reviews.length}</span>
          </div>
        </div>
      </section>

      {memberInteractionsPaused ? (
        <section className="card card-3d">
          <div className="notice inline-alert">{memberInteractionsPauseNotice}</div>
          {memberInteractionsPauseNote ? (
            <div className="library-meta">{`Staff note: ${memberInteractionsPauseNote}`}</div>
          ) : null}
        </section>
      ) : null}

      <section className="lending-discovery">
        {discoveryLoading ? <div className="notice inline-alert">Loading discovery rails...</div> : null}
        {discoveryError ? <div className="notice inline-alert">{discoveryError}</div> : null}
        {rails.map((rail) => (
          <article className="card card-3d discovery-rail-card" key={rail.key}>
            <div className="discovery-rail-header">
              <div>
                <div className="card-title">{rail.title}</div>
                <p className="lending-copy">{rail.subtitle}</p>
              </div>
              <div className="summary-label">{rail.items.length} titles</div>
            </div>
            {rail.items.length === 0 ? (
              <div className="empty-state">
                Discovery rail will populate as staff curation and member signals update.
              </div>
            ) : (
              <div className="discovery-rail-grid">
                {rail.items.map((item) => (
                  <article className="library-card discovery-card" key={`${rail.key}-${item.id}`}>
                    <div className="library-card-header">
                      {renderMemberLibraryCover(item)}
                      <div>
                        <div className="library-title">{item.title}</div>
                        <div className="library-meta">{(item.authors ?? []).join(", ") || "Unknown author"}</div>
                        <div className="library-meta">{formatAvailability(item)}</div>
                      </div>
                    </div>
                    {item.curation?.staffRationale ? (
                      <p className="library-description">{item.curation.staffRationale}</p>
                    ) : null}
                    {renderSignalMeta(item)}
                    {renderItemActions(item, "rail")}
                  </article>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="card card-3d lending-search">
        <div className="lending-search-header">
          <div>
            <div className="card-title">Browse the library</div>
            <p className="lending-copy">Search by title, author, technique, subject, or ISBN.</p>
            <div className="catalog-state-row">
              <span className="library-meta">
                {activeFilterCount > 0
                  ? `${activeFilterCount} active search/filter control${activeFilterCount === 1 ? "" : "s"}`
                  : "No active filters"}
              </span>
              {activeFilterCount > 0 ? (
                <button
                  className="btn btn-ghost btn-small"
                  onClick={resetCatalogSearchAndFilters}
                >
                  Reset search and filters
                </button>
              ) : null}
            </div>
          </div>
          <div className="lending-search-controls">
            <label className="library-filter-inline">
              Sort
              <select
                value={catalogFilters.sort}
                onChange={(event) => {
                  const sortValue = event.target.value as LibraryItemsSort;
                  setCatalogFilters((prev) => ({ ...prev, sort: sortValue }));
                  trackLending("lending_filter_changed", {
                    section: "catalog",
                    filter: "sort",
                    value: sortValue,
                  });
                }}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`btn btn-ghost btn-small filter-panel-toggle ${filtersPanelOpen ? "is-open" : ""}`}
              onClick={() => setFiltersPanelOpen((prev) => !prev)}
              aria-expanded={filtersPanelOpen}
              aria-controls="library-filter-panel"
            >
              {filtersPanelOpen ? "Close filters" : "Filters"}
            </button>
          </div>
        </div>
        <input
          type="search"
          placeholder="Search books, authors, techniques, ISBNs"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div
          id="library-filter-panel"
          className={`library-filter-panel ${filtersPanelOpen ? "is-open" : ""}`}
        >
          <div className="library-filter-panel-header">
            <span className="summary-label">Filter catalog</span>
            <button className="btn btn-ghost btn-small" onClick={() => setFiltersPanelOpen(false)}>
              Close
            </button>
          </div>

          <div className="library-filter-group">
            <span className="summary-label">Media type</span>
            <div className="library-filter-chip-grid">
              {MEDIA_TYPE_OPTIONS.map((option) => {
                const active = catalogFilters.mediaTypes.includes(option.value);
                return (
                  <button
                    key={option.value}
                    className={`chip ${active ? "active" : ""}`}
                    onClick={() => {
                      toggleMediaTypeFilter(option.value);
                      trackLending("lending_filter_changed", {
                        section: "catalog",
                        filter: "mediaType",
                        value: option.value,
                        active: !active,
                      });
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="library-filter-grid">
            <label className="library-filter-inline">
              Genre
              <input
                type="text"
                value={catalogFilters.genre}
                onChange={(event) =>
                  setCatalogFilters((prev) => ({
                    ...prev,
                    genre: event.target.value,
                  }))
                }
                placeholder="ex: ceramics"
              />
            </label>
            <label className="library-filter-inline">
              Studio category
              <input
                type="text"
                value={catalogFilters.studioCategoryInput}
                onChange={(event) =>
                  setCatalogFilters((prev) => ({
                    ...prev,
                    studioCategoryInput: event.target.value,
                  }))
                }
                placeholder="comma-separated"
              />
            </label>
            <label className="library-filter-inline">
              Availability
              <select
                value={catalogFilters.availability}
                onChange={(event) =>
                  setCatalogFilters((prev) => ({
                    ...prev,
                    availability: event.target.value as CatalogAvailability,
                  }))
                }
              >
                <option value="all">All</option>
                <option value="available">Available</option>
                <option value="checked_out">Checked out</option>
                <option value="overdue">Overdue</option>
                <option value="lost">Lost</option>
                <option value="unavailable">Unavailable</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <div className="library-filter-range">
              <label className="library-filter-inline">
                Min rating
                <select
                  value={catalogFilters.ratingMin ?? ""}
                  onChange={(event) => {
                    const next = event.target.value === "" ? null : Number(event.target.value);
                    setCatalogFilters((prev) => ({ ...prev, ratingMin: Number.isFinite(next) ? next : null }));
                  }}
                >
                  <option value="">Any</option>
                  <option value={1}>1+</option>
                  <option value={2}>2+</option>
                  <option value={3}>3+</option>
                  <option value={4}>4+</option>
                  <option value={5}>5</option>
                </select>
              </label>
              <label className="library-filter-inline">
                Max rating
                <select
                  value={catalogFilters.ratingMax ?? ""}
                  onChange={(event) => {
                    const next = event.target.value === "" ? null : Number(event.target.value);
                    setCatalogFilters((prev) => ({ ...prev, ratingMax: Number.isFinite(next) ? next : null }));
                  }}
                >
                  <option value="">Any</option>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </select>
              </label>
            </div>
          </div>

          <div className="library-filter-actions">
            <button className="btn btn-ghost btn-small" onClick={clearCatalogFilters}>
              Clear all
            </button>
            <button className="btn btn-secondary btn-small" onClick={() => setFiltersPanelOpen(false)}>
              Apply filters
            </button>
          </div>
        </div>
        <div className="library-meta">
          {itemsLoading
            ? "Refreshing catalog..."
            : `${filteredItems.length} shown${itemsSource === "api_v1" && itemsTotal > 0 ? ` of ${itemsTotal}` : ""} • ${
                itemsSource === "api_v1" ? "Server-ranked" : "Local fallback"
              }`}
        </div>
        {itemsError ? <div className="alert inline-alert">{itemsError}</div> : null}
        {itemsLoading ? <div className="notice inline-alert">Loading library items...</div> : null}
        {reviewsError ? <div className="notice inline-alert">{reviewsError}</div> : null}

        {shouldShowExternalFallbackPanel ? (
          <aside className="external-fallback-panel" aria-live="polite">
            <div className="external-fallback-header">
              <div>
                <div className="summary-label">Need broader discovery?</div>
                <div className="external-fallback-title">
                  {localSearchResultState === "empty"
                    ? `No local matches for "${searchTerm}".`
                    : `${filteredItems.length} local match${filteredItems.length === 1 ? "" : "es"} for "${searchTerm}".`}
                </div>
                <p className="lending-copy">
                  Run an external lookup only when you want to expand beyond Monsoon Fire holdings.
                </p>
              </div>
              <div className="external-fallback-actions">
                <button className="btn btn-secondary" onClick={toVoidHandler(runExternalLookup)} disabled={externalLookupBusy}>
                  {externalLookupBusy ? "Searching..." : "Search external sources"}
                </button>
                <a
                  className="btn btn-ghost"
                  href={publicLibrarySearchUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Find in public library
                </a>
              </div>
            </div>
            {externalLookupStatus ? <div className="notice inline-alert">{externalLookupStatus}</div> : null}
            {externalLookupDiagnostics ? <div className="library-meta">{externalLookupDiagnostics}</div> : null}
            {hasExternalResultsForSearch ? (
              <div className="external-result-grid">
                {externalLookupResults.map((result) => (
                  <article className="external-result-card" key={`${result.id}-${result.source}`}>
                    <div className="library-card-header">
                      {result.coverUrl ? (
                        <img className="library-cover" src={result.coverUrl} alt={result.title} />
                      ) : (
                        <div className="library-cover placeholder">Cover</div>
                      )}
                        <div>
                          <div className="library-title">{result.title}</div>
                          <div className="library-meta">{result.author}</div>
                          {result.publishedDate ? (
                            <div className="library-meta">Published {result.publishedDate}</div>
                          ) : null}
                        </div>
                      </div>
                    <div className="library-meta">
                      Source:{" "}
                      {result.sourceUrl ? (
                        <a href={result.sourceUrl} target="_blank" rel="noreferrer">
                          {result.sourceLabel ?? result.source}
                        </a>
                      ) : (
                        result.sourceLabel ?? result.source
                      )}
                    </div>
                    {result.summary ? <p className="library-description">{result.summary}</p> : null}
                    <div className="external-result-actions">
                      <a
                        className="btn btn-ghost btn-small"
                        href={resolvePublicLibraryUrl(result)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Public library handoff
                      </a>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => prefillAcquisitionRequest(result)}
                      >
                        Prefill acquisition request
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </aside>
        ) : null}

        <div className="library-grid">
          {filteredItems.length === 0 ? (
            <div className="empty-state library-empty-state">
              No local titles match this search yet.
            </div>
          ) : (
            filteredItems.map((item) => {
              const summary = reviewAggregateMap.get(item.id);
              const queueSummary = summarizeQueueContext(item, requestMap.get(item.id));
              return (
                <article className="library-card" key={item.id}>
                  <div className="library-card-header">
                    {renderMemberLibraryCover(item)}
                    <div>
                      <div className="library-title">{item.title}</div>
                      {item.subtitle ? <div className="library-subtitle">{item.subtitle}</div> : null}
                      <div className="library-meta">
                        {(item.authors ?? []).join(", ") || "Unknown author"}
                      </div>
                      <div className="library-meta">{formatAvailability(item)}</div>
                      {item.techniques && item.techniques.length > 0 ? (
                        <div className="library-techniques">
                          {item.techniques.slice(0, 3).map((technique) => (
                            <span className="pill subtle" key={`${item.id}-${technique}`}>
                              {formatTechniqueLabel(technique)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="library-signal-meta">
                    {summary
                      ? `${formatStars(summary.averagePracticality)} - ${summary.reviewCount} practical review${
                          summary.reviewCount === 1 ? "" : "s"
                        }`
                      : "No practical reviews yet"}
                  </div>

                  <div className="library-lifecycle-meta">{queueSummary}</div>

                  {item.description ? <p className="library-description">{item.description}</p> : null}

                  {renderItemActions(item, "catalog")}
                </article>
              );
            })
          )}
        </div>
      </section>

      {selectedItem ? (
        <section className="card card-3d lending-detail" aria-live="polite">
          <div className="lending-detail-header">
            <div>
              <div className="card-title">{selectedItem.title}</div>
              <div className="library-meta">
                {(selectedItem.authors ?? []).join(", ") || "Unknown author"}
              </div>
              <div className="library-meta">{formatAvailability(selectedItem)}</div>
            </div>
            <div className="lending-detail-badges">
              <span className="pill">{summarizeQueueContext(selectedItem, requestMap.get(selectedItem.id))}</span>
              <span className="pill subtle">{summarizeEtaContext(selectedItem, requestMap.get(selectedItem.id))}</span>
            </div>
          </div>
          {renderDetailPrimaryActions(selectedItem)}
          {selectedItemDetailLoading ? <div className="notice inline-alert">Refreshing detail...</div> : null}
          {selectedItemDetailError ? <div className="notice inline-alert">{selectedItemDetailError}</div> : null}

          <div className="lending-detail-grid">
            <article className="lending-detail-panel">
              <div className="summary-label">Lifecycle clarity</div>
              <p className="lending-copy">
                {selectedItem.lifecycle?.queueMessage ??
                  "Requests are approved by staff in order. We will message you when pickup is ready."}
              </p>
              <p className="lending-copy">{summarizeEtaContext(selectedItem, requestMap.get(selectedItem.id))}</p>
              <label>
                Reading status
                <select
                  value={readingStatusByItem[selectedItem.id] ?? ""}
                  onChange={(event) => {
                    const nextStatus = normalizeReadingStatus(event.target.value);
                    if (!nextStatus) return;
                    toVoidHandler(() => upsertReadingStatus(selectedItem, nextStatus))();
                  }}
                  disabled={readingStatusBusyByItem[selectedItem.id] || memberInteractionsPaused}
                >
                  <option value="">Set status...</option>
                  <option value="have">Have</option>
                  <option value="borrowed">Borrowed</option>
                  <option value="want_to_read">Want to read</option>
                  <option value="recommended">Recommended</option>
                </select>
              </label>
              <div className="library-meta">
                {memberInteractionsPaused
                  ? `Reading status updates are paused during ${libraryRolloutPhaseLabel(libraryRolloutPhase)}.`
                  : readingStatusBusyByItem[selectedItem.id]
                    ? "Saving reading status..."
                    : readingStatusByItem[selectedItem.id]
                    ? `Current status: ${formatTechniqueLabel(readingStatusByItem[selectedItem.id])}`
                    : "No reading status set yet."}
              </div>
              {readingStatusMessage ? <div className="notice inline-alert">{readingStatusMessage}</div> : null}
              <label>
                Suggest a tag (moderated)
                <div className="tag-suggestion-row">
                  <input
                    type="text"
                    value={tagSubmissionDraftByItem[selectedItem.id] ?? ""}
                    onChange={(event) =>
                      setTagSubmissionDraftByItem((prev) => ({
                        ...prev,
                        [selectedItem.id]: event.target.value,
                      }))
                    }
                    placeholder="ex: glaze testing"
                    maxLength={80}
                    disabled={memberInteractionsPaused}
                  />
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={toVoidHandler(() => submitTagSuggestion(selectedItem))}
                    disabled={Boolean(tagSubmissionBusyByItem[selectedItem.id]) || memberInteractionsPaused}
                  >
                    {tagSubmissionBusyByItem[selectedItem.id] ? "Submitting..." : "Submit"}
                  </button>
                </div>
              </label>
              <div className="library-meta">
                {memberInteractionsPaused
                  ? `Tag suggestions are paused during ${libraryRolloutPhaseLabel(libraryRolloutPhase)}.`
                  : "Tag suggestions are reviewed by staff before they appear in discovery."}
              </div>
              {tagSubmissionStatus ? <div className="notice inline-alert">{tagSubmissionStatus}</div> : null}
              <details className="detail-advanced-metadata">
                <summary>Advanced metadata</summary>
                <div className="detail-advanced-grid">
                  <div>
                    <span className="summary-label">Publisher</span>
                    <span className="library-meta">{selectedItem.publisher || "Unknown"}</span>
                  </div>
                  <div>
                    <span className="summary-label">Published</span>
                    <span className="library-meta">{selectedItem.publishedDate || "Unknown"}</span>
                  </div>
                  <div>
                    <span className="summary-label">Page count</span>
                    <span className="library-meta">
                      {typeof selectedItem.pageCount === "number" ? selectedItem.pageCount : "Unknown"}
                    </span>
                  </div>
                  <div>
                    <span className="summary-label">Media type</span>
                    <span className="library-meta">{selectedItem.mediaType || "book"}</span>
                  </div>
                  <div>
                    <span className="summary-label">Genre</span>
                    <span className="library-meta">{selectedItem.genre || selectedItem.primaryGenre || "Unspecified"}</span>
                  </div>
                  <div>
                    <span className="summary-label">Studio category</span>
                    <span className="library-meta">{selectedItem.studioCategory || "Unspecified"}</span>
                  </div>
                  <div>
                    <span className="summary-label">ISBN-10</span>
                    <span className="library-meta">
                      {selectedItem.identifiers?.isbn10 || "Not listed"}
                    </span>
                  </div>
                  <div>
                    <span className="summary-label">ISBN-13</span>
                    <span className="library-meta">
                      {selectedItem.identifiers?.isbn13 || "Not listed"}
                    </span>
                  </div>
                </div>
              </details>
            </article>

            <article className="lending-detail-panel">
              <div className="summary-label">Technique to workshop pathway</div>
              <div className="detail-techniques">
                {(selectedItem.techniques ?? []).length > 0 ? (
                  selectedItem.techniques?.map((technique) => (
                    <button
                      key={`${selectedItem.id}-tech-${technique}`}
                      className="chip"
                      onClick={() => {
                        setWorkshopTechnique(technique);
                        trackLending("lending_section_action", {
                          section: "technique_workshop_bridge",
                          action: "prefill_technique",
                          itemId: selectedItem.id,
                          technique,
                        });
                      }}
                    >
                      {formatTechniqueLabel(technique)}
                    </button>
                  ))
                ) : (
                  <div className="empty-state">No technique tags yet. Staff can add them for pathway matching.</div>
                )}
              </div>

              <div className="related-workshops">
                {(selectedItem.relatedWorkshops ?? []).length > 0 ? (
                  selectedItem.relatedWorkshops?.map((workshop) => (
                    <a
                      className="related-workshop-link"
                      key={`${selectedItem.id}-workshop-${workshop.id ?? workshop.title}`}
                      href={workshop.url || "#"}
                      target={workshop.url ? "_blank" : undefined}
                      rel={workshop.url ? "noreferrer" : undefined}
                      onClick={() => {
                        trackLending("lending_workshop_link_opened", {
                          section: "technique_workshop_bridge",
                          itemId: selectedItem.id,
                          workshopTitle: workshop.title,
                          hasUrl: Boolean(workshop.url),
                        });
                      }}
                    >
                      <span>{workshop.title}</span>
                      <span className="library-meta">
                        {[workshop.scheduleLabel, workshop.status].filter(Boolean).join(" - ") ||
                          "Related workshop"}
                      </span>
                    </a>
                  ))
                ) : (
                  <div className="empty-state">No linked workshop yet for these techniques.</div>
                )}
              </div>

              <div className="workshop-request-inline">
                <label>
                  Technique/topic
                  <input
                    type="text"
                    value={workshopTechnique}
                    onChange={(event) => setWorkshopTechnique(event.target.value)}
                    placeholder="ex: handbuilding handles, atmospheric glazing"
                  />
                </label>
                <label>
                  Skill level
                  <select
                    value={workshopLevel}
                    onChange={(event) => setWorkshopLevel(event.target.value as WorkshopRequestLevel)}
                  >
                    <option value="all-levels">All levels</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </label>
                <label>
                  Schedule
                  <select
                    value={workshopSchedule}
                    onChange={(event) =>
                      setWorkshopSchedule(event.target.value as WorkshopRequestSchedule)
                    }
                  >
                    <option value="weekday-evening">Weekday evening</option>
                    <option value="weekday-daytime">Weekday daytime</option>
                    <option value="weekend-morning">Weekend morning</option>
                    <option value="weekend-afternoon">Weekend afternoon</option>
                    <option value="flexible">Flexible</option>
                  </select>
                </label>
                <label className="span-2">
                  Notes (optional)
                  <input
                    type="text"
                    value={workshopNote}
                    onChange={(event) => setWorkshopNote(event.target.value)}
                    placeholder="What would make this workshop immediately useful?"
                  />
                </label>
                <button
                  className="btn btn-primary"
                  onClick={toVoidHandler(() => submitWorkshopRequest(selectedItem))}
                  disabled={workshopBusy || !workshopTechnique.trim()}
                >
                  {workshopBusy ? "Sending..." : "Request workshop for this technique"}
                </button>
                {workshopStatus ? <div className="notice inline-alert">{workshopStatus}</div> : null}
              </div>
            </article>

            <article className="lending-detail-panel">
              <div className="summary-label">Member learning signals</div>
              {renderSignalMeta(selectedItem)}
              {selectedItemReflections.length > 0 ? (
                <div className="reflection-list">
                  {selectedItemReflections.map((entry) => (
                    <div className="reflection-card" key={entry.id}>
                      <div className="reflection-title">Inspired by this title</div>
                      <p>{entry.reflection}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">No inspired-by reflections yet.</div>
              )}

              {memberInteractionsPaused ? (
                <div className="library-meta">
                  {`Practical review submissions are paused during ${libraryRolloutPhaseLabel(libraryRolloutPhase)}.`}
                </div>
              ) : reviewItemId === selectedItem.id ? (
                <form
                  className="quick-review-form"
                  onSubmit={toVoidHandler(async () => {
                    await submitReview(selectedItem);
                  })}
                >
                  <div className="summary-label">
                    {selectedItemMyReview ? "Update your practical review" : "45-second practical review"}
                  </div>
                  <label>
                    Practical value (1-5)
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={reviewPracticality}
                      onChange={(event) => setReviewPracticality(normalizePracticality(event.target.value))}
                    />
                  </label>
                  <div className="library-meta">Selected: {reviewPracticality}</div>
                  <label>
                    Difficulty
                    <select
                      value={reviewDifficulty}
                      onChange={(event) => setReviewDifficulty(normalizeDifficulty(event.target.value))}
                    >
                      <option value="all-levels">All levels</option>
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                    </select>
                  </label>
                  <label>
                    Best for
                    <select value={reviewBestFor} onChange={(event) => setReviewBestFor(event.target.value)}>
                      <option value="quick-reference">Quick reference</option>
                      <option value="project-planning">Project planning</option>
                      <option value="troubleshooting">Troubleshooting</option>
                      <option value="skill-drill">Skill drill</option>
                      <option value="studio-system">Studio system</option>
                    </select>
                  </label>
                  <label>
                    Inspired by this book (optional)
                    <input
                      type="text"
                      maxLength={180}
                      value={reviewReflection}
                      onChange={(event) => setReviewReflection(event.target.value)}
                      placeholder="ex: I used this trimming flow on six mugs this week"
                    />
                  </label>
                  <div className="quick-review-actions">
                    <button className="btn btn-primary" type="submit" disabled={reviewBusy}>
                      {reviewBusy ? "Saving..." : selectedItemMyReview ? "Update review" : "Save review"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => {
                        setReviewItemId(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setReviewItemId(selectedItem.id);
                    if (selectedItemMyReview) {
                      setReviewPracticality(normalizePracticality(selectedItemMyReview.practicality));
                      setReviewDifficulty(selectedItemMyReview.difficulty);
                      setReviewBestFor(selectedItemMyReview.bestFor);
                      setReviewReflection(selectedItemMyReview.reflection ?? "");
                    } else {
                      setReviewPracticality(4);
                      setReviewDifficulty("all-levels");
                      setReviewBestFor("quick-reference");
                      setReviewReflection("");
                    }
                    trackLending("lending_section_action", {
                      section: "learning_signals",
                      action: "open_review_form",
                      itemId: selectedItem.id,
                    });
                  }}
                >
                  {selectedItemMyReview ? "Update your practical review" : "Add 45-second practical review"}
                </button>
              )}
              {reviewStatus ? <div className="notice inline-alert">{reviewStatus}</div> : null}
            </article>
          </div>
        </section>
      ) : null}

      <section className="card card-3d lending-recommendations">
        <div className="card-title">Community recommendations</div>
        <p className="lending-copy">
          Share useful titles with peers. Members can vote on what is most helpful for the studio queue.
        </p>
        {memberInteractionsPaused ? (
          <div className="notice inline-alert">
            {`Recommendation sharing is paused during ${libraryRolloutPhaseLabel(libraryRolloutPhase)}. You can still browse existing recommendations.`}
          </div>
        ) : (
          <form
            className="recommendation-composer"
            onSubmit={toVoidHandler(async () => {
              await submitRecommendation();
            })}
          >
          <label>
            Title
            <input
              type="text"
              value={recommendationDraft.title}
              onChange={(event) =>
                setRecommendationDraft((prev) => ({ ...prev, title: event.target.value }))
              }
              placeholder="Book or resource title"
            />
          </label>
          <label>
            Author
            <input
              type="text"
              value={recommendationDraft.author}
              onChange={(event) =>
                setRecommendationDraft((prev) => ({ ...prev, author: event.target.value }))
              }
              placeholder="Author or creator"
            />
          </label>
          <label className="span-2">
            Why it helps (required)
            <textarea
              value={recommendationDraft.reason}
              onChange={(event) =>
                setRecommendationDraft((prev) => ({ ...prev, reason: event.target.value }))
              }
              rows={3}
              maxLength={320}
              placeholder="What specific workflow, firing issue, or skill does this improve?"
            />
          </label>
          <label>
            Techniques (optional)
            <input
              type="text"
              value={recommendationDraft.techniques}
              onChange={(event) =>
                setRecommendationDraft((prev) => ({ ...prev, techniques: event.target.value }))
              }
              placeholder="comma-separated, ex: handbuilding, trimming"
            />
          </label>
          <label>
            Studio relevance (optional)
            <input
              type="text"
              value={recommendationDraft.studioRelevance}
              onChange={(event) =>
                setRecommendationDraft((prev) => ({ ...prev, studioRelevance: event.target.value }))
              }
              placeholder="comma-separated, ex: glaze testing, kiln loading"
            />
          </label>
          <label className="span-2">
            Intent context (optional)
            <input
              type="text"
              value={recommendationDraft.intentContext}
              onChange={(event) =>
                setRecommendationDraft((prev) => ({ ...prev, intentContext: event.target.value }))
              }
              placeholder="What context should peers know before using this recommendation?"
            />
          </label>
          <label>
            ISBN (optional)
            <input
              type="text"
              value={recommendationDraft.isbn}
              onChange={(event) =>
                setRecommendationDraft((prev) => ({ ...prev, isbn: event.target.value }))
              }
              placeholder="ISBN-10 or ISBN-13"
            />
          </label>
          <label>
            Reference link (optional)
            <input
              type="url"
              value={recommendationDraft.linkUrl}
              onChange={(event) =>
                setRecommendationDraft((prev) => ({ ...prev, linkUrl: event.target.value }))
              }
              placeholder="https://..."
            />
          </label>
          <label>
            Cover image URL (optional)
            <input
              type="url"
              value={recommendationDraft.coverUrl}
              onChange={(event) =>
                setRecommendationDraft((prev) => ({ ...prev, coverUrl: event.target.value }))
              }
              placeholder="https://..."
            />
          </label>
          <label>
            Source label (optional)
            <input
              type="text"
              value={recommendationDraft.sourceLabel}
              onChange={(event) =>
                setRecommendationDraft((prev) => ({ ...prev, sourceLabel: event.target.value }))
              }
              placeholder="Open Library, Publisher, etc."
            />
          </label>
          <label className="span-2">
            Source URL (optional)
            <input
              type="url"
              value={recommendationDraft.sourceUrl}
              onChange={(event) =>
                setRecommendationDraft((prev) => ({ ...prev, sourceUrl: event.target.value }))
              }
              placeholder="https://source.example"
            />
          </label>
            <div className="recommendation-composer-actions">
              <button className="btn btn-primary" type="submit" disabled={recommendationBusy}>
                {recommendationBusy ? "Sharing..." : "Share recommendation"}
              </button>
            </div>
          </form>
        )}
        {recommendationStatus ? <div className="notice inline-alert">{recommendationStatus}</div> : null}
        {recommendationsError ? <div className="alert inline-alert">{recommendationsError}</div> : null}
        {recommendationsLoading ? (
          <div className="notice inline-alert">Loading community recommendations...</div>
        ) : null}

        <div className="recommendation-feed">
          {!recommendationsLoading && recommendations.length === 0 ? (
            <div className="empty-state">No recommendations yet. Be the first to add one.</div>
          ) : (
            recommendations.slice(0, 30).map((entry) => {
              const mine = recommendationBelongsToViewer(entry, user.uid);
              const showModeration = mine && entry.moderationStatus !== "approved";
              const contextSummary = [
                entry.techniques.length > 0 ? `Techniques: ${entry.techniques.join(", ")}` : null,
                entry.studioRelevance.length > 0 ? `Studio relevance: ${entry.studioRelevance.join(", ")}` : null,
                entry.intentContext ? `Intent: ${entry.intentContext}` : null,
              ]
                .filter(Boolean)
                .join(" | ");

              return (
                <article className="recommendation-card" key={entry.id}>
                  <div className="library-card-header">
                    {entry.coverUrl ? (
                      <img className="library-cover" src={entry.coverUrl} alt={entry.title} />
                    ) : (
                      <div className="library-cover placeholder">Cover</div>
                    )}
                    <div>
                      <div className="library-title">{entry.title}</div>
                      <div className="library-meta">{entry.author}</div>
                      <div className="library-meta">
                        Shared by {entry.recommendedByName || "Member"} on {recommendationCreatedLabel(entry)}
                      </div>
                      {showModeration ? (
                        <div className="library-meta">Moderation: {recommendationModerationLabel(entry.moderationStatus)}</div>
                      ) : null}
                    </div>
                  </div>
                  <p className="library-description">{entry.reason}</p>
                  {contextSummary ? <div className="library-meta">{contextSummary}</div> : null}
                  {entry.sourceLabel || entry.sourceUrl ? (
                    <div className="library-meta">
                      Source:{" "}
                      {entry.sourceUrl ? (
                        <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                          {entry.sourceLabel || "Reference link"}
                        </a>
                      ) : (
                        entry.sourceLabel
                      )}
                    </div>
                  ) : null}
                  {entry.linkUrl ? (
                    <a className="library-meta recommendation-link" href={entry.linkUrl} target="_blank" rel="noreferrer">
                      Open referenced title
                    </a>
                  ) : null}
                  <div className="recommendation-actions">
                    <button
                      className={`btn btn-ghost btn-small ${entry.viewerFeedback === "helpful" ? "is-active" : ""}`}
                      onClick={toVoidHandler(() => submitRecommendationFeedback(entry, "helpful"))}
                      disabled={recommendationFeedbackBusyById[entry.id] || memberInteractionsPaused}
                    >
                      Helpful ({entry.helpfulCount})
                    </button>
                    <button
                      className={`btn btn-ghost btn-small ${entry.viewerFeedback === "not_helpful" ? "is-active" : ""}`}
                      onClick={toVoidHandler(() => submitRecommendationFeedback(entry, "not_helpful"))}
                      disabled={recommendationFeedbackBusyById[entry.id] || memberInteractionsPaused}
                    >
                      Needs context ({entry.notHelpfulCount})
                    </button>
                  </div>
                  <div className="recommendation-feedback-note">
                    <input
                      type="text"
                      value={recommendationFeedbackCommentById[entry.id] ?? ""}
                      onChange={(event) =>
                        setRecommendationFeedbackCommentById((prev) => ({
                          ...prev,
                          [entry.id]: event.target.value,
                        }))
                      }
                      maxLength={220}
                      placeholder="Optional note for peers or staff moderation"
                      disabled={memberInteractionsPaused}
                    />
                    <button
                      className="btn btn-ghost btn-small"
                      onClick={toVoidHandler(() =>
                        submitRecommendationFeedback(entry, "not_helpful", recommendationFeedbackCommentById[entry.id] ?? "")
                      )}
                      disabled={
                        recommendationFeedbackBusyById[entry.id] ||
                        memberInteractionsPaused ||
                        !(recommendationFeedbackCommentById[entry.id] ?? "").trim()
                      }
                    >
                      Send note
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
        {recommendationFeedbackStatus ? <div className="notice inline-alert">{recommendationFeedbackStatus}</div> : null}
      </section>

      {actionStatus ? <div className="notice inline-alert">{actionStatus}</div> : null}
      {requestsError ? <div className="alert inline-alert">{requestsError}</div> : null}
      {requestsLoading ? <div className="notice inline-alert">Loading your requests...</div> : null}

      <section className="lending-row">
        <div className="card card-3d lending-panel">
          <div className="card-title">Your requests</div>
          {requests.length === 0 ? (
            <div className="empty-state">No requests yet.</div>
          ) : (
            <div className="list">
              {requests.map((request) => (
                <div className="list-row" key={request.id}>
                  <div>
                    <div className="list-title">{request.itemTitle}</div>
                    <div className="list-meta">{request.type} - {request.status}</div>
                    <div className="list-meta">{summarizeQueueContext(itemMap.get(request.itemId) ?? {
                      id: request.itemId,
                      title: request.itemTitle,
                      authors: [],
                      mediaType: "book",
                      totalCopies: 1,
                      availableCopies: 0,
                      status: "checked_out",
                      source: "manual",
                    }, request)}</div>
                  </div>
                  <div className="list-right">
                    <div className="list-meta">
                      {formatMaybeTimestamp(request.requestedAt)}
                    </div>
                    <div className="list-meta">{summarizeEtaContext(itemMap.get(request.itemId) ?? {
                      id: request.itemId,
                      title: request.itemTitle,
                      authors: [],
                      mediaType: "book",
                      totalCopies: 1,
                      availableCopies: 0,
                      status: "checked_out",
                      source: "manual",
                    }, request)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card card-3d lending-panel">
          <div className="card-title">Your loans</div>
          {loansError ? <div className="alert inline-alert">{loansError}</div> : null}
          {loansLoading ? <div className="notice inline-alert">Loading your loans...</div> : null}
          {!loansLoading && loans.length === 0 ? (
            <div className="empty-state">No active loans.</div>
          ) : (
            <div className="list">
              {loans.map((loan) => {
                const dueIn = daysUntil(loan.dueAt);
                const canRenew =
                  !memberInteractionsPaused && loan.status !== "returned" && (loan.renewalEligible ?? true);
                const renewalMeta =
                  loan.renewalLimit && typeof loan.renewalCount === "number"
                    ? `${loan.renewalCount}/${loan.renewalLimit} renewals used`
                    : "Renewal window depends on demand and holds";

                return (
                  <div className="list-row" key={loan.id}>
                    <div>
                      <div className="list-title">{loan.itemTitle}</div>
                      <div className="list-meta">{loan.status}</div>
                      <div className="list-meta">{renewalMeta}</div>
                      {loan.renewalPolicyNote ? <div className="list-meta">{loan.renewalPolicyNote}</div> : null}
                    </div>
                    <div className="list-right">
                      <div className="list-meta">
                        Due {formatMaybeTimestamp(loan.dueAt)}
                        {typeof dueIn === "number" ? ` (${dueIn >= 0 ? `${dueIn}d` : `${Math.abs(dueIn)}d overdue`})` : ""}
                      </div>
                      {canRenew ? (
                        <button
                          className="btn btn-ghost btn-small"
                          onClick={toVoidHandler(() => requestRenewal(loan))}
                          disabled={actionBusy}
                        >
                          Request renewal
                        </button>
                      ) : (
                        <div className="list-meta">
                          {memberInteractionsPaused
                            ? `Renewal requests are paused during ${libraryRolloutPhaseLabel(libraryRolloutPhase)}.`
                            : "Renewal unavailable for this loan state."}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="card card-3d lending-donate" id={ACQUISITION_REQUEST_SECTION_ID}>
        <div className="card-title">Acquisition request</div>
        <p className="lending-copy">
          Submit an ISBN or share title details. Staff will review for purchase or donation intake.
        </p>
        <div className="donation-grid">
          <label>
            ISBN
            <input
              type="text"
              value={donationIsbn}
              onChange={(event) => setDonationIsbn(event.target.value)}
              placeholder="ISBN-10 or ISBN-13"
            />
          </label>
          <label>
            Title
            <input
              type="text"
              value={donationTitle}
              onChange={(event) => setDonationTitle(event.target.value)}
              placeholder="Book or media title"
            />
          </label>
          <label>
            Author
            <input
              type="text"
              value={donationAuthor}
              onChange={(event) => setDonationAuthor(event.target.value)}
              placeholder="Author or creator"
            />
          </label>
          <label>
            Format
            <input
              type="text"
              value={donationFormat}
              onChange={(event) => setDonationFormat(event.target.value)}
              placeholder="Hardcover, DVD, zine"
            />
          </label>
          <label className="span-2">
            Notes
            <input
              type="text"
              value={donationNotes}
              onChange={(event) => setDonationNotes(event.target.value)}
              placeholder="Any condition notes or context"
            />
          </label>
        </div>
        {donationStatus ? <div className="notice inline-alert">{donationStatus}</div> : null}
        <button className="btn btn-primary" onClick={toVoidHandler(handleDonation)} disabled={donationBusy}>
          {donationBusy ? "Submitting..." : "Submit request"}
        </button>
      </section>

    </div>
  );
}
