import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import type {
  EventDetail,
  EventSignupRosterEntry,
  EventSignupSummary,
  EventSummary,
  GetEventResponse,
  IndustryEventSummary,
  ListIndustryEventsResponse,
  ListEventSignupsResponse,
  ListEventsResponse,
  RunIndustryEventsFreshnessNowResponse,
  SignupForEventResponse,
  CancelEventSignupResponse,
  ClaimEventOfferResponse,
  CheckInEventResponse,
  CreateEventCheckoutSessionResponse,
} from "../api/portalContracts";
import { createFunctionsClient } from "../api/functionsClient";
import { db } from "../firebase";
import { track } from "../lib/analytics";
import {
  filterIndustryEvents as filterIndustryBrowseEvents,
  industryEventLocationLabel,
  industryEventModeLabel,
} from "../lib/industryEvents";
import { formatCents, formatDateTime } from "../utils/format";
import { checkoutErrorMessage, requestErrorMessage } from "../utils/userFacingErrors";
import { toVoidHandler } from "../utils/toVoidHandler";
import "./EventsView.css";

const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
type ImportMetaEnvShape = { VITE_FUNCTIONS_BASE_URL?: string };
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;

const STATUS_LABELS: Record<string, string> = {
  ticketed: "Ticketed",
  waitlisted: "Waitlisted",
  offered: "Offer pending",
  checked_in: "Checked in",
  cancelled: "Cancelled",
  expired: "Expired",
};

const ROSTER_FILTERS = [
  { key: "all", label: "All" },
  { key: "ticketed", label: "Ticketed" },
  { key: "waitlisted", label: "Waitlisted" },
  { key: "offered", label: "Offered" },
  { key: "checked_in", label: "Checked in" },
] as const;

const LEVEL_OPTIONS = [
  { key: "all-levels", label: "All levels" },
  { key: "beginner", label: "Beginner" },
  { key: "intermediate", label: "Intermediate" },
  { key: "advanced", label: "Advanced" },
] as const;

const SCHEDULE_OPTIONS = [
  { key: "weekday-evening", label: "Weekday evening" },
  { key: "weekday-daytime", label: "Weekday daytime" },
  { key: "weekend-morning", label: "Weekend morning" },
  { key: "weekend-afternoon", label: "Weekend afternoon" },
  { key: "flexible", label: "Flexible" },
] as const;

const MEMBER_SCHEDULE_OPTIONS = [
  { key: "any", label: "Any schedule" },
  ...SCHEDULE_OPTIONS,
] as const;

const BUDDY_MODES = [
  {
    key: "solo",
    label: "Solo",
    copy: "I prefer to learn independently this round.",
  },
  {
    key: "buddy",
    label: "Buddy",
    copy: "I would join if one buddy is also in.",
  },
  {
    key: "circle",
    label: "Circle",
    copy: "I can bring a small learning circle (2-4 people).",
  },
] as const;

const INDUSTRY_MODE_OPTIONS = [
  { key: "all", label: "All industry events" },
  { key: "local", label: "Local" },
  { key: "remote", label: "Remote" },
  { key: "hybrid", label: "Hybrid" },
] as const;

const INDUSTRY_STATUS_OPTIONS = [
  { key: "draft", label: "Draft" },
  { key: "published", label: "Published" },
  { key: "cancelled", label: "Cancelled" },
] as const;

const TECHNIQUE_TAXONOMY = [
  {
    id: "wheel-throwing",
    label: "Wheel throwing",
    keywords: ["wheel", "throw", "centering", "cylinder", "trim"],
    shelf: "Foundations shelf",
    prework: "Read centering + pull consistency notes",
    postwork: "Practice trimming cadence workbook",
  },
  {
    id: "handbuilding",
    label: "Handbuilding",
    keywords: ["slab", "coil", "handbuild", "pinch", "construction"],
    shelf: "Build forms shelf",
    prework: "Review slab compression guide",
    postwork: "Join the modular form prompt set",
  },
  {
    id: "surface-decoration",
    label: "Surface decoration",
    keywords: ["carv", "sgraffito", "surface", "texture", "underglaze", "slip trail"],
    shelf: "Surface language shelf",
    prework: "Read layering + carving sequence notes",
    postwork: "Try the texture sampling worksheet",
  },
  {
    id: "glazing-firing",
    label: "Glazing + firing",
    keywords: ["glaze", "firing", "kiln", "cone", "raku", "reduction", "oxidation"],
    shelf: "Kiln and glaze shelf",
    prework: "Review firing curve + glaze fit basics",
    postwork: "Log three glaze tests with firing outcomes",
  },
  {
    id: "studio-practice",
    label: "Studio practice",
    keywords: ["studio", "workflow", "production", "planning", "critique", "practice"],
    shelf: "Studio systems shelf",
    prework: "Read weekly practice planning prompts",
    postwork: "Use the batch planning template",
  },
] as const;

const LOCAL_NAV_KEY = "mf_nav_key";
const LOCAL_NAV_SECTION_KEY = "mf_nav_section_key";
const WORKSHOP_CURATION_STORAGE_KEY = "mf_workshops_curation_v1";
const WORKSHOP_REQUEST_LEDGER_STORAGE_KEY = "mf_workshop_requests_v1";
const LENDING_HANDOFF_STORAGE_SLOT = "mf_lending_handoff_v1";
const REQUEST_LIFECYCLE_STATUSES = [
  "new",
  "reviewing",
  "planned",
  "scheduled",
  "declined",
] as const;

type Props = {
  user: User;
  adminToken?: string;
  isStaff: boolean;
};

type RosterFilter = (typeof ROSTER_FILTERS)[number]["key"];
type RequestLevel = (typeof LEVEL_OPTIONS)[number]["key"];
type RequestSchedule = (typeof SCHEDULE_OPTIONS)[number]["key"];
type MemberSchedule = (typeof MEMBER_SCHEDULE_OPTIONS)[number]["key"];
type BuddyMode = (typeof BUDDY_MODES)[number]["key"];
type TechniqueId = (typeof TECHNIQUE_TAXONOMY)[number]["id"];
type IndustryModeFilter = (typeof INDUSTRY_MODE_OPTIONS)[number]["key"];
type IndustryStatus = (typeof INDUSTRY_STATUS_OPTIONS)[number]["key"];

type IndustryEventDraft = {
  eventId: string | null;
  title: string;
  summary: string;
  description: string;
  mode: Exclude<IndustryModeFilter, "all">;
  status: IndustryStatus;
  startAtLocal: string;
  endAtLocal: string;
  timezone: string;
  location: string;
  city: string;
  region: string;
  country: string;
  remoteUrl: string;
  registrationUrl: string;
  sourceName: string;
  sourceUrl: string;
  featured: boolean;
  tagsCsv: string;
  verifiedAtLocal: string;
};

type RosterCounts = {
  total: number;
  ticketed: number;
  waitlisted: number;
  offered: number;
  checked_in: number;
  cancelled: number;
  expired: number;
  unpaid: number;
};

type ProfiledWorkshop = {
  event: EventSummary;
  techniqueIds: TechniqueId[];
  inferredLevel: RequestLevel;
  scheduleBucket: RequestSchedule;
  startAtMs: number | null;
};

type WorkshopDemandSignal = {
  id: string;
  kind: "request" | "interest";
  techniqueIds: TechniqueId[];
  techniqueLabel: string;
  level: RequestLevel;
  schedule: RequestSchedule;
  buddyMode: BuddyMode;
  createdAt: number;
  sourceEventId?: string | null;
};

type DemandCluster = {
  techniqueId: TechniqueId;
  label: string;
  requestCount: number;
  interestCount: number;
  waitlistSignals: number;
  supplyCount: number;
  demandScore: number;
  gapScore: number;
  recommendedLevel: RequestLevel;
  recommendedSchedule: RequestSchedule;
};

type WorkshopRequestLifecycleStatus = (typeof REQUEST_LIFECYCLE_STATUSES)[number];

type WorkshopRequestEntry = {
  id: string;
  ticketId: string;
  uid: string;
  techniqueLabel: string;
  techniqueIds: TechniqueId[];
  level: RequestLevel;
  schedule: RequestSchedule;
  status: WorkshopRequestLifecycleStatus;
  note: string;
  createdAt: number;
  updatedAt: number;
  source: "events-request-form" | "cluster-routing";
};

type RequestTriageCluster = {
  clusterKey: string;
  techniqueLabel: string;
  requestCount: number;
  statuses: Record<WorkshopRequestLifecycleStatus, number>;
  latestCreatedAt: number;
  recommendedLevel: RequestLevel;
  recommendedSchedule: RequestSchedule;
  priorityScore: number;
  topTicketIds: string[];
};

type WorkshopCurationConfig = {
  beginner: TechniqueId[];
  intensives: TechniqueId[];
  seasonal: RequestSchedule[];
};

const DEFAULT_WORKSHOP_CURATION_CONFIG: WorkshopCurationConfig = {
  beginner: ["handbuilding", "wheel-throwing"],
  intensives: ["surface-decoration", "glazing-firing", "wheel-throwing"],
  seasonal: ["weekend-morning", "weekend-afternoon"],
};

const TECHNIQUE_ID_SET = new Set<TechniqueId>(TECHNIQUE_TAXONOMY.map((entry) => entry.id));
const REQUEST_SCHEDULE_SET = new Set<RequestSchedule>(SCHEDULE_OPTIONS.map((entry) => entry.key));

function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function normalizeTechniqueKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function requestStatusLabel(status: WorkshopRequestLifecycleStatus): string {
  switch (status) {
    case "new":
      return "New";
    case "reviewing":
      return "Reviewing";
    case "planned":
      return "Planned";
    case "scheduled":
      return "Scheduled";
    case "declined":
      return "Declined";
    default:
      return status;
  }
}

function requestStatusTone(status: WorkshopRequestLifecycleStatus): "accent" | "warn" | "muted" {
  if (status === "scheduled") return "accent";
  if (status === "new" || status === "reviewing") return "warn";
  return "muted";
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function isoToLocalInput(value?: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeIndustryStatus(value: unknown): IndustryStatus {
  if (value === "draft" || value === "published" || value === "cancelled") return value;
  return "draft";
}

function toIndustryEventDraft(event?: IndustryEventSummary | null): IndustryEventDraft {
  return {
    eventId: event?.id ?? null,
    title: event?.title ?? "",
    summary: event?.summary ?? "",
    description: event?.description ?? "",
    mode: event?.mode ?? "local",
    status: normalizeIndustryStatus(event?.status),
    startAtLocal: isoToLocalInput(event?.startAt),
    endAtLocal: isoToLocalInput(event?.endAt),
    timezone: event?.timezone ?? "America/Phoenix",
    location: event?.location ?? "",
    city: event?.city ?? "",
    region: event?.region ?? "",
    country: event?.country ?? "US",
    remoteUrl: event?.remoteUrl ?? "",
    registrationUrl: event?.registrationUrl ?? "",
    sourceName: event?.sourceName ?? "",
    sourceUrl: event?.sourceUrl ?? "",
    featured: event?.featured === true,
    tagsCsv: event?.tags?.join(", ") ?? "",
    verifiedAtLocal: isoToLocalInput(event?.verifiedAt),
  };
}

function updateIndustryDraftField<K extends keyof IndustryEventDraft>(
  draft: IndustryEventDraft,
  field: K,
  value: IndustryEventDraft[K]
): IndustryEventDraft {
  return { ...draft, [field]: value };
}

function sanitizeWorkshopCurationConfig(raw?: Partial<WorkshopCurationConfig> | null): WorkshopCurationConfig {
  const beginner = dedupe(
    (raw?.beginner ?? []).filter((entry): entry is TechniqueId => TECHNIQUE_ID_SET.has(entry))
  );
  const intensives = dedupe(
    (raw?.intensives ?? []).filter((entry): entry is TechniqueId => TECHNIQUE_ID_SET.has(entry))
  );
  const seasonal = dedupe(
    (raw?.seasonal ?? []).filter((entry): entry is RequestSchedule => REQUEST_SCHEDULE_SET.has(entry))
  );
  return {
    beginner: beginner.length > 0 ? beginner : [...DEFAULT_WORKSHOP_CURATION_CONFIG.beginner],
    intensives: intensives.length > 0 ? intensives : [...DEFAULT_WORKSHOP_CURATION_CONFIG.intensives],
    seasonal: seasonal.length > 0 ? seasonal : [...DEFAULT_WORKSHOP_CURATION_CONFIG.seasonal],
  };
}

function loadWorkshopCurationConfig(): WorkshopCurationConfig {
  if (typeof window === "undefined") return DEFAULT_WORKSHOP_CURATION_CONFIG;
  try {
    const raw = window.localStorage.getItem(WORKSHOP_CURATION_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKSHOP_CURATION_CONFIG;
    const parsed = JSON.parse(raw) as Partial<WorkshopCurationConfig>;
    return sanitizeWorkshopCurationConfig(parsed);
  } catch {
    return DEFAULT_WORKSHOP_CURATION_CONFIG;
  }
}

function writeWorkshopCurationConfig(config: WorkshopCurationConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSHOP_CURATION_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage failures; current session state still applies.
  }
}

function loadWorkshopRequestLedger(uid: string): WorkshopRequestEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(`${WORKSHOP_REQUEST_LEDGER_STORAGE_KEY}:${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        const record = row as Partial<WorkshopRequestEntry>;
        const status =
          typeof record.status === "string" &&
          REQUEST_LIFECYCLE_STATUSES.includes(record.status as WorkshopRequestLifecycleStatus)
            ? (record.status as WorkshopRequestLifecycleStatus)
            : "new";
        const techniqueLabel = typeof record.techniqueLabel === "string" ? record.techniqueLabel.trim() : "";
        const techniqueIds = Array.isArray(record.techniqueIds)
          ? record.techniqueIds.filter((entry): entry is TechniqueId =>
              TECHNIQUE_ID_SET.has(entry as TechniqueId)
            )
          : [];
        const ticketId = typeof record.ticketId === "string" ? record.ticketId.trim() : "";
        const entryUid = typeof record.uid === "string" ? record.uid : uid;
        if (!techniqueLabel || !ticketId || !entryUid) return null;
        return {
          id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : ticketId,
          ticketId,
          uid: entryUid,
          techniqueLabel,
          techniqueIds: techniqueIds.length > 0 ? techniqueIds : parseTechniqueIds(techniqueLabel),
          level:
            record.level === "beginner" ||
            record.level === "intermediate" ||
            record.level === "advanced" ||
            record.level === "all-levels"
              ? record.level
              : "all-levels",
          schedule: REQUEST_SCHEDULE_SET.has(record.schedule as RequestSchedule)
            ? (record.schedule as RequestSchedule)
            : "weekday-evening",
          status,
          note: typeof record.note === "string" ? record.note : "",
          createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
          updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
          source:
            record.source === "cluster-routing" || record.source === "events-request-form"
              ? record.source
              : "events-request-form",
        } satisfies WorkshopRequestEntry;
      })
      .filter((entry): entry is WorkshopRequestEntry => Boolean(entry))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 120);
  } catch {
    return [];
  }
}

function writeWorkshopRequestLedger(uid: string, entries: WorkshopRequestEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${WORKSHOP_REQUEST_LEDGER_STORAGE_KEY}:${uid}`,
      JSON.stringify(entries.slice(0, 120))
    );
  } catch {
    // Ignore persistence failure; current in-memory state still works.
  }
}

type WorkshopCurationDraft = {
  beginnerCsv: string;
  intensivesCsv: string;
  seasonalCsv: string;
};

function curationConfigToDraft(config: WorkshopCurationConfig): WorkshopCurationDraft {
  return {
    beginnerCsv: config.beginner.join(", "),
    intensivesCsv: config.intensives.join(", "),
    seasonalCsv: config.seasonal.join(", "),
  };
}

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

function labelForStatus(status?: string | null) {
  if (!status) return "-";
  return STATUS_LABELS[status] || status;
}

function isActiveSignup(status?: string | null) {
  if (!status) return false;
  return status !== "cancelled" && status !== "expired";
}

function buildRosterCounts(rows: EventSignupRosterEntry[]): RosterCounts {
  const counts: RosterCounts = {
    total: 0,
    ticketed: 0,
    waitlisted: 0,
    offered: 0,
    checked_in: 0,
    cancelled: 0,
    expired: 0,
    unpaid: 0,
  };

  rows.forEach((row) => {
    counts.total += 1;
    const status = row.status || "";
    if (status in counts) {
      counts[status as keyof RosterCounts] += 1;
    }
    if (status === "checked_in" && row.paymentStatus !== "paid") {
      counts.unpaid += 1;
    }
  });

  return counts;
}

function makeSignalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toStartTimeMs(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function topRecordKey<T extends string>(record: Record<T, number>, fallback: T): T {
  const entries = Object.entries(record) as Array<[T, number]>;
  if (entries.length === 0) return fallback;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]?.[1] > 0 ? entries[0][0] : fallback;
}

function scheduleLabelFor(schedule: RequestSchedule | MemberSchedule) {
  const key = schedule === "any" ? "any" : schedule;
  return MEMBER_SCHEDULE_OPTIONS.find((option) => option.key === key)?.label ?? "Any schedule";
}

function levelLabelFor(level: RequestLevel) {
  return LEVEL_OPTIONS.find((option) => option.key === level)?.label ?? "All levels";
}

function techniqueById(id: TechniqueId) {
  return TECHNIQUE_TAXONOMY.find((technique) => technique.id === id);
}

function guessScheduleBucket(startAt?: string | null): RequestSchedule {
  const ms = toStartTimeMs(startAt);
  if (ms === null) return "flexible";

  const value = new Date(ms);
  const day = value.getDay();
  const hour = value.getHours();
  const isWeekday = day >= 1 && day <= 5;

  if (isWeekday && hour < 16) return "weekday-daytime";
  if (isWeekday) return "weekday-evening";
  if (hour < 12) return "weekend-morning";
  return "weekend-afternoon";
}

function guessLevel(text: string): RequestLevel {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("beginner") ||
    normalized.includes("intro") ||
    normalized.includes("foundations")
  ) {
    return "beginner";
  }
  if (
    normalized.includes("advanced") ||
    normalized.includes("masterclass") ||
    normalized.includes("expert")
  ) {
    return "advanced";
  }
  if (
    normalized.includes("intermediate") ||
    normalized.includes("next step") ||
    normalized.includes("level 2")
  ) {
    return "intermediate";
  }
  return "all-levels";
}

function inferTechniquesFromText(value: string, includesFiring: boolean): TechniqueId[] {
  const normalized = value.toLowerCase();
  const matches = TECHNIQUE_TAXONOMY
    .filter((technique) => technique.keywords.some((keyword) => normalized.includes(keyword)))
    .map((technique) => technique.id);

  if (includesFiring && !matches.includes("glazing-firing")) {
    matches.push("glazing-firing");
  }

  if (matches.length === 0) {
    matches.push("studio-practice");
  }

  return [...new Set(matches)];
}

function parseTechniqueIds(input: string): TechniqueId[] {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return ["studio-practice"];
  return inferTechniquesFromText(normalized, normalized.includes("firing") || normalized.includes("kiln"));
}

function navigateToCommunityNav(
  navKey: "lendingLibrary",
  handoff?: { search?: string; focusTechnique?: string; source?: string }
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_NAV_KEY, navKey);
    window.localStorage.setItem(LOCAL_NAV_SECTION_KEY, "community");
    if (handoff) {
      window.localStorage.setItem(
        LENDING_HANDOFF_STORAGE_SLOT,
        JSON.stringify({
          search: handoff.search ?? "",
          focusTechnique: handoff.focusTechnique ?? "",
          source: handoff.source ?? "workshops-learning-pathway",
          atIso: new Date().toISOString(),
        })
      );
    }
  } catch {
    // Ignore storage failures and continue with soft reload.
  }
  window.location.assign(window.location.pathname);
}

export default function EventsView({ user, adminToken, isStaff }: Props) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [industryEvents, setIndustryEvents] = useState<IndustryEventSummary[]>([]);
  const [industryEventsLoading, setIndustryEventsLoading] = useState(false);
  const [industryEventsError, setIndustryEventsError] = useState("");
  const [industrySearch, setIndustrySearch] = useState("");
  const [industryModeFilter, setIndustryModeFilter] = useState<IndustryModeFilter>("all");
  const [industryEditorId, setIndustryEditorId] = useState<string>("new");
  const [industryDraft, setIndustryDraft] = useState<IndustryEventDraft>(() => toIndustryEventDraft());
  const [industryEditorBusy, setIndustryEditorBusy] = useState(false);
  const [industryEditorStatus, setIndustryEditorStatus] = useState("");
  const [industrySweepBusy, setIndustrySweepBusy] = useState(false);
  const [industrySweepStatus, setIndustrySweepStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [signup, setSignup] = useState<EventSignupSummary | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [status, setStatus] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [roster, setRoster] = useState<EventSignupRosterEntry[]>([]);
  const [rosterSearch, setRosterSearch] = useState("");
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>("all");
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [rosterIncludeCancelled, setRosterIncludeCancelled] = useState(false);
  const [rosterIncludeExpired, setRosterIncludeExpired] = useState(false);
  const [rosterBusyIds, setRosterBusyIds] = useState<Record<string, boolean>>({});
  const [memberTechniqueFocus, setMemberTechniqueFocus] = useState<TechniqueId | "any">("any");
  const [memberLevelFocus, setMemberLevelFocus] = useState<RequestLevel>("all-levels");
  const [memberScheduleFocus, setMemberScheduleFocus] = useState<MemberSchedule>("any");
  const [buddyMode, setBuddyMode] = useState<BuddyMode>("solo");
  const [buddyCircleName, setBuddyCircleName] = useState("");
  const [interestedEventIds, setInterestedEventIds] = useState<Record<string, boolean>>({});
  const [interestSignalsSent, setInterestSignalsSent] = useState<Record<string, boolean>>({});
  const [interestBusy, setInterestBusy] = useState(false);
  const [interestStatus, setInterestStatus] = useState("");
  const [showcaseNote, setShowcaseNote] = useState("");
  const [showcaseBusy, setShowcaseBusy] = useState(false);
  const [showcaseStatus, setShowcaseStatus] = useState("");
  const [demandSignals, setDemandSignals] = useState<WorkshopDemandSignal[]>([]);
  const [requestTechnique, setRequestTechnique] = useState("");
  const [requestLevel, setRequestLevel] = useState<RequestLevel>("all-levels");
  const [requestSchedule, setRequestSchedule] = useState<RequestSchedule>("weekday-evening");
  const [requestNote, setRequestNote] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestStatus, setRequestStatus] = useState("");
  const [requestSource, setRequestSource] = useState<WorkshopRequestEntry["source"]>("events-request-form");
  const [workshopRequestLedger, setWorkshopRequestLedger] = useState<WorkshopRequestEntry[]>(() =>
    loadWorkshopRequestLedger(user.uid)
  );
  const [staffCurationConfig, setStaffCurationConfig] = useState<WorkshopCurationConfig>(() =>
    loadWorkshopCurationConfig()
  );
  const [staffCurationDraft, setStaffCurationDraft] = useState<WorkshopCurationDraft>(() =>
    curationConfigToDraft(loadWorkshopCurationConfig())
  );
  const requestCardRef = useRef<HTMLElement | null>(null);
  const railTelemetrySignatureRef = useRef("");

  const baseUrl = useMemo(() => resolveFunctionsBaseUrl(), []);
  const hasAdmin = isStaff || !!adminToken?.trim();

  const client = useMemo(() => {
    return createFunctionsClient({
      baseUrl,
      getIdToken: async () => await user.getIdToken(),
      getAdminToken: () => adminToken,
    });
  }, [adminToken, baseUrl, user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get("status");
    if (statusParam === "success") {
      setStatus("Payment received - thanks for supporting the event.");
    } else if (statusParam === "cancel") {
      setStatus("Checkout canceled. You can complete payment after check-in.");
    }
  }, []);

  useEffect(() => {
    if (!detail || signup?.status !== "checked_in") {
      setSelectedAddOns([]);
    }
  }, [detail, signup?.status]);

  useEffect(() => {
    writeWorkshopCurationConfig(staffCurationConfig);
    setStaffCurationDraft(curationConfigToDraft(staffCurationConfig));
  }, [staffCurationConfig]);

  useEffect(() => {
    setWorkshopRequestLedger(loadWorkshopRequestLedger(user.uid));
  }, [user.uid]);

  useEffect(() => {
    writeWorkshopRequestLedger(user.uid, workshopRequestLedger);
  }, [user.uid, workshopRequestLedger]);

  const filteredEvents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return events;
    return events.filter((event) => {
      return (
        event.title.toLowerCase().includes(term) ||
        event.summary.toLowerCase().includes(term)
      );
    });
  }, [events, search]);

  const industryModeCounts = useMemo(() => {
    const counts: Record<IndustryModeFilter, number> = {
      all: 0,
      local: 0,
      remote: 0,
      hybrid: 0,
    };
    industryEvents.forEach((event) => {
      counts.all += 1;
      if (event.mode === "local" || event.mode === "remote" || event.mode === "hybrid") {
        counts[event.mode] += 1;
      }
    });
    return counts;
  }, [industryEvents]);

  const industryNeedsReviewCount = useMemo(
    () => industryEvents.filter((event) => event.needsReview === true).length,
    [industryEvents]
  );

  const filteredIndustryEvents = useMemo(() => {
    return filterIndustryBrowseEvents(industryEvents, {
      mode: industryModeFilter,
      search: industrySearch,
    });
  }, [industryEvents, industryModeFilter, industrySearch]);

  const featuredIndustryEvents = useMemo(
    () => filteredIndustryEvents.filter((event) => event.featured).slice(0, 3),
    [filteredIndustryEvents]
  );

  const curationIndustryEvents = useMemo(() => {
    return [...industryEvents].sort((left, right) => left.title.localeCompare(right.title));
  }, [industryEvents]);

  const selectedSummary = useMemo(
    () => events.find((event) => event.id === selectedId) || null,
    [events, selectedId]
  );

  const activeAddOns = useMemo(() => {
    return (detail?.addOns ?? []).filter((addOn) => addOn.isActive);
  }, [detail]);

  const addOnMap = useMemo(() => {
    const map = new Map<string, { priceCents: number; title: string }>();
    activeAddOns.forEach((addOn) => map.set(addOn.id, { priceCents: addOn.priceCents, title: addOn.title }));
    return map;
  }, [activeAddOns]);

  const addOnTotalCents = useMemo(() => {
    return selectedAddOns.reduce((total, id) => total + (addOnMap.get(id)?.priceCents ?? 0), 0);
  }, [addOnMap, selectedAddOns]);

  const filteredRoster = useMemo(() => {
    const term = rosterSearch.trim().toLowerCase();
    return roster.filter((row) => {
      if (rosterFilter !== "all" && row.status !== rosterFilter) return false;
      if (!term) return true;
      const haystack = `${row.displayName ?? ""} ${row.email ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [roster, rosterFilter, rosterSearch]);

  const rosterCounts = useMemo(() => buildRosterCounts(roster), [roster]);

  const profiledEvents = useMemo<ProfiledWorkshop[]>(() => {
    return events.map((event) => {
      const content = `${event.title} ${event.summary} ${event.firingDetails ?? ""}`.toLowerCase();
      return {
        event,
        techniqueIds: inferTechniquesFromText(content, event.includesFiring),
        inferredLevel: guessLevel(content),
        scheduleBucket: guessScheduleBucket(event.startAt),
        startAtMs: toStartTimeMs(event.startAt),
      };
    });
  }, [events]);

  const profiledById = useMemo(() => {
    const map = new Map<string, ProfiledWorkshop>();
    profiledEvents.forEach((row) => map.set(row.event.id, row));
    return map;
  }, [profiledEvents]);

  const selectedProfile = useMemo(
    () => (selectedId ? profiledById.get(selectedId) ?? null : null),
    [selectedId, profiledById]
  );

  const filteredEventIds = useMemo(() => new Set(filteredEvents.map((event) => event.id)), [filteredEvents]);

  const discoverableProfiles = useMemo(() => {
    return profiledEvents.filter((row) => filteredEventIds.has(row.event.id));
  }, [filteredEventIds, profiledEvents]);

  const recommendationRows = useMemo(() => {
    const now = Date.now();
    const selectedTechniqueSet = new Set(selectedProfile?.techniqueIds ?? []);

    return discoverableProfiles
      .map((row) => {
        let score = row.event.status === "published" ? 10 : -10;

        if (typeof row.event.remainingCapacity === "number") {
          if (row.event.remainingCapacity === 0) {
            score += row.event.waitlistEnabled ? 1 : -8;
          } else if (row.event.remainingCapacity <= 3) {
            score += 2;
          } else {
            score += 3;
          }
        }

        if (memberTechniqueFocus !== "any") {
          score += row.techniqueIds.includes(memberTechniqueFocus) ? 8 : -4;
        }

        if (memberLevelFocus !== "all-levels") {
          score +=
            row.inferredLevel === memberLevelFocus || row.inferredLevel === "all-levels"
              ? 5
              : -3;
        }

        if (memberScheduleFocus !== "any") {
          score += row.scheduleBucket === memberScheduleFocus ? 4 : -2;
        }

        if (selectedTechniqueSet.size > 0 && row.event.id !== selectedId) {
          score += row.techniqueIds.some((id) => selectedTechniqueSet.has(id)) ? 2 : 0;
        }

        if (interestedEventIds[row.event.id]) {
          score += 5;
        }

        if (row.startAtMs !== null) {
          const deltaDays = (row.startAtMs - now) / (1000 * 60 * 60 * 24);
          if (deltaDays < -1) score -= 20;
          if (deltaDays >= 0 && deltaDays <= 10) score += 4;
          if (deltaDays > 10 && deltaDays <= 28) score += 2;
        }

        return { row, score };
      })
      .sort((left, right) => right.score - left.score);
  }, [
    discoverableProfiles,
    interestedEventIds,
    memberLevelFocus,
    memberScheduleFocus,
    memberTechniqueFocus,
    selectedId,
    selectedProfile?.techniqueIds,
  ]);

  const recommendedRail = useMemo(
    () => recommendationRows.slice(0, 6).map((entry) => entry.row),
    [recommendationRows]
  );

  const beginnerRail = useMemo(() => {
    const configuredTechniques = new Set(staffCurationConfig.beginner);
    return discoverableProfiles
      .filter(
        (row) =>
          row.inferredLevel === "beginner" ||
          row.inferredLevel === "all-levels" ||
          row.techniqueIds.some((id) => configuredTechniques.has(id))
      )
      .sort((left, right) => {
        if (left.startAtMs === null && right.startAtMs === null) return 0;
        if (left.startAtMs === null) return 1;
        if (right.startAtMs === null) return -1;
        return left.startAtMs - right.startAtMs;
      })
      .slice(0, 5);
  }, [discoverableProfiles, staffCurationConfig.beginner]);

  const techniqueIntensiveRail = useMemo(() => {
    const configuredTechniques = new Set(staffCurationConfig.intensives);
    return discoverableProfiles
      .filter((row) => row.techniqueIds.some((id) => configuredTechniques.has(id)))
      .slice(0, 5);
  }, [discoverableProfiles, staffCurationConfig.intensives]);

  const seasonalRail = useMemo(() => {
    const configuredSchedules = new Set(staffCurationConfig.seasonal);
    return discoverableProfiles
      .filter((row) => configuredSchedules.has(row.scheduleBucket))
      .slice(0, 5);
  }, [discoverableProfiles, staffCurationConfig.seasonal]);

  const ifYouLikedRail = useMemo(() => {
    if (!selectedProfile) return [];
    const selectedTechniqueSet = new Set(selectedProfile.techniqueIds);
    return discoverableProfiles
      .filter((row) => row.event.id !== selectedProfile.event.id)
      .filter((row) => row.techniqueIds.some((id) => selectedTechniqueSet.has(id)))
      .sort((left, right) => {
        const leftTime = left.startAtMs ?? Number.POSITIVE_INFINITY;
        const rightTime = right.startAtMs ?? Number.POSITIVE_INFINITY;
        return leftTime - rightTime;
      })
      .slice(0, 4);
  }, [discoverableProfiles, selectedProfile]);

  const recommendationRails = useMemo(() => {
    const rails: Array<{
      id: string;
      title: string;
      description: string;
      rows: ProfiledWorkshop[];
    }> = [
      {
        id: "member-recommendations",
        title: "Recommended for you",
        description: "Prioritized from your current level, schedule, and technique focus.",
        rows: recommendedRail,
      },
      {
        id: "curated-beginner-runway",
        title: "Staff curation: beginner runway",
        description: "Low-pressure entries that build consistent studio confidence.",
        rows: beginnerRail,
      },
      {
        id: "curated-technique-intensives",
        title: "Staff curation: technique intensives",
        description: "Focused sessions to accelerate one specific clay skill.",
        rows: techniqueIntensiveRail,
      },
      {
        id: "curated-seasonal",
        title: "Staff curation: seasonal community picks",
        description: "Weekend-friendly sessions tuned for shared studio energy.",
        rows: seasonalRail,
      },
      {
        id: "if-you-liked-this",
        title: "If you liked this, try this next",
        description: "Technique-adjacent progression from your currently selected workshop.",
        rows: ifYouLikedRail,
      },
    ];

    return rails.filter((rail) => rail.rows.length > 0);
  }, [beginnerRail, ifYouLikedRail, recommendedRail, seasonalRail, techniqueIntensiveRail]);

  useEffect(() => {
    const signature = recommendationRails
      .map((rail) => `${rail.id}:${rail.rows.map((row) => row.event.id).join(",")}`)
      .join("|");
    if (signature === railTelemetrySignatureRef.current) return;
    railTelemetrySignatureRef.current = signature;
    track("workshops_rails_rendered", {
      railCount: recommendationRails.length,
      railSummary: recommendationRails
        .map((rail) => `${rail.id}:${rail.rows.length}`)
        .join("|"),
      memberTechniqueFocus,
      memberLevelFocus,
      memberScheduleFocus,
    });
  }, [memberLevelFocus, memberScheduleFocus, memberTechniqueFocus, recommendationRails]);

  const selectedTechniqueResources = useMemo(() => {
    if (!selectedProfile) return [];
    return selectedProfile.techniqueIds
      .map((id) => techniqueById(id))
      .filter((value): value is (typeof TECHNIQUE_TAXONOMY)[number] => !!value);
  }, [selectedProfile]);

  const focusedTechniqueMatches = useMemo(() => {
    if (memberTechniqueFocus === "any") return true;
    return profiledEvents.some(
      (row) => row.event.status === "published" && row.techniqueIds.includes(memberTechniqueFocus)
    );
  }, [memberTechniqueFocus, profiledEvents]);

  const selectedCapacity = detail?.capacity ?? selectedSummary?.capacity ?? 0;
  const selectedRemaining = selectedSummary?.remainingCapacity;
  const selectedFilledSeats =
    typeof selectedRemaining === "number"
      ? Math.max(selectedCapacity - selectedRemaining, 0)
      : Math.max(rosterCounts.ticketed + rosterCounts.offered + rosterCounts.checked_in, 0);
  const selectedFillRatio =
    selectedCapacity > 0 ? Math.max(0, Math.min(selectedFilledSeats / selectedCapacity, 1)) : 0;
  const selectedWaitlistPressure = hasAdmin
    ? rosterCounts.waitlisted
    : selectedRemaining === 0 && detail?.waitlistEnabled
      ? Math.max(Math.round(selectedCapacity * 0.18), 1)
      : 0;
  const momentumScore = Math.max(
    0,
    Math.min(100, Math.round(selectedFillRatio * 72 + Math.min(selectedWaitlistPressure * 8, 28)))
  );
  const momentumTone = momentumScore >= 72 ? "high" : momentumScore >= 44 ? "medium" : "steady";
  const momentumLabel =
    momentumTone === "high"
      ? "High momentum"
      : momentumTone === "medium"
        ? "Building momentum"
        : "Steady momentum";
  const selectedIsInterested = selectedSummary ? !!interestedEventIds[selectedSummary.id] : false;
  const selectedInterestSignals = selectedSummary
    ? demandSignals.filter((signal) => signal.kind === "interest" && signal.sourceEventId === selectedSummary.id)
        .length
    : 0;
  const projectedInterestCount = selectedIsInterested ? selectedInterestSignals + 1 : selectedInterestSignals;

  const buddyIntentCount = demandSignals.filter(
    (signal) => signal.kind === "interest" && signal.buddyMode !== "solo"
  ).length;
  const circleIntentCount = demandSignals.filter(
    (signal) => signal.kind === "interest" && signal.buddyMode === "circle"
  ).length;

  const demandClusters = useMemo<DemandCluster[]>(() => {
    const aggregate = new Map<
      TechniqueId,
      {
        techniqueId: TechniqueId;
        label: string;
        requestCount: number;
        interestCount: number;
        waitlistSignals: number;
        supplyCount: number;
        levelCounts: Record<RequestLevel, number>;
        scheduleCounts: Record<RequestSchedule, number>;
      }
    >();

    const ensure = (techniqueId: TechniqueId) => {
      const current = aggregate.get(techniqueId);
      if (current) return current;

      const next = {
        techniqueId,
        label: techniqueById(techniqueId)?.label ?? "Studio practice",
        requestCount: 0,
        interestCount: 0,
        waitlistSignals: 0,
        supplyCount: 0,
        levelCounts: {
          "all-levels": 0,
          beginner: 0,
          intermediate: 0,
          advanced: 0,
        },
        scheduleCounts: {
          "weekday-evening": 0,
          "weekday-daytime": 0,
          "weekend-morning": 0,
          "weekend-afternoon": 0,
          flexible: 0,
        },
      };
      aggregate.set(techniqueId, next);
      return next;
    };

    const now = Date.now();
    profiledEvents.forEach((row) => {
      if (row.event.status !== "published") return;
      if (row.startAtMs !== null && row.startAtMs < now) return;

      row.techniqueIds.forEach((techniqueId) => {
        ensure(techniqueId).supplyCount += 1;
      });

      if (row.event.waitlistEnabled && row.event.remainingCapacity === 0) {
        row.techniqueIds.forEach((techniqueId) => {
          ensure(techniqueId).waitlistSignals += 1;
        });
      } else if (typeof row.event.remainingCapacity === "number" && row.event.remainingCapacity <= 2) {
        row.techniqueIds.forEach((techniqueId) => {
          ensure(techniqueId).waitlistSignals += 0.5;
        });
      }
    });

    demandSignals.forEach((signal) => {
      signal.techniqueIds.forEach((techniqueId) => {
        const row = ensure(techniqueId);
        if (signal.kind === "request") {
          row.requestCount += 1;
        } else {
          row.interestCount += 1;
          if (signal.buddyMode === "buddy") row.interestCount += 0.25;
          if (signal.buddyMode === "circle") row.interestCount += 0.5;
        }
        row.levelCounts[signal.level] += 1;
        row.scheduleCounts[signal.schedule] += 1;
      });
    });

    workshopRequestLedger.forEach((entry) => {
      entry.techniqueIds.forEach((techniqueId) => {
        const row = ensure(techniqueId);
        row.requestCount += 1;
        row.levelCounts[entry.level] += 1;
        row.scheduleCounts[entry.schedule] += 1;
      });
    });

    if (selectedProfile && rosterCounts.waitlisted > 0) {
      selectedProfile.techniqueIds.forEach((techniqueId) => {
        ensure(techniqueId).waitlistSignals += Math.max(1, Math.round(rosterCounts.waitlisted / 2));
      });
    }

    return Array.from(aggregate.values())
      .map((item) => {
        const demandScore = Math.round(
          item.requestCount * 3 + item.interestCount * 2 + item.waitlistSignals * 2
        );
        const gapScore = demandScore - item.supplyCount * 2;
        return {
          techniqueId: item.techniqueId,
          label: item.label,
          requestCount: item.requestCount,
          interestCount: item.interestCount,
          waitlistSignals: item.waitlistSignals,
          supplyCount: item.supplyCount,
          demandScore,
          gapScore,
          recommendedLevel: topRecordKey(item.levelCounts, "all-levels"),
          recommendedSchedule: topRecordKey(item.scheduleCounts, "weekday-evening"),
        } satisfies DemandCluster;
      })
      .filter((item) => item.demandScore > 0 || item.supplyCount > 0)
      .sort((left, right) => {
        if (right.gapScore !== left.gapScore) return right.gapScore - left.gapScore;
        return right.demandScore - left.demandScore;
      })
      .slice(0, 6);
  }, [demandSignals, profiledEvents, rosterCounts.waitlisted, selectedProfile, workshopRequestLedger]);

  const staffDemandKpis = useMemo(() => {
    const constrainedSessions = profiledEvents.filter((row) => {
      if (row.event.status !== "published") return false;
      return typeof row.event.remainingCapacity === "number" && row.event.remainingCapacity <= 2;
    }).length;

    return {
      trackedSignals: demandSignals.length + workshopRequestLedger.length,
      activeInterests: Object.values(interestedEventIds).filter(Boolean).length,
      constrainedSessions,
      highestDemandGap: demandClusters[0]?.gapScore ?? 0,
    };
  }, [demandClusters, demandSignals.length, interestedEventIds, profiledEvents, workshopRequestLedger.length]);

  const memberWorkshopRequests = useMemo(() => {
    return workshopRequestLedger
      .filter((entry) => entry.uid === user.uid)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 8);
  }, [user.uid, workshopRequestLedger]);

  const requestTriageClusters = useMemo<RequestTriageCluster[]>(() => {
    const aggregate = new Map<string, RequestTriageCluster>();

    workshopRequestLedger.forEach((entry) => {
      const clusterKey = normalizeTechniqueKey(entry.techniqueLabel);
      const existing = aggregate.get(clusterKey);
      if (!existing) {
        aggregate.set(clusterKey, {
          clusterKey,
          techniqueLabel: entry.techniqueLabel,
          requestCount: 1,
          statuses: {
            new: entry.status === "new" ? 1 : 0,
            reviewing: entry.status === "reviewing" ? 1 : 0,
            planned: entry.status === "planned" ? 1 : 0,
            scheduled: entry.status === "scheduled" ? 1 : 0,
            declined: entry.status === "declined" ? 1 : 0,
          },
          latestCreatedAt: entry.createdAt,
          recommendedLevel: entry.level,
          recommendedSchedule: entry.schedule,
          priorityScore: 0,
          topTicketIds: [entry.ticketId].filter(Boolean),
        });
        return;
      }

      existing.requestCount += 1;
      existing.statuses[entry.status] += 1;
      existing.latestCreatedAt = Math.max(existing.latestCreatedAt, entry.createdAt);
      if (entry.createdAt >= existing.latestCreatedAt) {
        existing.recommendedLevel = entry.level;
        existing.recommendedSchedule = entry.schedule;
      }
      if (entry.ticketId && existing.topTicketIds.length < 5 && !existing.topTicketIds.includes(entry.ticketId)) {
        existing.topTicketIds.push(entry.ticketId);
      }
    });

    return Array.from(aggregate.values())
      .map((cluster) => {
        const priorityScore =
          cluster.statuses.new * 5 +
          cluster.statuses.reviewing * 4 +
          cluster.statuses.planned * 3 +
          cluster.statuses.scheduled * 2 -
          cluster.statuses.declined;
        return {
          ...cluster,
          priorityScore,
        };
      })
      .sort((left, right) => {
        if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
        return right.latestCreatedAt - left.latestCreatedAt;
      })
      .slice(0, 8);
  }, [workshopRequestLedger]);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError("");

    try {
      const resp = await client.postJson<ListEventsResponse>("listEvents", {
        includeDrafts: hasAdmin ? includeDrafts : false,
        includeCancelled: hasAdmin ? includeCancelled : false,
      });

      const nextEvents = resp.events ?? [];
      setEvents(nextEvents);
      setSelectedId((prev) => {
        if (prev && nextEvents.some((event) => event.id === prev)) return prev;
        return nextEvents[0]?.id ?? null;
      });
    } catch (error: unknown) {
      setEventsError(getErrorMessage(error));
    } finally {
      setEventsLoading(false);
    }
  }, [client, hasAdmin, includeDrafts, includeCancelled]);

  const loadIndustryEvents = useCallback(async () => {
    setIndustryEventsLoading(true);
    setIndustryEventsError("");

    try {
      const resp = await client.postJson<ListIndustryEventsResponse>("listIndustryEvents", {
        mode: "all",
        includePast: false,
        includeDrafts: hasAdmin ? true : false,
        includeCancelled: hasAdmin ? true : false,
        limit: 120,
      });
      setIndustryEvents(resp.events ?? []);
    } catch (error: unknown) {
      setIndustryEventsError(getErrorMessage(error));
    } finally {
      setIndustryEventsLoading(false);
    }
  }, [client, hasAdmin]);

  const loadDetail = useCallback(async (eventId: string) => {
    setDetailLoading(true);
    setDetailError("");

    try {
      const resp = await client.postJson<GetEventResponse>("getEvent", { eventId });
      setDetail(resp.event);
      setSignup(resp.signup ?? null);
    } catch (error: unknown) {
      setDetailError(getErrorMessage(error));
      setDetail(null);
      setSignup(null);
    } finally {
      setDetailLoading(false);
    }
  }, [client]);

  const loadRoster = useCallback(async (eventId: string) => {
    if (!hasAdmin) {
      setRoster([]);
      return;
    }

    setRosterLoading(true);
    setRosterError("");

    try {
      const resp = await client.postJson<ListEventSignupsResponse>("listEventSignups", {
        eventId,
        includeCancelled: rosterIncludeCancelled,
        includeExpired: rosterIncludeExpired,
        limit: 300,
      });
      setRoster(resp.signups ?? []);
    } catch (error: unknown) {
      setRosterError(getErrorMessage(error));
    } finally {
      setRosterLoading(false);
    }
  }, [client, hasAdmin, rosterIncludeCancelled, rosterIncludeExpired]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    void loadIndustryEvents();
  }, [loadIndustryEvents]);

  useEffect(() => {
    if (industryEditorId === "new") return;
    const exists = curationIndustryEvents.some((event) => event.id === industryEditorId);
    if (exists) return;
    setIndustryEditorId("new");
    setIndustryDraft(toIndustryEventDraft());
  }, [curationIndustryEvents, industryEditorId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setSignup(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!selectedId || !hasAdmin) {
      setRoster([]);
      return;
    }
    void loadRoster(selectedId);
  }, [selectedId, hasAdmin, loadRoster]);

  useEffect(() => {
    setInterestStatus("");
    setShowcaseStatus("");
  }, [selectedId]);

  const refreshAll = useCallback(async () => {
    if (!selectedId) {
      await Promise.all([loadEvents(), loadIndustryEvents()]);
      return;
    }

    await Promise.all([
      loadEvents(),
      loadIndustryEvents(),
      loadDetail(selectedId),
      hasAdmin ? loadRoster(selectedId) : Promise.resolve(),
    ]);
  }, [selectedId, hasAdmin, loadEvents, loadIndustryEvents, loadDetail, loadRoster]);

  const recordDemandSignal = useCallback((signal: WorkshopDemandSignal) => {
    setDemandSignals((prev) => [signal, ...prev].slice(0, 160));
  }, []);

  const submitWorkshopSupportSignal = useCallback(
    async (subject: string, lines: string[]) => {
      const body = lines.filter((line) => line.trim().length > 0).join("\n");
      const docRef = await addDoc(collection(db, "supportRequests"), {
        uid: user.uid,
        subject,
        body,
        category: "Workshops",
        status: "new",
        urgency: "non-urgent",
        channel: "portal",
        createdAt: serverTimestamp(),
        displayName: user.displayName || null,
        email: user.email || null,
      });
      return docRef.id;
    },
    [user.displayName, user.email, user.uid]
  );

  const focusRequestForm = useCallback(
    (defaults?: {
      technique?: string;
      level?: RequestLevel;
      schedule?: RequestSchedule;
      source?: WorkshopRequestEntry["source"];
    }) => {
      if (defaults?.technique) {
        setRequestTechnique(defaults.technique);
      }
      if (defaults?.level) {
        setRequestLevel(defaults.level);
      }
      if (defaults?.schedule) {
        setRequestSchedule(defaults.schedule);
      }
      if (defaults?.source) {
        setRequestSource(defaults.source);
      }
      requestCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    []
  );

  const handleClusterPrefill = useCallback(
    (cluster: DemandCluster) => {
      focusRequestForm({
        technique: cluster.label,
        level: cluster.recommendedLevel,
        schedule: cluster.recommendedSchedule,
        source: "cluster-routing",
      });
      setRequestStatus(
        `Loaded "${cluster.label}" into request intake so you can route this cluster to program ops.`
      );
    },
    [focusRequestForm]
  );

  const handleOpenLendingBridge = useCallback((techniqueLabel?: string) => {
    const search = typeof techniqueLabel === "string" ? techniqueLabel.trim() : "";
    navigateToCommunityNav("lendingLibrary", {
      search,
      focusTechnique: search,
      source: "workshops-technique-pathway",
    });
  }, []);

  const handleRequestLifecycleChange = useCallback(
    (requestId: string, nextStatus: WorkshopRequestLifecycleStatus) => {
      setWorkshopRequestLedger((prev): WorkshopRequestEntry[] =>
        prev.map((entry): WorkshopRequestEntry => {
          if (entry.id !== requestId) return entry;
          return {
            ...entry,
            status: nextStatus,
            updatedAt: Date.now(),
          };
        })
      );
      setRequestStatus(`Updated request to ${requestStatusLabel(nextStatus)}.`);
      track("workshops_request_status_updated", {
        requestId,
        status: nextStatus,
      });
    },
    []
  );

  const handleClusterLifecycleChange = useCallback(
    (clusterKey: string, nextStatus: WorkshopRequestLifecycleStatus) => {
      let changedCount = 0;
      setWorkshopRequestLedger((prev): WorkshopRequestEntry[] =>
        prev.map((entry): WorkshopRequestEntry => {
          if (normalizeTechniqueKey(entry.techniqueLabel) !== clusterKey) return entry;
          if (entry.status === "scheduled" || entry.status === "declined") return entry;
          changedCount += 1;
          return {
            ...entry,
            status: nextStatus,
            updatedAt: Date.now(),
          };
        })
      );
      setRequestStatus(
        changedCount > 0
          ? `Updated ${changedCount} request${changedCount === 1 ? "" : "s"} to ${requestStatusLabel(nextStatus)}.`
          : "No open requests needed status updates in that cluster."
      );
      track("workshops_cluster_status_updated", {
        clusterKey,
        changedCount,
        status: nextStatus,
      });
    },
    []
  );

  const handleExportDemandBrief = useCallback(() => {
    if (typeof window === "undefined") return;
    const dateLabel = new Date().toISOString().slice(0, 10);
    const lines = [
      `Workshop demand brief (${dateLabel})`,
      "",
      "Technique demand clusters:",
      ...demandClusters.map(
        (cluster) =>
          `- ${cluster.label}: demand ${cluster.demandScore}, gap ${cluster.gapScore}, supply ${cluster.supplyCount}, suggested ${levelLabelFor(cluster.recommendedLevel)} / ${scheduleLabelFor(cluster.recommendedSchedule)}`
      ),
      "",
      "Request lifecycle triage:",
      ...requestTriageClusters.map(
        (cluster) =>
          `- ${cluster.techniqueLabel}: requests ${cluster.requestCount}, new ${cluster.statuses.new}, reviewing ${cluster.statuses.reviewing}, planned ${cluster.statuses.planned}, scheduled ${cluster.statuses.scheduled}, declined ${cluster.statuses.declined}`
      ),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `workshop-demand-brief-${dateLabel}.txt`;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    setStatus("Exported workshop demand brief.");
    track("workshops_demand_brief_exported", {
      demandClusterCount: demandClusters.length,
      triageClusterCount: requestTriageClusters.length,
    });
  }, [demandClusters, requestTriageClusters]);

  const handleApplyStaffCuration = useCallback(() => {
    const beginner = parseCsvList(staffCurationDraft.beginnerCsv).filter(
      (entry): entry is TechniqueId => TECHNIQUE_ID_SET.has(entry as TechniqueId)
    );
    const intensives = parseCsvList(staffCurationDraft.intensivesCsv).filter(
      (entry): entry is TechniqueId => TECHNIQUE_ID_SET.has(entry as TechniqueId)
    );
    const seasonal = parseCsvList(staffCurationDraft.seasonalCsv).filter(
      (entry): entry is RequestSchedule => REQUEST_SCHEDULE_SET.has(entry as RequestSchedule)
    );
    const nextConfig = sanitizeWorkshopCurationConfig({
      beginner,
      intensives,
      seasonal,
    });
    setStaffCurationConfig(nextConfig);
    setStatus("Updated staff curation rails.");
    track("workshops_staff_curation_updated", {
      beginnerCount: nextConfig.beginner.length,
      intensivesCount: nextConfig.intensives.length,
      seasonalCount: nextConfig.seasonal.length,
    });
  }, [staffCurationDraft.beginnerCsv, staffCurationDraft.intensivesCsv, staffCurationDraft.seasonalCsv]);

  const handleResetStaffCuration = useCallback(() => {
    setStaffCurationConfig(DEFAULT_WORKSHOP_CURATION_CONFIG);
    setStatus("Reset staff curation rails to defaults.");
  }, []);

  const handleSelectRailEvent = useCallback(
    (railId: string, row: ProfiledWorkshop) => {
      setSelectedId(row.event.id);
      track("workshops_rail_event_selected", {
        railId,
        eventId: row.event.id,
        level: row.inferredLevel,
        schedule: row.scheduleBucket,
        techniques: row.techniqueIds.join(","),
      });
    },
    []
  );

  const handleInterestToggle = useCallback(async () => {
    if (!selectedSummary) return;

    const eventId = selectedSummary.id;
    const nextInterested = !interestedEventIds[eventId];
    setInterestedEventIds((prev) => ({ ...prev, [eventId]: nextInterested }));

    if (!nextInterested) {
      setDemandSignals((prev) =>
        prev.filter((signal) => !(signal.kind === "interest" && signal.sourceEventId === eventId))
      );
      if (!interestSignalsSent[eventId] || interestBusy) {
        setInterestStatus("Interest removed for this workshop.");
        return;
      }

      setInterestBusy(true);
      try {
        await submitWorkshopSupportSignal(`Workshop interest withdrawn: ${selectedSummary.title}`, [
          `Event id: ${selectedSummary.id}`,
          `Workshop: ${selectedSummary.title}`,
          "Reason: member toggled off interest",
        ]);
        setInterestSignalsSent((prev) => ({ ...prev, [eventId]: false }));
        setInterestStatus("Interest removed and staff was notified to adjust demand signals.");
      } catch (error: unknown) {
        setInterestStatus(requestErrorMessage(error));
      } finally {
        setInterestBusy(false);
      }
      return;
    }

    setInterestStatus("Interest saved locally for recommendations.");
    if (interestSignalsSent[eventId] || interestBusy) return;

    setInterestBusy(true);
    try {
      const profile = profiledById.get(eventId);
      const techniqueIds = profile?.techniqueIds ?? parseTechniqueIds(selectedSummary.title);
      const techniqueLabel = techniqueIds
        .map((techniqueId) => techniqueById(techniqueId)?.label ?? "Studio practice")
        .join(", ");
      const buddyLine =
        buddyMode === "circle" && buddyCircleName.trim()
          ? `Buddy mode: circle (${buddyCircleName.trim()})`
          : `Buddy mode: ${buddyMode}`;

      await submitWorkshopSupportSignal(
        `Workshop interest: ${selectedSummary.title}`,
        [
          `Event id: ${selectedSummary.id}`,
          `Workshop: ${selectedSummary.title}`,
          `Technique focus: ${techniqueLabel}`,
          `Member level focus: ${memberLevelFocus}`,
          `Member schedule focus: ${memberScheduleFocus}`,
          buddyLine,
        ]
      );

      setInterestSignalsSent((prev) => ({ ...prev, [eventId]: true }));
      recordDemandSignal({
        id: makeSignalId("interest"),
        kind: "interest",
        techniqueIds,
        techniqueLabel,
        level: memberLevelFocus,
        schedule: memberScheduleFocus === "any" ? "weekday-evening" : memberScheduleFocus,
        buddyMode,
        createdAt: Date.now(),
        sourceEventId: selectedSummary.id,
      });

      setInterestStatus("Interest sent. Staff can now see this signal in demand intelligence.");
    } catch (error: unknown) {
      setInterestedEventIds((prev) => ({ ...prev, [eventId]: false }));
      setInterestStatus(requestErrorMessage(error));
    } finally {
      setInterestBusy(false);
    }
  }, [
    buddyCircleName,
    buddyMode,
    interestBusy,
    interestSignalsSent,
    interestedEventIds,
    memberLevelFocus,
    memberScheduleFocus,
    profiledById,
    recordDemandSignal,
    selectedSummary,
    submitWorkshopSupportSignal,
  ]);

  const handleSubmitShowcaseFollowup = useCallback(async () => {
    if (!selectedSummary || showcaseBusy) return;
    const note = showcaseNote.trim();
    if (!note) {
      setShowcaseStatus("Add a short outcome note before sending a showcase follow-up.");
      return;
    }

    setShowcaseBusy(true);
    setShowcaseStatus("");
    try {
      await submitWorkshopSupportSignal(`Workshop showcase follow-up: ${selectedSummary.title}`, [
        `Event id: ${selectedSummary.id}`,
        `Workshop: ${selectedSummary.title}`,
        `Outcome note: ${note}`,
        `Buddy mode at submit: ${buddyMode}`,
      ]);
      setShowcaseStatus("Showcase follow-up sent. Staff can now route this into community highlights.");
      setShowcaseNote("");
      track("workshops_showcase_followup_submitted", {
        eventId: selectedSummary.id,
      });
    } catch (error: unknown) {
      setShowcaseStatus(requestErrorMessage(error));
    } finally {
      setShowcaseBusy(false);
    }
  }, [buddyMode, selectedSummary, showcaseBusy, showcaseNote, submitWorkshopSupportSignal]);

  const handleSignup = async () => {
    if (!detail || actionBusy) return;
    setActionBusy(true);
    setStatus("");

    try {
      const resp = await client.postJson<SignupForEventResponse>("signupForEvent", {
        eventId: detail.id,
      });
      const nextStatus = resp.status === "ticketed"
        ? "You're in!"
        : "You're on the waitlist - we'll notify you if a spot opens.";
      setStatus(nextStatus);
      await refreshAll();
    } catch (error: unknown) {
      setStatus(requestErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!signup?.id || actionBusy) return;
    setActionBusy(true);
    setStatus("");

    try {
      await client.postJson<CancelEventSignupResponse>("cancelEventSignup", {
        signupId: signup.id,
      });
      setStatus("Your spot has been released. Thanks for letting us know.");
      await refreshAll();
    } catch (error: unknown) {
      setStatus(requestErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  };

  const handleClaimOffer = async () => {
    if (!signup?.id || actionBusy) return;
    setActionBusy(true);
    setStatus("");

    try {
      await client.postJson<ClaimEventOfferResponse>("claimEventOffer", {
        signupId: signup.id,
      });
      setStatus("Offer claimed! You're confirmed.");
      await refreshAll();
    } catch (error: unknown) {
      setStatus(requestErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  };

  const handleSelfCheckIn = async () => {
    if (!signup?.id || actionBusy) return;
    setActionBusy(true);
    setStatus("");

    try {
      await client.postJson<CheckInEventResponse>("checkInEvent", {
        signupId: signup.id,
        method: "self",
      });
      setStatus("Checked in! You can add extras and pay after you're settled.");
      await refreshAll();
    } catch (error: unknown) {
      setStatus(requestErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  };

  const handleCheckout = async () => {
    if (!detail || !signup?.id || checkoutBusy) return;
    setCheckoutBusy(true);
    setStatus("");

    try {
      const payload = {
        eventId: detail.id,
        signupId: signup.id,
        ...(selectedAddOns.length ? { addOnIds: selectedAddOns } : {}),
      };

      const resp = await client.postJson<CreateEventCheckoutSessionResponse>(
        "createEventCheckoutSession",
        payload
      );

      if (!resp.checkoutUrl) {
        setStatus("Checkout session created, but no URL was returned.");
        return;
      }

      window.location.assign(resp.checkoutUrl);
    } catch (error: unknown) {
      setStatus(checkoutErrorMessage(error));
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleCheckoutHandlerError = (error: unknown) => {
    setStatus(checkoutErrorMessage(error));
  };

  const submitWorkshopRequest = async () => {
    if (requestBusy) return;
    const technique = requestTechnique.trim();
    const note = requestNote.trim();
    if (!technique) {
      setRequestStatus("Add at least one technique/topic so staff can triage your request.");
      return;
    }

    setRequestBusy(true);
    setRequestStatus("");
    try {
      const ticketId = await submitWorkshopSupportSignal(`Workshop request: ${technique}`, [
        `Technique/topic: ${technique}`,
        `Level: ${requestLevel}`,
        `Schedule preference: ${requestSchedule}`,
        buddyMode === "circle" && buddyCircleName.trim()
          ? `Buddy mode: circle (${buddyCircleName.trim()})`
          : `Buddy mode: ${buddyMode}`,
        note ? `Notes: ${note}` : "Notes: (none)",
      ]);

      const techniqueIds = parseTechniqueIds(technique);
      const createdAt = Date.now();
      const nextEntry: WorkshopRequestEntry = {
        id: makeSignalId("request-log"),
        ticketId,
        uid: user.uid,
        techniqueLabel: technique,
        techniqueIds,
        level: requestLevel,
        schedule: requestSchedule,
        status: "new",
        note,
        createdAt,
        updatedAt: createdAt,
        source: requestSource,
      };
      setWorkshopRequestLedger((prev): WorkshopRequestEntry[] => [nextEntry, ...prev].slice(0, 120));

      setRequestTechnique("");
      setRequestLevel("all-levels");
      setRequestSchedule("weekday-evening");
      setRequestNote("");
      setRequestSource("events-request-form");
      setRequestStatus("Workshop request sent. Staff will triage and map demand with similar requests.");
    } catch (error: unknown) {
      setRequestStatus(requestErrorMessage(error));
    } finally {
      setRequestBusy(false);
    }
  };

  const routeNoMatchToRequestFlow = () => {
    if (memberTechniqueFocus === "any") return;
    const suggestion = techniqueById(memberTechniqueFocus)?.label ?? "Studio practice";
    focusRequestForm({
      technique: suggestion,
      level: memberLevelFocus,
      schedule: memberScheduleFocus === "any" ? "weekday-evening" : memberScheduleFocus,
      source: "cluster-routing",
    });
    setRequestStatus(
      `No current workshop match for "${suggestion}". We prefilled the request flow so program ops can cluster demand.`
    );
  };

  const handleIndustryEditorPick = useCallback(
    (nextId: string) => {
      setIndustryEditorId(nextId);
      setIndustryEditorStatus("");
      if (nextId === "new") {
        setIndustryDraft(toIndustryEventDraft());
        return;
      }
      const match = curationIndustryEvents.find((event) => event.id === nextId) ?? null;
      setIndustryDraft(toIndustryEventDraft(match));
    },
    [curationIndustryEvents]
  );

  const handleIndustryDraftField = useCallback(
    (field: keyof IndustryEventDraft, value: string | boolean | null) => {
      setIndustryDraft((prev) => updateIndustryDraftField(prev, field, value));
    },
    []
  );

  const handleSaveIndustryEvent = useCallback(async () => {
    if (!hasAdmin || industryEditorBusy) return;
    const title = industryDraft.title.trim();
    const summary = industryDraft.summary.trim();
    if (!title || !summary) {
      setIndustryEditorStatus("Title and summary are required.");
      return;
    }

    const startAt = localInputToIso(industryDraft.startAtLocal);
    const endAt = localInputToIso(industryDraft.endAtLocal);
    if (startAt && endAt && new Date(startAt).getTime() >= new Date(endAt).getTime()) {
      setIndustryEditorStatus("Start time must be before end time.");
      return;
    }

    if (industryDraft.status === "published") {
      if (!startAt) {
        setIndustryEditorStatus("Published industry events require a start time.");
        return;
      }
      const hasAnyLink =
        industryDraft.registrationUrl.trim() ||
        industryDraft.remoteUrl.trim() ||
        industryDraft.sourceUrl.trim();
      if (!hasAnyLink) {
        setIndustryEditorStatus(
          "Published industry events require registration URL, remote URL, or source URL."
        );
        return;
      }
    }

    setIndustryEditorBusy(true);
    setIndustryEditorStatus("");
    try {
      const payload = {
        eventId: industryEditorId === "new" ? null : industryEditorId,
        title,
        summary,
        description: industryDraft.description.trim() || null,
        mode: industryDraft.mode,
        status: industryDraft.status,
        startAt,
        endAt,
        timezone: industryDraft.timezone.trim() || null,
        location: industryDraft.location.trim() || null,
        city: industryDraft.city.trim() || null,
        region: industryDraft.region.trim() || null,
        country: industryDraft.country.trim() || null,
        remoteUrl: industryDraft.remoteUrl.trim() || null,
        registrationUrl: industryDraft.registrationUrl.trim() || null,
        sourceName: industryDraft.sourceName.trim() || null,
        sourceUrl: industryDraft.sourceUrl.trim() || null,
        featured: industryDraft.featured,
        tags: dedupe(parseCsvList(industryDraft.tagsCsv)),
        verifiedAt: localInputToIso(industryDraft.verifiedAtLocal),
      };

      const resp = await client.postJson<{
        ok: true;
        eventId: string;
        created: boolean;
        event: IndustryEventSummary;
      }>("upsertIndustryEvent", payload);
      setIndustryEditorId(resp.eventId);
      setIndustryDraft(toIndustryEventDraft(resp.event));
      await loadIndustryEvents();
      setIndustryEditorStatus(resp.created ? "Industry event created." : "Industry event updated.");
      track("industry_event_curated", {
        eventId: resp.eventId,
        status: payload.status,
        mode: payload.mode,
      });
    } catch (error: unknown) {
      setIndustryEditorStatus(requestErrorMessage(error));
    } finally {
      setIndustryEditorBusy(false);
    }
  }, [client, hasAdmin, industryDraft, industryEditorBusy, industryEditorId, loadIndustryEvents]);

  const handleRunIndustryFreshnessSweep = useCallback(
    async (dryRun: boolean) => {
      if (!hasAdmin || industrySweepBusy) return;
      setIndustrySweepBusy(true);
      setIndustrySweepStatus("");
      try {
        const resp = await client.postJson<RunIndustryEventsFreshnessNowResponse>(
          "runIndustryEventsFreshnessNow",
          {
            dryRun,
            limit: 250,
          }
        );
        const result = resp.result;
        if (!dryRun) {
          await loadIndustryEvents();
        }
        setIndustrySweepStatus(
          `${dryRun ? "Dry run" : "Sweep"} complete: scanned ${result.scanned}, updated ${result.updated}, retired ${result.retired}, stale review ${result.staleReview}.`
        );
        track("industry_freshness_sweep_run", {
          dryRun,
          scanned: result.scanned,
          updated: result.updated,
          retired: result.retired,
          staleReview: result.staleReview,
        });
      } catch (error: unknown) {
        setIndustrySweepStatus(requestErrorMessage(error));
      } finally {
        setIndustrySweepBusy(false);
      }
    },
    [client, hasAdmin, industrySweepBusy, loadIndustryEvents]
  );

  const handleStaffCheckIn = async (signupId: string) => {
    if (!signupId || rosterBusyIds[signupId]) return;

    setRosterBusyIds((prev) => ({ ...prev, [signupId]: true }));
    setStatus("");

    try {
      await client.postJson<CheckInEventResponse>("checkInEvent", {
        signupId,
        method: "staff",
      });
      setStatus("Attendee checked in.");
      if (selectedId) {
        await loadRoster(selectedId);
        await loadDetail(selectedId);
      }
    } catch (error: unknown) {
      setStatus(requestErrorMessage(error));
    } finally {
      setRosterBusyIds((prev) => {
        const next = { ...prev };
        delete next[signupId];
        return next;
      });
    }
  };

  const toggleAddOn = (id: string) => {
    setSelectedAddOns((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  };

  const isSoldOut = selectedSummary?.remainingCapacity === 0 && detail?.waitlistEnabled === false;
  const canSignup = !!detail && (!signup || !isActiveSignup(signup.status)) && detail.status === "published";
  const canCancel = !!signup && isActiveSignup(signup.status) && signup.status !== "checked_in";
  const canClaim = signup?.status === "offered";
  const canCheckIn = signup?.status === "ticketed";
  const canCheckout = signup?.status === "checked_in" && signup.paymentStatus !== "paid";

  const joinLabel =
    selectedSummary?.remainingCapacity === 0 && detail?.waitlistEnabled
      ? "Join waitlist"
      : "Reserve ticket";

  const detailRemainingLabel =
    selectedSummary?.remainingCapacity === null || selectedSummary?.remainingCapacity === undefined
      ? ""
      : ` | ${selectedSummary.remainingCapacity} left`;
  const focusedTechniqueLabel =
    memberTechniqueFocus === "any"
      ? "your selected focus"
      : techniqueById(memberTechniqueFocus)?.label ?? "your selected focus";
  const activeBuddyMode = BUDDY_MODES.find((mode) => mode.key === buddyMode) ?? BUDDY_MODES[0];

  return (
    <div className="page events-page">
      <div className="page-header">
        <div>
          <h1>Events & workshops</h1>
        </div>
      </div>

      <section className="card card-3d events-hero">
        <div>
          <div className="card-title">Low-stress, attendance-only billing</div>
          <p className="events-copy">
            You won&apos;t be charged unless you attend. If plans change, no worries - cancel anytime up to
            3 hours before the event.
          </p>
        </div>
        <div className="events-hero-meta">
          <div>
            <span className="summary-label">Check-in</span>
            <span className="summary-value">Required to pay</span>
          </div>
          <div>
            <span className="summary-label">Waitlist</span>
            <span className="summary-value">Auto-promote, 12-hour claim</span>
          </div>
          <div>
            <span className="summary-label">Status</span>
            <span className="summary-value">{status || "Ready for the next event"}</span>
          </div>
        </div>
      </section>

      <section className="events-toolbar">
        <div className="events-search">
          <label htmlFor="events-search">Search events</label>
          <input
            id="events-search"
            type="text"
            placeholder="Raku night, firing fees, glaze dinner..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="events-actions">
          <button className="btn btn-ghost" onClick={toVoidHandler(refreshAll)}>
            Refresh events
          </button>
        </div>
        {hasAdmin ? (
          <div className="events-admin-toggle">
            <label>
              <input
                type="checkbox"
                checked={includeDrafts}
                onChange={(event) => setIncludeDrafts(event.target.checked)}
              />
              Show drafts
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeCancelled}
                onChange={(event) => setIncludeCancelled(event.target.checked)}
              />
              Show cancelled
            </label>
          </div>
        ) : null}
      </section>

      <section className="card card-3d industry-events-card">
        <div className="industry-events-head">
          <div className="card-title">Industry events (local + remote)</div>
          <p className="events-copy">
            Track major ceramics gatherings, conventions, and regional opportunities without leaving the studio portal.
          </p>
        </div>
        <div className="industry-events-toolbar">
          <div className="events-search">
            <label htmlFor="industry-events-search">Search industry events</label>
            <input
              id="industry-events-search"
              type="text"
              placeholder="NCECA, Phoenix convention, virtual summit..."
              value={industrySearch}
              onChange={(event) => setIndustrySearch(event.target.value)}
            />
          </div>
          <div className="industry-mode-filters">
            {INDUSTRY_MODE_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={`events-chip ${industryModeFilter === option.key ? "active" : ""}`}
                onClick={() => setIndustryModeFilter(option.key)}
              >
                {option.label}
                <span className="events-chip-count">{industryModeCounts[option.key]}</span>
              </button>
            ))}
          </div>
        </div>

        {industryEventsLoading ? <div className="events-loading">Loading industry events...</div> : null}
        {industryEventsError ? <div className="alert inline-alert">{industryEventsError}</div> : null}

        {!industryEventsLoading && !industryEventsError && featuredIndustryEvents.length > 0 ? (
          <div className="industry-featured-grid">
            {featuredIndustryEvents.map((event) => {
              const primaryLink = event.registrationUrl || event.remoteUrl || event.sourceUrl;
              return (
                <article key={`featured-${event.id}`} className="industry-featured-card">
                  <div className="industry-event-title-row">
                    <strong>{event.title}</strong>
                    <span className="event-tag accent">Featured</span>
                  </div>
                  <div className="events-copy">{event.summary}</div>
                  <div className="industry-event-meta">
                    <span>{formatDateTime(event.startAt)}</span>
                    <span>{industryEventModeLabel(event.mode)}</span>
                    <span>{industryEventLocationLabel(event)}</span>
                  </div>
                  {primaryLink ? (
                    <a
                      className="btn btn-ghost btn-small"
                      href={primaryLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open event
                    </a>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}

        {!industryEventsLoading && filteredIndustryEvents.length === 0 ? (
          <div className="events-empty">
            No matching industry events right now. Try widening filters or check back after the next curation pass.
          </div>
        ) : null}

        <div className="industry-events-list">
          {filteredIndustryEvents.map((event) => {
            const primaryLink = event.registrationUrl || event.remoteUrl || event.sourceUrl;
            const sourceLink = event.sourceUrl && event.sourceUrl !== primaryLink ? event.sourceUrl : null;
            return (
              <article key={event.id} className="industry-event-card">
                <div className="industry-event-title-row">
                  <h3>{event.title}</h3>
                  <span className={`event-tag mode-${event.mode}`}>{industryEventModeLabel(event.mode)}</span>
                </div>
                <p className="events-copy">{event.summary}</p>
                <div className="industry-event-meta">
                  <span>{formatDateTime(event.startAt)}</span>
                  <span>{industryEventLocationLabel(event)}</span>
                  <span>{event.sourceName || "Curated source"}</span>
                </div>
                <div className="event-tags">
                  {event.featured ? <span className="event-tag accent">Featured</span> : null}
                  <span className={`event-tag status-${event.status}`}>{event.status}</span>
                  {hasAdmin && event.needsReview ? <span className="event-tag">Needs review</span> : null}
                  {event.tags?.slice(0, 3).map((tag) => (
                    <span key={`${event.id}-${tag}`} className="event-tag">
                      {tag}
                    </span>
                  ))}
                  {event.verifiedAt ? (
                    <span className="event-tag">Verified {new Date(event.verifiedAt).toLocaleDateString()}</span>
                  ) : null}
                </div>
                <div className="industry-event-actions">
                  {primaryLink ? (
                    <a className="btn btn-secondary btn-small" href={primaryLink} target="_blank" rel="noreferrer">
                      Open event
                    </a>
                  ) : (
                    <span className="events-copy">Link pending</span>
                  )}
                  {sourceLink ? (
                    <a className="btn btn-ghost btn-small" href={sourceLink} target="_blank" rel="noreferrer">
                      Source
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="card card-3d workshop-rails-card">
        <div className="card-title">Discovery rails</div>
        <p className="events-copy">
          Recommendations are tuned from your current context and staff-curated tracks.
        </p>

        <div className="workshop-context-grid">
          <label className="workshop-request-field">
            My level focus
            <select
              value={memberLevelFocus}
              onChange={(event) => setMemberLevelFocus(event.target.value as RequestLevel)}
            >
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="workshop-request-field">
            My schedule window
            <select
              value={memberScheduleFocus}
              onChange={(event) => setMemberScheduleFocus(event.target.value as MemberSchedule)}
            >
              {MEMBER_SCHEDULE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="workshop-technique-chips">
          <button
            className={`events-chip ${memberTechniqueFocus === "any" ? "active" : ""}`}
            onClick={() => setMemberTechniqueFocus("any")}
          >
            Any technique
          </button>
          {TECHNIQUE_TAXONOMY.map((technique) => (
            <button
              key={technique.id}
              className={`events-chip ${memberTechniqueFocus === technique.id ? "active" : ""}`}
              onClick={() => setMemberTechniqueFocus(technique.id)}
            >
              {technique.label}
            </button>
          ))}
        </div>

        {hasAdmin ? (
          <div className="workshop-curation-admin">
            <div className="workshop-curation-title">Staff curation controls</div>
            <p className="events-copy">
              Tune curated rails without code edits. Use comma-separated IDs from the technique chips above.
            </p>
            <div className="workshop-request-grid">
              <label className="workshop-request-field">
                Beginner rail techniques
                <input
                  type="text"
                  value={staffCurationDraft.beginnerCsv}
                  onChange={(event) =>
                    setStaffCurationDraft((prev) => ({ ...prev, beginnerCsv: event.target.value }))
                  }
                  placeholder="handbuilding, wheel-throwing"
                />
              </label>
              <label className="workshop-request-field">
                Intensive rail techniques
                <input
                  type="text"
                  value={staffCurationDraft.intensivesCsv}
                  onChange={(event) =>
                    setStaffCurationDraft((prev) => ({ ...prev, intensivesCsv: event.target.value }))
                  }
                  placeholder="surface-decoration, glazing-firing, wheel-throwing"
                />
              </label>
              <label className="workshop-request-field">
                Seasonal schedule buckets
                <input
                  type="text"
                  value={staffCurationDraft.seasonalCsv}
                  onChange={(event) =>
                    setStaffCurationDraft((prev) => ({ ...prev, seasonalCsv: event.target.value }))
                  }
                  placeholder="weekend-morning, weekend-afternoon"
                />
              </label>
            </div>
            <div className="workshop-request-actions">
              <button className="btn btn-secondary" onClick={handleApplyStaffCuration}>
                Apply curation changes
              </button>
              <button className="btn btn-ghost" onClick={handleResetStaffCuration}>
                Reset defaults
              </button>
            </div>
          </div>
        ) : null}

        {!focusedTechniqueMatches ? (
          <div className="workshop-no-match">
            <div>
              <strong>No upcoming match yet for {focusedTechniqueLabel}.</strong> Send a request and we&apos;ll
              route the demand cluster to staff programming.
            </div>
            <button className="btn btn-secondary" onClick={routeNoMatchToRequestFlow}>
              Open request flow
            </button>
          </div>
        ) : null}

        {recommendationRails.length === 0 ? (
          <div className="events-empty">
            No recommendation rails available yet. Refresh after staff publishes more workshops.
          </div>
        ) : (
          <div className="workshop-rails-list">
            {recommendationRails.map((rail) => (
              <article key={rail.id} className="workshop-rail">
                <div className="workshop-rail-head">
                  <div className="workshop-rail-title">{rail.title}</div>
                  <div className="workshop-rail-copy">{rail.description}</div>
                </div>
                <div className="workshop-rail-scroll">
                  {rail.rows.map((row) => {
                    const isActive = row.event.id === selectedId;
                    const tags = row.techniqueIds
                      .map((id) => techniqueById(id)?.label ?? "Studio practice")
                      .slice(0, 2);
                    return (
                      <button
                        key={`${rail.id}-${row.event.id}`}
                        className={`rail-event-card ${isActive ? "active" : ""}`}
                        onClick={() => handleSelectRailEvent(rail.id, row)}
                      >
                        <div className="rail-event-top">
                          <span className="rail-event-title">{row.event.title}</span>
                          <span className="rail-event-price">{formatCents(row.event.priceCents)}</span>
                        </div>
                        <div className="rail-event-meta">
                          {formatDateTime(row.event.startAt)} · {scheduleLabelFor(row.scheduleBucket)}
                        </div>
                        <div className="rail-event-tags">
                          {tags.map((label) => (
                            <span key={`${row.event.id}-${label}`} className="event-tag">
                              {label}
                            </span>
                          ))}
                          <span className="event-tag">{levelLabelFor(row.inferredLevel)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section ref={requestCardRef} className="card card-3d workshop-request-card">
        <div className="card-title">Request a workshop</div>
        <p className="events-copy">
          Looking for a technique we are not offering yet? Submit one request and staff will cluster demand for future programming.
        </p>
        <div className="workshop-request-grid">
          <label className="workshop-request-field">
            Technique or topic
            <input
              type="text"
              value={requestTechnique}
              onChange={(event) => setRequestTechnique(event.target.value)}
              placeholder="Surface carving, crystalline glaze, large platter trimming..."
            />
          </label>
          <label className="workshop-request-field">
            Skill level
            <select
              value={requestLevel}
              onChange={(event) => setRequestLevel(event.target.value as RequestLevel)}
            >
              {LEVEL_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="workshop-request-field">
            Preferred schedule
            <select
              value={requestSchedule}
              onChange={(event) => setRequestSchedule(event.target.value as RequestSchedule)}
            >
              {SCHEDULE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="workshop-request-field">
          Notes (optional)
          <textarea
            rows={3}
            value={requestNote}
            onChange={(event) => setRequestNote(event.target.value)}
            placeholder="What would make this workshop useful for your current studio practice?"
          />
        </label>
        <div className="workshop-request-actions">
          <button
            className="btn btn-primary"
            onClick={toVoidHandler(submitWorkshopRequest)}
            disabled={requestBusy || !requestTechnique.trim().length}
          >
            {requestBusy ? "Sending request..." : "Submit workshop request"}
          </button>
          {requestStatus ? (
            <div className="workshop-request-status" role="status" aria-live="polite">
              {requestStatus}
            </div>
          ) : null}
        </div>
        <div className="workshop-request-source">
          <span className="event-tag">
            {requestSource === "cluster-routing" ? "Routing mode: Cluster brief" : "Routing mode: New request"}
          </span>
          <span className="events-copy">Lifecycle: new to reviewing to planned to scheduled or declined.</span>
        </div>
        {memberWorkshopRequests.length > 0 ? (
          <div className="workshop-request-tracker">
            <div className="section-title">Your latest requests</div>
            <div className="workshop-request-tracker-list">
              {memberWorkshopRequests.map((entry) => (
                <article key={entry.id} className="workshop-request-tracker-item">
                  <div>
                    <strong>{entry.techniqueLabel}</strong>
                    <div className="events-copy">
                      {levelLabelFor(entry.level)} • {scheduleLabelFor(entry.schedule)}
                    </div>
                  </div>
                  <div className="workshop-request-tracker-meta">
                    <span className={`event-tag ${requestStatusTone(entry.status) === "accent" ? "accent" : ""}`}>
                      {requestStatusLabel(entry.status)}
                    </span>
                    <span className="events-copy">Ticket {entry.ticketId.slice(0, 8)}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <div className="events-layout">
        <section className="card card-3d events-list">
          <div className="card-title">Upcoming events</div>
          {eventsLoading ? <div className="events-loading">Loading events...</div> : null}
          {eventsError ? <div className="alert inline-alert">{eventsError}</div> : null}

          {!eventsLoading && filteredEvents.length === 0 ? (
            <div className="events-empty">
              No events found yet. Check back soon for the next studio drop.
            </div>
          ) : null}

          <div className="events-cards">
            {filteredEvents.map((event) => {
              const isActive = event.id === selectedId;
              const remaining = event.remainingCapacity ?? null;
              const remainingLabel = remaining === null ? "-" : `${remaining} left`;
              const profile = profiledById.get(event.id);
              const techniqueBadges =
                profile?.techniqueIds
                  .map((id) => techniqueById(id)?.label ?? "Studio practice")
                  .slice(0, 2) ?? [];
              return (
                <button
                  key={event.id}
                  className={`event-card ${isActive ? "active" : ""}`}
                  onClick={() => setSelectedId(event.id)}
                >
                  <div className="event-card-header">
                    <div>
                      <div className="event-title">{event.title}</div>
                      <div className="event-summary">{event.summary}</div>
                    </div>
                    <div className="event-price">{formatCents(event.priceCents)}</div>
                  </div>
                  <div className="event-meta">
                    <span>{formatDateTime(event.startAt)}</span>
                    <span>{event.location || "Studio"}</span>
                  </div>
                  <div className="event-tags">
                    <span className={`event-tag ${event.includesFiring ? "accent" : ""}`}>
                      {event.includesFiring ? "Firing included" : "Studio event"}
                    </span>
                    {techniqueBadges.map((label) => (
                      <span key={`${event.id}-${label}`} className="event-tag">
                        {label}
                      </span>
                    ))}
                    {event.waitlistEnabled ? <span className="event-tag">Waitlist</span> : null}
                    <span className="event-tag">{remainingLabel}</span>
                    <span className={`event-tag status-${event.status}`}>{event.status}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card card-3d events-detail">
          <div className="card-title">Event details</div>
          {detailLoading ? <div className="events-loading">Loading details...</div> : null}
          {detailError ? <div className="alert inline-alert">{detailError}</div> : null}

          {!detailLoading && detail ? (
            <div className="events-detail-body">
              <div className="detail-header">
                <div>
                  <h2>{detail.title}</h2>
                  <div className="detail-summary">{detail.summary}</div>
                </div>
                <div className="detail-price">{formatCents(detail.priceCents)}</div>
              </div>

              <div className="detail-grid">
                <div>
                  <span className="summary-label">When</span>
                  <span className="summary-value">{formatDateTime(detail.startAt)}</span>
                </div>
                <div>
                  <span className="summary-label">Ends</span>
                  <span className="summary-value">{formatDateTime(detail.endAt)}</span>
                </div>
                <div>
                  <span className="summary-label">Location</span>
                  <span className="summary-value">{detail.location || "Studio"}</span>
                </div>
                <div>
                  <span className="summary-label">Time zone</span>
                  <span className="summary-value">{detail.timezone || "Local"}</span>
                </div>
                <div>
                  <span className="summary-label">Capacity</span>
                  <span className="summary-value">
                    {detail.capacity} total{detailRemainingLabel}
                  </span>
                </div>
                <div>
                  <span className="summary-label">Firing</span>
                  <span className="summary-value">
                    {detail.includesFiring ? detail.firingDetails || "Included" : "Not included"}
                  </span>
                </div>
              </div>

              <p className="events-copy">{detail.description}</p>

              <div className="detail-policy">
                <div className="policy-title">Low-stress policy</div>
                <p className="events-copy">{detail.policyCopy}</p>
              </div>

              <div className="community-signals-panel">
                <div className="section-title">Community signals</div>
                <p className="events-copy">
                  Opt in to interest and presence cues so staff can gauge momentum before sessions fill.
                </p>
                <div className="community-kpi-grid">
                  <div>
                    <span className="summary-label">Momentum</span>
                    <span className="summary-value">{momentumLabel}</span>
                  </div>
                  <div>
                    <span className="summary-label">Waitlist pressure</span>
                    <span className="summary-value">{selectedWaitlistPressure}</span>
                  </div>
                  <div>
                    <span className="summary-label">Interest signals</span>
                    <span className="summary-value">{projectedInterestCount}</span>
                  </div>
                </div>
                <div
                  className={`momentum-meter momentum-${momentumTone}`}
                  role="img"
                  aria-label={`Momentum score ${momentumScore} out of 100`}
                >
                  <span style={{ width: `${momentumScore}%` }} />
                </div>

                <div className="community-actions-row">
                  <button
                    className={`btn ${selectedIsInterested ? "btn-ghost" : "btn-primary"}`}
                    onClick={toVoidHandler(handleInterestToggle)}
                    disabled={interestBusy || !selectedSummary}
                  >
                    {interestBusy
                      ? "Saving..."
                      : selectedIsInterested
                        ? "Interested (tap to remove)"
                        : "I'm interested"}
                  </button>
                  <div className="buddy-mode-row" role="group" aria-label="Buddy mode">
                    {BUDDY_MODES.map((mode) => (
                      <button
                        key={mode.key}
                        className={`events-chip ${buddyMode === mode.key ? "active" : ""}`}
                        onClick={() => setBuddyMode(mode.key)}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
                {buddyMode === "circle" ? (
                  <label className="workshop-request-field">
                    Circle cue (optional)
                    <input
                      type="text"
                      value={buddyCircleName}
                      onChange={(event) => setBuddyCircleName(event.target.value)}
                      placeholder="Friday wheel trio, handbuilding duo..."
                    />
                  </label>
                ) : null}
                <div className="events-copy community-presence-copy">{activeBuddyMode.copy}</div>
                <div className="community-loop-strip">
                  <span className="event-tag">{buddyIntentCount} buddy opt-ins</span>
                  <span className="event-tag">{circleIntentCount} circle signals</span>
                  <span className="event-tag">Post-workshop showcase prompt enabled</span>
                </div>
                <div className="workshop-showcase-flow">
                  <label className="workshop-request-field">
                    Post-workshop outcome note
                    <textarea
                      rows={2}
                      value={showcaseNote}
                      onChange={(event) => setShowcaseNote(event.target.value)}
                      placeholder="Share what worked, what surprised you, or what you want to show next."
                    />
                  </label>
                  <button
                    className="btn btn-ghost"
                    onClick={toVoidHandler(handleSubmitShowcaseFollowup)}
                    disabled={showcaseBusy || !selectedSummary}
                  >
                    {showcaseBusy ? "Sending..." : "Send showcase follow-up"}
                  </button>
                </div>
                {interestStatus ? (
                  <div className="workshop-request-status" role="status" aria-live="polite">
                    {interestStatus}
                  </div>
                ) : null}
                {showcaseStatus ? (
                  <div className="workshop-request-status" role="status" aria-live="polite">
                    {showcaseStatus}
                  </div>
                ) : null}
              </div>

              <div className="learning-pathway-panel">
                <div className="section-title">Technique learning pathway</div>
                <p className="events-copy">
                  Bridge this workshop into Lending resources for pre-work and post-work practice loops.
                </p>
                {selectedTechniqueResources.length === 0 ? (
                  <div className="events-empty">
                    Select a workshop to unlock its technique pathway and Lending bridge.
                  </div>
                ) : (
                  <div className="pathway-grid">
                    {selectedTechniqueResources.map((resource) => (
                      <article key={resource.id} className="pathway-card">
                        <div className="pathway-title">{resource.label}</div>
                        <div className="pathway-copy">Lending shelf: {resource.shelf}</div>
                        <div className="pathway-copy">Pre-work: {resource.prework}</div>
                        <div className="pathway-copy">Post-work: {resource.postwork}</div>
                        <a
                          href="#lending-library"
                          className="pathway-link"
                          onClick={(event) => {
                            event.preventDefault();
                            handleOpenLendingBridge(resource.label);
                          }}
                        >
                          Open {resource.label} shelf in Lending Library
                        </a>
                      </article>
                    ))}
                  </div>
                )}
                {!focusedTechniqueMatches ? (
                  <div className="workshop-no-match">
                    <div>
                      No published workshop currently matches {focusedTechniqueLabel}. We can route this directly
                      to request intake.
                    </div>
                    <button className="btn btn-secondary" onClick={routeNoMatchToRequestFlow}>
                      Request this pathway
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="ticket-card">
                <div className="ticket-top">
                  <div>
                    <div className="ticket-label">Your ticket</div>
                    <div className="ticket-status">{signup ? labelForStatus(signup.status) : "Not signed up"}</div>
                  </div>
                  {signup?.status === "checked_in" && signup.paymentStatus ? (
                    <span className={`event-tag ${signup.paymentStatus === "paid" ? "accent" : ""}`}>
                      {signup.paymentStatus === "paid" ? "Paid" : "Unpaid"}
                    </span>
                  ) : null}
                </div>
                {signup?.status === "offered" && signup ? (
                  <div className="ticket-note">
                    Offer expires in {detail.offerClaimWindowHours ?? 12} hours - claim to keep your spot.
                  </div>
                ) : null}
                <div className="ticket-actions">
                  {canSignup ? (
                    <button
                      className="btn btn-primary"
                      onClick={toVoidHandler(handleSignup)}
                      disabled={actionBusy || isSoldOut}
                    >
                      {actionBusy ? "Working..." : isSoldOut ? "Sold out" : joinLabel}
                    </button>
                  ) : null}
                  {canClaim ? (
                    <button className="btn btn-primary" onClick={toVoidHandler(handleClaimOffer)} disabled={actionBusy}>
                      {actionBusy ? "Claiming..." : "Claim offer"}
                    </button>
                  ) : null}
                  {canCheckIn ? (
                    <button className="btn btn-primary" onClick={toVoidHandler(handleSelfCheckIn)} disabled={actionBusy}>
                      {actionBusy ? "Checking in..." : "Self check-in"}
                    </button>
                  ) : null}
                  {canCancel ? (
                    <button className="btn btn-ghost" onClick={toVoidHandler(handleCancel)} disabled={actionBusy}>
                      {actionBusy ? "Canceling..." : "Cancel signup"}
                    </button>
                  ) : null}
                </div>
              </div>

              {signup?.status === "checked_in" ? (
                <div className="add-ons">
                  <div className="add-ons-title">Add-ons (select at check-in)</div>
                  {activeAddOns.length === 0 ? (
                    <div className="events-empty">No add-ons offered for this event.</div>
                  ) : (
                    <div className="add-ons-list">
                      {activeAddOns.map((addOn) => (
                        <label key={addOn.id} className="add-on-row">
                          <input
                            type="checkbox"
                            checked={selectedAddOns.includes(addOn.id)}
                            onChange={() => toggleAddOn(addOn.id)}
                          />
                          <span>{addOn.title}</span>
                          <span className="add-on-price">{formatCents(addOn.priceCents)}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  <div className="add-ons-footer">
                    <div>
                      <span className="summary-label">Add-on total</span>
                      <span className="summary-value">{formatCents(addOnTotalCents)}</span>
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={toVoidHandler(
                        handleCheckout,
                        handleCheckoutHandlerError,
                        "events.checkout"
                      )}
                      disabled={!canCheckout || checkoutBusy}
                    >
                      {checkoutBusy ? "Starting checkout..." : "Pay event total"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {!detailLoading && !detail ? (
            <div className="events-empty">Select an event to see details.</div>
          ) : null}
        </section>

        <aside className="card card-3d events-staff">
          <div className="card-title">Staff check-in</div>
          {!hasAdmin ? (
            <div className="events-empty">
              Paste the admin token to unlock the roster and staff check-in.
            </div>
          ) : null}

          {hasAdmin ? (
            <>
              <section className="staff-intel-panel">
                <div className="section-title">Industry events curation</div>
                <p className="events-copy">
                  Create and update curated industry events that appear in the member local/remote feed.
                </p>
                <div className="staff-summary">
                  <div>
                    <span className="summary-label">Needs review</span>
                    <span className="summary-value">{industryNeedsReviewCount}</span>
                  </div>
                  <div>
                    <span className="summary-label">Total tracked</span>
                    <span className="summary-value">{industryEvents.length}</span>
                  </div>
                </div>
                <label className="workshop-request-field">
                  Editing target
                  <select
                    value={industryEditorId}
                    onChange={(event) => handleIndustryEditorPick(event.target.value)}
                    disabled={industryEditorBusy}
                  >
                    <option value="new">New industry event</option>
                    {curationIndustryEvents.map((event) => (
                    <option key={`industry-edit-${event.id}`} value={event.id}>
                        {event.title} ({event.status}
                        {event.needsReview ? ", needs review" : ""})
                    </option>
                  ))}
                </select>
              </label>
                <div className="workshop-request-grid">
                  <label className="workshop-request-field">
                    Title
                    <input
                      type="text"
                      value={industryDraft.title}
                      onChange={(event) => handleIndustryDraftField("title", event.target.value)}
                      placeholder="NCECA Annual Conference"
                    />
                  </label>
                  <label className="workshop-request-field">
                    Summary
                    <input
                      type="text"
                      value={industryDraft.summary}
                      onChange={(event) => handleIndustryDraftField("summary", event.target.value)}
                      placeholder="National ceramics gathering"
                    />
                  </label>
                  <label className="workshop-request-field">
                    Mode
                    <select
                      value={industryDraft.mode}
                      onChange={(event) =>
                        handleIndustryDraftField("mode", event.target.value as IndustryEventDraft["mode"])
                      }
                    >
                      {INDUSTRY_MODE_OPTIONS.filter((option) => option.key !== "all").map((option) => (
                        <option key={`industry-mode-${option.key}`} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="workshop-request-field">
                    Status
                    <select
                      value={industryDraft.status}
                      onChange={(event) =>
                        handleIndustryDraftField("status", event.target.value as IndustryStatus)
                      }
                    >
                      {INDUSTRY_STATUS_OPTIONS.map((option) => (
                        <option key={`industry-status-${option.key}`} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="workshop-request-field">
                    Starts (local)
                    <input
                      type="datetime-local"
                      value={industryDraft.startAtLocal}
                      onChange={(event) => handleIndustryDraftField("startAtLocal", event.target.value)}
                    />
                  </label>
                  <label className="workshop-request-field">
                    Ends (local)
                    <input
                      type="datetime-local"
                      value={industryDraft.endAtLocal}
                      onChange={(event) => handleIndustryDraftField("endAtLocal", event.target.value)}
                    />
                  </label>
                  <label className="workshop-request-field">
                    Timezone
                    <input
                      type="text"
                      value={industryDraft.timezone}
                      onChange={(event) => handleIndustryDraftField("timezone", event.target.value)}
                      placeholder="America/Phoenix"
                    />
                  </label>
                  <label className="workshop-request-field">
                    Location
                    <input
                      type="text"
                      value={industryDraft.location}
                      onChange={(event) => handleIndustryDraftField("location", event.target.value)}
                      placeholder="Convention center / city / region"
                    />
                  </label>
                  <label className="workshop-request-field">
                    City
                    <input
                      type="text"
                      value={industryDraft.city}
                      onChange={(event) => handleIndustryDraftField("city", event.target.value)}
                    />
                  </label>
                  <label className="workshop-request-field">
                    Region / state
                    <input
                      type="text"
                      value={industryDraft.region}
                      onChange={(event) => handleIndustryDraftField("region", event.target.value)}
                    />
                  </label>
                  <label className="workshop-request-field">
                    Country
                    <input
                      type="text"
                      value={industryDraft.country}
                      onChange={(event) => handleIndustryDraftField("country", event.target.value)}
                    />
                  </label>
                  <label className="workshop-request-field">
                    Tags (CSV)
                    <input
                      type="text"
                      value={industryDraft.tagsCsv}
                      onChange={(event) => handleIndustryDraftField("tagsCsv", event.target.value)}
                      placeholder="conference, community, national"
                    />
                  </label>
                </div>
                <label className="workshop-request-field">
                  Description
                  <textarea
                    rows={3}
                    value={industryDraft.description}
                    onChange={(event) => handleIndustryDraftField("description", event.target.value)}
                    placeholder="Why this event matters to Monsoon Fire members."
                  />
                </label>
                <div className="workshop-request-grid">
                  <label className="workshop-request-field">
                    Registration URL
                    <input
                      type="url"
                      value={industryDraft.registrationUrl}
                      onChange={(event) => handleIndustryDraftField("registrationUrl", event.target.value)}
                      placeholder="https://..."
                    />
                  </label>
                  <label className="workshop-request-field">
                    Remote URL
                    <input
                      type="url"
                      value={industryDraft.remoteUrl}
                      onChange={(event) => handleIndustryDraftField("remoteUrl", event.target.value)}
                      placeholder="https://..."
                    />
                  </label>
                  <label className="workshop-request-field">
                    Source name
                    <input
                      type="text"
                      value={industryDraft.sourceName}
                      onChange={(event) => handleIndustryDraftField("sourceName", event.target.value)}
                      placeholder="NCECA"
                    />
                  </label>
                  <label className="workshop-request-field">
                    Source URL
                    <input
                      type="url"
                      value={industryDraft.sourceUrl}
                      onChange={(event) => handleIndustryDraftField("sourceUrl", event.target.value)}
                      placeholder="https://..."
                    />
                  </label>
                  <label className="workshop-request-field">
                    Verified at (local)
                    <input
                      type="datetime-local"
                      value={industryDraft.verifiedAtLocal}
                      onChange={(event) => handleIndustryDraftField("verifiedAtLocal", event.target.value)}
                    />
                  </label>
                  <label className="workshop-request-field industry-featured-toggle">
                    Featured
                    <input
                      type="checkbox"
                      checked={industryDraft.featured}
                      onChange={(event) => handleIndustryDraftField("featured", event.target.checked)}
                    />
                  </label>
                </div>
                <div className="workshop-request-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={toVoidHandler(handleSaveIndustryEvent)}
                    disabled={industryEditorBusy}
                  >
                    {industryEditorBusy ? "Saving..." : "Save industry event"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => handleIndustryEditorPick("new")}
                    disabled={industryEditorBusy}
                  >
                    New blank draft
                  </button>
                  {industryEditorStatus ? (
                    <span className="workshop-request-status" role="status" aria-live="polite">
                      {industryEditorStatus}
                    </span>
                  ) : null}
                </div>
                <div className="workshop-request-actions">
                  <button
                    className="btn btn-ghost"
                    onClick={toVoidHandler(() => handleRunIndustryFreshnessSweep(true))}
                    disabled={industrySweepBusy}
                  >
                    {industrySweepBusy ? "Running..." : "Dry run freshness sweep"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={toVoidHandler(() => handleRunIndustryFreshnessSweep(false))}
                    disabled={industrySweepBusy}
                  >
                    {industrySweepBusy ? "Running..." : "Run freshness sweep now"}
                  </button>
                  {industrySweepStatus ? (
                    <span className="workshop-request-status" role="status" aria-live="polite">
                      {industrySweepStatus}
                    </span>
                  ) : null}
                </div>
              </section>

              <div className="staff-summary">
                <div>
                  <span className="summary-label">Roster</span>
                  <span className="summary-value">{rosterCounts.total} total</span>
                </div>
                <div>
                  <span className="summary-label">Unpaid</span>
                  <span className="summary-value">{rosterCounts.unpaid}</span>
                </div>
              </div>

              <section className="staff-intel-panel">
                <div className="section-title">Demand intelligence</div>
                <div className="staff-intel-kpis">
                  <div>
                    <span className="summary-label">Signals tracked</span>
                    <span className="summary-value">{staffDemandKpis.trackedSignals}</span>
                  </div>
                  <div>
                    <span className="summary-label">Active interests</span>
                    <span className="summary-value">{staffDemandKpis.activeInterests}</span>
                  </div>
                  <div>
                    <span className="summary-label">Constrained sessions</span>
                    <span className="summary-value">{staffDemandKpis.constrainedSessions}</span>
                  </div>
                  <div>
                    <span className="summary-label">Top demand gap</span>
                    <span className="summary-value">{staffDemandKpis.highestDemandGap}</span>
                  </div>
                </div>
                {demandClusters.length === 0 ? (
                  <div className="events-empty">
                    Clusters will appear after requests/interests are recorded.
                  </div>
                ) : (
                  <div className="demand-cluster-list">
                    {demandClusters.map((cluster) => (
                      <article key={cluster.techniqueId} className="demand-cluster-card">
                        <div className="demand-cluster-header">
                          <strong>{cluster.label}</strong>
                          <span className="event-tag">Gap {cluster.gapScore}</span>
                        </div>
                        <div className="demand-cluster-metrics">
                          <span>Demand score {cluster.demandScore}</span>
                          <span>Supply {cluster.supplyCount}</span>
                          <span>Requests {cluster.requestCount}</span>
                          <span>Interest {cluster.interestCount}</span>
                        </div>
                        <div className="demand-cluster-metrics">
                          <span>Waitlist pressure {cluster.waitlistSignals}</span>
                          <span>Suggested level {levelLabelFor(cluster.recommendedLevel)}</span>
                          <span>Suggested schedule {scheduleLabelFor(cluster.recommendedSchedule)}</span>
                        </div>
                        <button
                          className="btn btn-ghost"
                          onClick={() => handleClusterPrefill(cluster)}
                        >
                          Route cluster to request brief
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="staff-intel-panel">
                <div className="section-title">Request triage queue</div>
                <p className="events-copy">
                  Grouped by technique/topic with lifecycle states so staff can move demand from intake to scheduled.
                </p>
                <div className="workshop-request-actions">
                  <button className="btn btn-ghost" onClick={handleExportDemandBrief}>
                    Export demand brief
                  </button>
                </div>
                {requestTriageClusters.length === 0 ? (
                  <div className="events-empty">
                    Triage clusters appear after workshop requests are submitted.
                  </div>
                ) : (
                  <div className="request-triage-clusters">
                    {requestTriageClusters.map((cluster) => (
                      <article key={cluster.clusterKey} className="request-triage-card">
                        <div className="request-triage-head">
                          <strong>{cluster.techniqueLabel}</strong>
                          <span className="event-tag">Priority {cluster.priorityScore}</span>
                        </div>
                        <div className="demand-cluster-metrics">
                          <span>{cluster.requestCount} requests</span>
                          <span>New {cluster.statuses.new}</span>
                          <span>Reviewing {cluster.statuses.reviewing}</span>
                          <span>Planned {cluster.statuses.planned}</span>
                          <span>Scheduled {cluster.statuses.scheduled}</span>
                        </div>
                        <div className="demand-cluster-metrics">
                          <span>Level {levelLabelFor(cluster.recommendedLevel)}</span>
                          <span>Schedule {scheduleLabelFor(cluster.recommendedSchedule)}</span>
                          <span>Latest {new Date(cluster.latestCreatedAt).toLocaleDateString()}</span>
                        </div>
                        <div className="workshop-request-actions">
                          <button
                            className="btn btn-ghost"
                            onClick={() => handleClusterLifecycleChange(cluster.clusterKey, "reviewing")}
                          >
                            Mark reviewing
                          </button>
                          <button
                            className="btn btn-ghost"
                            onClick={() => handleClusterLifecycleChange(cluster.clusterKey, "planned")}
                          >
                            Mark planned
                          </button>
                          <button
                            className="btn btn-ghost"
                            onClick={() => handleClusterLifecycleChange(cluster.clusterKey, "scheduled")}
                          >
                            Mark scheduled
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                {workshopRequestLedger.length > 0 ? (
                  <div className="request-triage-list">
                    {workshopRequestLedger.slice(0, 12).map((entry) => (
                      <article key={entry.id} className="request-triage-row">
                        <div>
                          <strong>{entry.techniqueLabel}</strong>
                          <div className="events-copy">
                            {levelLabelFor(entry.level)} • {scheduleLabelFor(entry.schedule)}
                          </div>
                        </div>
                        <div className="request-triage-actions">
                          <span className={`event-tag ${requestStatusTone(entry.status) === "accent" ? "accent" : ""}`}>
                            {requestStatusLabel(entry.status)}
                          </span>
                          <select
                            value={entry.status}
                            onChange={(event) =>
                              handleRequestLifecycleChange(
                                entry.id,
                                event.target.value as WorkshopRequestLifecycleStatus
                              )
                            }
                          >
                            {REQUEST_LIFECYCLE_STATUSES.map((statusOption) => (
                              <option key={`${entry.id}-${statusOption}`} value={statusOption}>
                                {requestStatusLabel(statusOption)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>

              <div className="staff-toggles">
                <label>
                  <input
                    type="checkbox"
                    checked={rosterIncludeCancelled}
                    onChange={(event) => setRosterIncludeCancelled(event.target.checked)}
                  />
                  Include cancelled
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={rosterIncludeExpired}
                    onChange={(event) => setRosterIncludeExpired(event.target.checked)}
                  />
                  Include expired
                </label>
              </div>

              <div className="staff-filters">
                {ROSTER_FILTERS.map((item) => (
                  <button
                    key={item.key}
                    className={`events-chip ${rosterFilter === item.key ? "active" : ""}`}
                    onClick={() => setRosterFilter(item.key)}
                  >
                    {item.label}
                    <span className="events-chip-count">
                      {item.key === "all" ? rosterCounts.total : rosterCounts[item.key] ?? 0}
                    </span>
                  </button>
                ))}
              </div>

              <div className="events-search">
                <label htmlFor="roster-search">Search roster</label>
                <input
                  id="roster-search"
                  type="text"
                  placeholder="Name or email"
                  value={rosterSearch}
                  onChange={(event) => setRosterSearch(event.target.value)}
                />
              </div>

              {rosterLoading ? <div className="events-loading">Loading roster...</div> : null}
              {rosterError ? <div className="alert inline-alert">{rosterError}</div> : null}

              <div className="roster-list">
                {filteredRoster.map((row) => {
                  const unpaid = row.status === "checked_in" && row.paymentStatus !== "paid";
                  return (
                    <div key={row.id} className={`roster-row ${unpaid ? "unpaid" : ""}`}>
                      <div>
                        <div className="roster-name">{row.displayName || "Attendee"}</div>
                        <div className="roster-meta">
                          {row.email || row.uid || ""}
                        </div>
                        <div className="roster-status">{labelForStatus(row.status)}</div>
                      </div>
                      <div className="roster-actions">
                        {unpaid ? <span className="event-tag">UNPAID</span> : null}
                        {row.status === "ticketed" ? (
                          <button
                            className="btn btn-primary"
                            onClick={toVoidHandler(() => handleStaffCheckIn(row.id))}
                            disabled={!!rosterBusyIds[row.id]}
                          >
                            {rosterBusyIds[row.id] ? "Checking..." : "Check in attendee"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {!rosterLoading && filteredRoster.length === 0 ? (
                  <div className="events-empty">No roster entries for this filter.</div>
                ) : null}
              </div>
            </>
          ) : null}
        </aside>
      </div>

    </div>
  );
}
