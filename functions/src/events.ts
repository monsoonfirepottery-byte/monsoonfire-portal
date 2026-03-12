
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";

import {
  applyCors,
  asInt,
  db,
  nowTs,
  requireAdmin,
  requireAuthUid,
  safeString,
  adminAuth,
  enforceRateLimit,
  parseBody,
  Timestamp,
} from "./shared";
import { z } from "zod";
import { evaluateCommunityContentRisk, getCommunitySafetyConfig } from "./communitySafety";
import {
  INDUSTRY_EVENT_RETIRE_PAST_MS,
  INDUSTRY_EVENT_REVIEW_STALE_MS,
  evaluateIndustryEventFreshness,
  filterIndustryEvents,
  normalizeIndustryEvent,
  normalizeIndustryEventMode,
} from "./industryEvents";

const REGION = "us-central1";
const EVENTS_COL = "events";
const INDUSTRY_EVENTS_COL = "industryEvents";
const SIGNUPS_COL = "eventSignups";
const CHARGES_COL = "eventCharges";
const SUPPORT_REQUESTS_COL = "supportRequests";

const WORKSHOP_COMMUNITY_SIGNAL_EVENT_SOURCES = [
  "events-interest-toggle",
  "events-interest",
  "events-interest-withdrawal",
  "events-showcase",
] as const;
const WORKSHOP_REQUEST_SIGNAL_EVENT_SOURCES = ["events-request-form", "cluster-routing"] as const;
const WORKSHOP_DEMAND_SIGNAL_EVENT_SOURCES = [
  ...WORKSHOP_COMMUNITY_SIGNAL_EVENT_SOURCES,
  ...WORKSHOP_REQUEST_SIGNAL_EVENT_SOURCES,
] as const;
const WORKSHOP_SIGNAL_QUERY_LIMIT_DEFAULT = 250;
const WORKSHOP_SIGNAL_QUERY_LIMIT_MAX = 500;
const WORKSHOP_SIGNAL_QUERY_PAGE_LIMIT = 12;
const WORKSHOP_SIGNAL_EVENT_ID_BATCH_SIZE = 30;
// Firestore "in" filters support up to 10 IDs per query.
const WORKSHOP_SIGNAL_EVENT_ID_QUERY_CHUNK_SIZE = 10;
const WORKSHOP_SIGNAL_SOURCE_QUERY_CHUNK_SIZE = 30;
const WORKSHOP_SIGNAL_NOTE_PREFIXES = ["Notes", "Outcome note", "Outcome", "Result", "Why", "Reason"];
const WORKSHOP_SIGNAL_DOC_ID_PATTERN = /^[a-zA-Z0-9_-]{6,120}$/;

const DEFAULT_OFFER_HOURS = 12;
const DEFAULT_CANCEL_HOURS = 3;

let stripeClient: Stripe | null = null;

const listEventsSchema = z.object({
  includeDrafts: z.boolean().optional(),
  includeCancelled: z.boolean().optional(),
  includeCommunitySignals: z.boolean().optional(),
});

const listIndustryEventsSchema = z.object({
  mode: z.enum(["all", "local", "remote", "hybrid"]).optional(),
  includePast: z.boolean().optional(),
  includeDrafts: z.boolean().optional(),
  includeCancelled: z.boolean().optional(),
  featuredOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const listEventSignupsSchema = z.object({
  eventId: z.string().min(1),
  includeCancelled: z.boolean().optional(),
  includeExpired: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const eventIdSchema = z.object({
  eventId: z.string().min(1),
  includeCommunitySignals: z.boolean().optional(),
});

const industryEventIdSchema = z.object({
  eventId: z.string().min(1),
});

const upsertIndustryEventSchema = z.object({
  eventId: z.string().min(1).optional().nullable(),
  title: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().max(4000).optional().nullable(),
  mode: z.enum(["local", "remote", "hybrid"]).optional().nullable(),
  status: z.enum(["draft", "published", "cancelled"]).optional().nullable(),
  startAt: z.any().optional().nullable(),
  endAt: z.any().optional().nullable(),
  timezone: z.string().max(120).optional().nullable(),
  location: z.string().max(240).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  region: z.string().max(120).optional().nullable(),
  country: z.string().max(120).optional().nullable(),
  remoteUrl: z.string().max(1000).optional().nullable(),
  registrationUrl: z.string().max(1000).optional().nullable(),
  sourceName: z.string().max(240).optional().nullable(),
  sourceUrl: z.string().max(1000).optional().nullable(),
  featured: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(64)).max(20).optional(),
  verifiedAt: z.any().optional().nullable(),
});

const runIndustryEventsFreshnessSchema = z.object({
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  staleReviewDays: z.number().int().min(1).max(90).optional(),
  retirePastHours: z.number().int().min(1).max(336).optional(),
});

const listWorkshopDemandSignalsSchema = z.object({
  eventIds: z.array(z.string().trim().min(1)).max(WORKSHOP_SIGNAL_QUERY_LIMIT_MAX).optional(),
  sources: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(WORKSHOP_SIGNAL_QUERY_LIMIT_MAX)
    .optional(),
  limit: z.number().int().min(1).max(WORKSHOP_SIGNAL_QUERY_LIMIT_MAX).optional(),
});

const publishEventSchema = z.object({
  eventId: z.string().min(1),
  forcePublish: z.boolean().optional(),
  overrideReason: z.string().max(500).optional().nullable(),
});

const WORKSHOP_SIGNAL_TECHNIQUE_RULES = [
  {
    id: "wheel-throwing",
    labels: ["wheel throwing", "throwing", "wheel", "centering", "throw"],
  },
  {
    id: "handbuilding",
    labels: ["handbuilding", "hand build", "hand-built", "coil", "slab", "pinch"],
  },
  {
    id: "surface-decoration",
    labels: ["surface decoration", "surface", "underglaze", "slip trail", "carving", "sgraffito", "glaze"],
  },
  {
    id: "glazing-firing",
    labels: ["glazing", "firing", "kiln", "cone", "raku", "reduction", "oxidation", "glaze"],
  },
  {
    id: "studio-practice",
    labels: ["studio practice", "workflow", "production", "shelf", "placement", "planning"],
  },
] as const;

const WORKSHOP_SIGNAL_TECHNIQUE_LABEL_BY_ID: Record<string, string> = {
  "wheel-throwing": "Wheel throwing",
  handbuilding: "Handbuilding",
  "surface-decoration": "Surface decoration",
  "glazing-firing": "Glazing + firing",
  "studio-practice": "Studio practice",
} as const;

const WORKSHOP_SIGNAL_ALLOWED_TECHNIQUE_IDS = new Set<string>([
  "wheel-throwing",
  "handbuilding",
  "surface-decoration",
  "glazing-firing",
  "studio-practice",
]);

type WorkshopDemandSignalSource = (typeof WORKSHOP_DEMAND_SIGNAL_EVENT_SOURCES)[number];
type WorkshopDemandSignalAction = "interest" | "withdrawal" | "showcase" | "request";
type WorkshopDemandSignalLevel = "all-levels" | "beginner" | "intermediate" | "advanced";
type WorkshopDemandSignalSchedule =
  | "weekday-evening"
  | "weekday-daytime"
  | "weekend-morning"
  | "weekend-afternoon"
  | "flexible";
type WorkshopDemandSignalBuddyMode = "solo" | "buddy" | "circle";

type WorkshopDemandSignalCandidate = {
  id: string;
  uid: string;
  sourceEventId?: string;
  sourceEventTitle?: string;
  action: WorkshopDemandSignalAction;
  createdAtMs: number;
  level: WorkshopDemandSignalLevel;
  schedule: WorkshopDemandSignalSchedule;
  buddyMode: WorkshopDemandSignalBuddyMode;
  techniqueIds: string[];
  techniqueLine: string;
  source: WorkshopDemandSignalSource;
  signalNote?: string;
};

function parseSignalLineValue(body: string, prefix: string): string {
  if (!body) return "";
  const target = prefix.toLowerCase();
  const line = body
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().startsWith(`${target}:`));

  if (!line) return "";
  const sep = line.indexOf(":");
  if (sep < 0) return "";
  return line.slice(sep + 1).trim().replace(/^\((.*)\)$/, "$1");
}

function parseSignalLineValueFromAliases(body: string, prefixes: string[]): string {
  for (const prefix of prefixes) {
    const value = parseSignalLineValue(body, prefix);
    if (value) return value;
  }
  return "";
}

function parseWorkshopSignalNote(body: string): string {
  const note = parseSignalLineValueFromAliases(body, WORKSHOP_SIGNAL_NOTE_PREFIXES);
  return note;
}

function parseWorkshopSignalSource(value: unknown): WorkshopDemandSignalSource | null {
  const normalized = safeString(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  const source = normalized.startsWith("workshop-")
    ? normalized.replace(/^workshop-/, "events-")
    : normalized.startsWith("event-")
      ? normalized.replace(/^event-/, "events-")
      : normalized;

  if (!source) return null;
  if ((WORKSHOP_DEMAND_SIGNAL_EVENT_SOURCES as ReadonlyArray<string>).includes(source)) {
    return source as WorkshopDemandSignalSource;
  }

  if (source === "showcase-follow-up" || source === "showcase") return "events-showcase";
  if (
    source === "withdrawn" ||
    source === "withdraw" ||
    source === "interest-withdrawn"
  ) {
    return "events-interest-withdrawal";
  }
  if (
    source === "request-form" ||
    source === "workshop-request" ||
    source === "request"
  ) {
    return "events-request-form";
  }
  if (source === "interest-toggle" || source === "toggle-interest") return "events-interest-toggle";
  if (source === "interest-signal" || source === "interest") return "events-interest";

  return null;
}

function inferWorkshopSignalSource(
  rawSource: unknown,
  subject: unknown,
  body: unknown
): WorkshopDemandSignalSource | null {
  const source = parseWorkshopSignalSource(rawSource);
  if (source) return source;

  const normalizedSubject = safeString(subject).trim().toLowerCase();
  if (normalizedSubject.includes("workshop request:")) return "events-request-form";
  if (normalizedSubject.includes("workshop interest withdrawn")) return "events-interest-withdrawal";
  if (normalizedSubject.includes("showcase follow-up")) return "events-showcase";
  if (normalizedSubject.includes("workshop interest:")) return "events-interest-toggle";
  if (
    normalizedSubject.includes("workshop interest") ||
    normalizedSubject.includes("i'm interested") ||
    normalizedSubject.includes("i am interested")
  ) {
    return "events-interest";
  }

  const normalizedBody = safeString(body).trim().toLowerCase();
  if (normalizedBody.includes("workshop request:")) return "events-request-form";
  if (normalizedBody.includes("workshop interest withdrawn")) return "events-interest-withdrawal";
  if (normalizedBody.includes("showcase follow-up")) return "events-showcase";
  if (normalizedBody.includes("workshop showcase")) return "events-showcase";
  if (normalizedBody.includes("workshop interest:")) return "events-interest-toggle";
  if (
    normalizedBody.includes("workshop interest") ||
    normalizedBody.includes("i'm interested") ||
    normalizedBody.includes("i am interested")
  ) {
    return "events-interest";
  }

  return null;
}

function parseWorkshopSignalAction(source: WorkshopDemandSignalSource): WorkshopDemandSignalAction {
  return source === "events-interest-withdrawal"
    ? "withdrawal"
    : source === "events-showcase"
      ? "showcase"
      : source === "events-request-form" || source === "cluster-routing"
        ? "request"
      : "interest";
}

function parseWorkshopSignalEventTitle(rawEventTitle: unknown, rawWorkshopTitle: unknown, body: string): string {
  const direct = safeString(rawEventTitle).trim();
  if (direct) return direct;
  const workshop = safeString(rawWorkshopTitle).trim();
  if (workshop) return workshop;

  return (
    parseSignalLineValueFromAliases(body, [
      "Workshop title",
      "Event title",
      "Workshop",
      "Event",
      "Session",
      "Session title",
    ]) || ""
  );
}

function normalizeWorkshopSignalDocumentId(value: string): string | null {
  const trimmed = safeString(value).trim();
  if (!trimmed || !WORKSHOP_SIGNAL_DOC_ID_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function parseWorkshopSignalEventId(rawEventId: unknown, body: string): string | null {
  const direct = safeString(rawEventId).trim();
  const normalizedDirect = normalizeWorkshopSignalDocumentId(direct);
  if (normalizedDirect) {
    return normalizedDirect;
  }

  const fromBody = parseSignalLineValueFromAliases(body, [
    "Event id",
    "Workshop id",
    "Session id",
    "Workshop event id",
    "Event",
    "Workshop",
    "Session",
  ]);

  return normalizeWorkshopSignalDocumentId(fromBody);
}

function isWorkshopDemandSignalRequestSource(source: WorkshopDemandSignalSource): boolean {
  return source === "events-request-form" || source === "cluster-routing";
}

function parseWorkshopSignalLevel(raw: unknown): WorkshopDemandSignalLevel {
  const value = safeString(raw).trim().toLowerCase();
  if (value === "beginner" || value === "intermediate" || value === "advanced") return value;
  if (value === "all levels" || value === "all-levels") return "all-levels";
  return "all-levels";
}

function parseWorkshopSignalSchedule(raw: unknown): WorkshopDemandSignalSchedule {
  const value = safeString(raw).trim().toLowerCase();
  if (
    value === "any" ||
    value === "any schedule" ||
    value === "anytime" ||
    value === "any time" ||
    value === "flex"
  ) {
    return "flexible";
  }
  if (
    value === "weekday-evening" ||
    value === "weekday-daytime" ||
    value === "weekend-morning" ||
    value === "weekend-afternoon" ||
    value === "flexible"
  ) {
    return value;
  }
  return "weekday-evening";
}

function parseWorkshopSignalBuddyMode(raw: unknown): WorkshopDemandSignalBuddyMode {
  const value = safeString(raw).trim().toLowerCase();
  if (value.includes("circle")) return "circle";
  if (value.includes("buddy")) return "buddy";
  return "solo";
}

function parseWorkshopSignalTechniqueIdsFromText(rawLine: string, fallbackTitle: string): string[] {
  const tokens = [rawLine, fallbackTitle]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const out: string[] = [];
  WORKSHOP_SIGNAL_TECHNIQUE_RULES.forEach((rule) => {
    const hasMatch = tokens.some((token) =>
      rule.labels.some((label) => token.includes(label) || label.includes(token))
    );
    if (hasMatch) out.push(rule.id);
  });

  if (!out.length) {
    const flat = tokens.join(" ").toLowerCase();
    WORKSHOP_SIGNAL_TECHNIQUE_RULES.forEach((rule) => {
      const matches = rule.labels.some((label) => flat.includes(label));
      if (matches) out.push(rule.id);
    });
  }

  const deduped: string[] = [];
  out.forEach((id) => {
    if (!deduped.includes(id)) deduped.push(id);
  });
  return deduped.length > 0 ? deduped : ["studio-practice"];
}

function parseWorkshopSignalTechniqueIds(
  rawTechniqueIds: unknown,
  techniqueLine: string,
  fallbackTitle: string
): string[] {
  const explicit: string[] = [];
  if (Array.isArray(rawTechniqueIds)) {
    rawTechniqueIds.forEach((entry) => {
      const value = safeString(entry).trim().toLowerCase();
      if (!value) return;
      if (WORKSHOP_SIGNAL_ALLOWED_TECHNIQUE_IDS.has(value) && !explicit.includes(value)) {
        explicit.push(value);
      }
    });
  } else {
    const raw = safeString(rawTechniqueIds);
    if (raw) {
      raw
        .toLowerCase()
        .split(/[,;\n]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((value) => {
          if (WORKSHOP_SIGNAL_ALLOWED_TECHNIQUE_IDS.has(value) && !explicit.includes(value)) {
            explicit.push(value);
          }
        });
    }
  }

  if (explicit.length > 0) {
    return explicit;
  }

  return parseWorkshopSignalTechniqueIdsFromText(techniqueLine, fallbackTitle);
}

function normalizeWorkshopSignalTechniques(raw: string[]): string[] {
  const out = raw.filter((entry) => WORKSHOP_SIGNAL_ALLOWED_TECHNIQUE_IDS.has(entry));
  return out.length > 0 ? out : ["studio-practice"];
}

function techniqueLabelFromIds(ids: string[]): string {
  return ids.map((id) => WORKSHOP_SIGNAL_TECHNIQUE_LABEL_BY_ID[id] ?? "Studio practice").join(", ");
}

function workshopDemandSignalSourceLabel(source: WorkshopDemandSignalSource): string {
  if (source === "events-interest-toggle") return "Interest toggle";
  if (source === "events-interest") return "Interest signal";
  if (source === "events-request-form") return "Workshop request form";
  if (source === "cluster-routing") return "Routing brief";
  if (source === "events-showcase") return "Showcase follow-up";
  if (source === "events-interest-withdrawal") return "Interest withdrawn";
  return "Workshop signal";
}

function normalizeWorkshopSignalLimit(value: unknown): number {
  return Math.min(Math.max(asInt(value, WORKSHOP_SIGNAL_QUERY_LIMIT_DEFAULT), 1), WORKSHOP_SIGNAL_QUERY_LIMIT_MAX);
}

function normalizeWorkshopSignalEventIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  value.forEach((entry) => {
    const raw = safeString(entry).trim();
    if (!raw || out.includes(raw)) return;
    out.push(raw);
  });
  return out;
}

async function fetchEventTitlesById(
  eventIds: string[]
): Promise<Map<string, string>> {
  const eventTitleById = new Map<string, string>();
  for (let index = 0; index < eventIds.length; index += WORKSHOP_SIGNAL_EVENT_ID_BATCH_SIZE) {
    const chunk = eventIds.slice(index, index + WORKSHOP_SIGNAL_EVENT_ID_BATCH_SIZE);
    const snaps = await Promise.all(chunk.map((eventId) => db.collection(EVENTS_COL).doc(eventId).get()));
    snaps.forEach((snap) => {
      if (!snap.exists) return;
      const data = snap.data();
      if (!data) return;
      const title = safeString(data.title);
      if (!title) return;
      eventTitleById.set(snap.id, title);
    });
  }
  return eventTitleById;
}

type WorkshopCommunitySignalEventCount = {
  requestSignals: number;
  interestSignals: number;
  showcaseSignals: number;
  withdrawnSignals: number;
  latestSignalAtMs: number | null;
};

const WORKSHOP_DEMAND_SCORE_WEIGHTS = {
  request: 3,
  interest: 1,
  showcase: 1,
  withdrawn: -0.5,
} as const;

function computeWorkshopDemandScore(counts: WorkshopCommunitySignalEventCount): number {
  const requestSignals = Math.max(0, counts.requestSignals);
  const interestSignals = Math.max(0, counts.interestSignals);
  const showcaseSignals = Math.max(0, counts.showcaseSignals);
  const withdrawnSignals = Math.max(0, counts.withdrawnSignals);

  const weightedScore =
    requestSignals * WORKSHOP_DEMAND_SCORE_WEIGHTS.request +
    interestSignals * WORKSHOP_DEMAND_SCORE_WEIGHTS.interest +
    showcaseSignals * WORKSHOP_DEMAND_SCORE_WEIGHTS.showcase +
    withdrawnSignals * WORKSHOP_DEMAND_SCORE_WEIGHTS.withdrawn;

  return Math.round(Math.max(0, weightedScore) * 10) / 10;
}

type WorkshopCommunitySignalRequestEventCandidate = {
  uid: string;
  sourceEventId: string;
  action: "request";
  createdAtMs: number;
};

type WorkshopCommunitySignalEventCandidate = {
  uid: string;
  sourceEventId: string;
  action: Exclude<WorkshopDemandSignalAction, "request">;
  createdAtMs: number;
};

export async function collectWorkshopCommunitySignalCountsByEventIds(
  authUid: string,
  eventIds: string[]
): Promise<Map<string, WorkshopCommunitySignalEventCount>> {
  const normalizedEventIds = normalizeWorkshopSignalEventIds(eventIds);
  if (!normalizedEventIds.length) return new Map();
  const toErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message || "Unknown error";
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      return String((error as { message?: unknown }).message ?? "Unknown error");
    }
    return "Unknown error";
  };

  const eventIdSet = new Set(normalizedEventIds);
  const sourceFilter = [...WORKSHOP_DEMAND_SIGNAL_EVENT_SOURCES];
  const signalDocsById = new Map<string, { id: string; raw: Record<string, any> }>();
  const eventIdsWithRecognizedSourceSignals = new Set<string>();
  const queryLimit = WORKSHOP_SIGNAL_QUERY_LIMIT_DEFAULT;
  const queryPageLimit = WORKSHOP_SIGNAL_QUERY_PAGE_LIMIT;

  const addSignalDoc = (docSnap: any) => {
    if (!docSnap?.id) return;
    if (signalDocsById.has(docSnap.id)) return;
    const raw = docSnap.data() as Record<string, any>;
    const eventId = parseWorkshopSignalEventId(raw.eventId, safeString(raw.body) || "");
    if (eventId && eventIdSet.has(eventId)) {
      eventIdsWithRecognizedSourceSignals.add(eventId);
    }
    signalDocsById.set(docSnap.id, { id: docSnap.id, raw });
  };

  const collectPaged = async (
    buildQuery: (pageCursor: unknown | undefined) => any,
    options: {
      ordered: boolean;
      sourceFilter?: WorkshopDemandSignalSource[];
      sourceValue?: null | "";
      eventIdChunkSize?: number;
      label: string;
    }
  ): Promise<void> => {
    const ordered = options.ordered === false ? false : true;
    const firstQuery = buildQuery(undefined);

    if (!ordered) {
      const snaps = await firstQuery.get();
      snaps.forEach((docSnap: any) => addSignalDoc(docSnap));
      return;
    }

    let pageCursor: unknown | undefined;
    for (let pageIndex = 0; pageIndex < queryPageLimit; pageIndex += 1) {
      const pageQuery = pageCursor ? buildQuery(pageCursor) : firstQuery;
      const pageSnaps = await pageQuery.limit(queryLimit).get();
      const docs = pageSnaps.docs ?? [];
      for (const docSnap of docs) {
        addSignalDoc(docSnap);
      }

      if (!Array.isArray(docs) || docs.length < queryLimit) {
        return;
      }
      if (typeof pageQuery.startAfter !== "function") {
        logger.warn("collectWorkshopCommunitySignalCountsByEventIds query pagination unsupported", {
          message: options.label,
          sourceFilter: options.sourceFilter,
          sourceValue: options.sourceValue,
          eventIdChunkSize: options.eventIdChunkSize ?? 0,
        });
        return;
      }
      pageCursor = docs[docs.length - 1];
    }

    logger.warn("collectWorkshopCommunitySignalCountsByEventIds query pagination reached cap", {
      message: options.label,
      sourceFilter: options.sourceFilter,
      sourceValue: options.sourceValue,
      eventIdChunkSize: options.eventIdChunkSize ?? 0,
      pageLimit: queryPageLimit,
    });
  };

  const collectBySourceFilter = async (
    sources: WorkshopDemandSignalSource[],
    eventIdChunk?: string[],
    includeOrder = true
  ) => {
    if (sources.length === 0) return;
    const sourceChunks = splitArrayIntoChunks(sources, WORKSHOP_SIGNAL_SOURCE_QUERY_CHUNK_SIZE);

    const buildQuery = (sourceChunk: WorkshopDemandSignalSource[], chunk?: string[], ordered = true) => {
      let query = db
        .collection(SUPPORT_REQUESTS_COL)
        .where("category", "==", "Workshops")
        .where("source", "in", sourceChunk) as any;
      if (chunk?.length) {
        query = query.where("eventId", "in", chunk);
      }
      if (ordered) {
        query = query.orderBy("createdAt", "desc");
      }
      return query;
    };

    const collectChunk = async (
      sourceChunk: WorkshopDemandSignalSource[],
      chunk?: string[],
      ordered = true
    ) => {
      const context = {
        ordered,
        sourceFilter: sourceChunk,
        eventIdChunkSize: chunk?.length ?? 0,
        label: "collectWorkshopCommunitySignalCountsByEventIds source query",
      };

      try {
        await collectPaged(
          (cursor) => {
            const baseQuery = buildQuery(sourceChunk, chunk, ordered);
            if (!cursor) return baseQuery;
            return baseQuery.startAfter(cursor);
          },
          context,
        );
        return;
      } catch (error: any) {
        if (!ordered) {
          logger.warn("collectWorkshopCommunitySignalCountsByEventIds source query failed", {
            message: toErrorMessage(error),
            sourceFilter: sourceChunk,
            sourceCount: sourceChunk.length,
            eventIdChunkSize: chunk?.length ?? 0,
            ordered: false,
          });
          return;
        }
        logger.warn("collectWorkshopCommunitySignalCountsByEventIds source query fallback w/o orderBy", {
          message: toErrorMessage(error),
          sourceFilter: sourceChunk,
          sourceCount: sourceChunk.length,
          eventIdChunkSize: chunk?.length ?? 0,
        });
        try {
          const fallbackSnaps = await buildQuery(sourceChunk, chunk, false).get();
          fallbackSnaps.forEach((docSnap: any) => addSignalDoc(docSnap));
        } catch (fallbackError: any) {
          logger.warn("collectWorkshopCommunitySignalCountsByEventIds source query fallback failed", {
            message: toErrorMessage(fallbackError),
            sourceFilter: sourceChunk,
            sourceCount: sourceChunk.length,
            eventIdChunkSize: chunk?.length ?? 0,
          });
        }
      }
    };

    if (!eventIdChunk?.length) {
      for (const sourceChunk of sourceChunks) {
        await collectChunk(sourceChunk, undefined, includeOrder);
      }
    } else {
      for (const sourceChunk of sourceChunks) {
        for (const eventIdChunkPart of splitArrayIntoChunks(eventIdChunk, WORKSHOP_SIGNAL_EVENT_ID_QUERY_CHUNK_SIZE)) {
          await collectChunk(sourceChunk, eventIdChunkPart, includeOrder);
        }
      }
    }
  };

  const collectWithoutSource = async (eventIdChunk?: string[]) => {
    const collectChunk = async (
      sourceValue: null | "",
      chunk?: string[],
      ordered = true,
    ) => {
      try {
        const buildQuery = () => {
          let query = db
            .collection(SUPPORT_REQUESTS_COL)
            .where("category", "==", "Workshops")
            .where("source", "==", sourceValue) as any;
          if (ordered) {
            query = query.orderBy("createdAt", "desc");
          }
          if (chunk?.length) {
            query = query.where("eventId", "in", chunk);
          }
          return query;
        };
        await collectPaged(
          (cursor) => {
            const baseQuery = buildQuery();
            if (!cursor) return baseQuery;
            return baseQuery.startAfter(cursor);
          },
          {
            ordered,
            sourceValue,
            eventIdChunkSize: chunk?.length ?? 0,
            label: "collectWorkshopCommunitySignalCountsByEventIds null-source query",
          },
        );
        return;
      } catch (error: any) {
        if (!ordered) {
          logger.warn("collectWorkshopCommunitySignalCountsByEventIds null-source query failed", {
            message: toErrorMessage(error),
            eventIdChunkSize: chunk?.length ?? 0,
            sourceValue,
            ordered: false,
          });
          return;
        }
        logger.warn("collectWorkshopCommunitySignalCountsByEventIds null-source fallback w/o orderBy", {
          message: toErrorMessage(error),
          eventIdChunkSize: chunk?.length ?? 0,
          sourceValue,
        });
        let fallbackQuery = db
          .collection(SUPPORT_REQUESTS_COL)
          .where("category", "==", "Workshops")
          .where("source", "==", sourceValue) as any;
        if (chunk?.length) {
          fallbackQuery = fallbackQuery.where("eventId", "in", chunk);
        }
        try {
          const snaps = await fallbackQuery.limit(queryLimit).get();
          snaps.forEach((docSnap: any) => addSignalDoc(docSnap));
        } catch (fallbackError: any) {
          logger.warn("collectWorkshopCommunitySignalCountsByEventIds null-source fallback failed", {
            message: toErrorMessage(fallbackError),
            eventIdChunkSize: chunk?.length ?? 0,
            sourceValue,
          });
        }
      }
    };

    if (!eventIdChunk?.length) {
      await collectChunk(null, undefined, true);
      await collectChunk("", undefined, true);
      return;
    }
    for (const eventIdChunkPart of splitArrayIntoChunks(eventIdChunk, WORKSHOP_SIGNAL_EVENT_ID_QUERY_CHUNK_SIZE)) {
      await collectChunk(null, eventIdChunkPart, true);
      await collectChunk("", eventIdChunkPart, true);
    }
  };

  const collectWithoutSourceFilter = async (eventIdChunk?: string[]) => {
    const collectChunk = async (
      chunk?: string[],
      ordered = true,
    ) => {
      try {
        const buildQuery = () => {
          let query = db
            .collection(SUPPORT_REQUESTS_COL)
            .where("category", "==", "Workshops") as any;
          if (ordered) {
            query = query.orderBy("createdAt", "desc");
          }
          if (chunk?.length) {
            query = query.where("eventId", "in", chunk);
          }
          return query;
        }
        await collectPaged(
          (cursor) => {
            const baseQuery = buildQuery();
            if (!cursor) return baseQuery;
            return baseQuery.startAfter(cursor);
          },
          {
            ordered,
            eventIdChunkSize: chunk?.length ?? 0,
            label: "collectWorkshopCommunitySignalCountsByEventIds source-free query",
          },
        );
        return;
      } catch (error: any) {
        if (!ordered) {
          logger.warn("collectWorkshopCommunitySignalCountsByEventIds source-free query failed", {
            message: toErrorMessage(error),
            eventIdChunkSize: chunk?.length ?? 0,
            ordered: false,
          });
          return;
        }
        logger.warn("collectWorkshopCommunitySignalCountsByEventIds source-free query fallback w/o orderBy", {
          message: toErrorMessage(error),
          eventIdChunkSize: chunk?.length ?? 0,
        });
        let fallbackQuery = db
          .collection(SUPPORT_REQUESTS_COL)
          .where("category", "==", "Workshops") as any;
        if (chunk?.length) {
          fallbackQuery = fallbackQuery.where("eventId", "in", chunk);
        }
        try {
          const snaps = await fallbackQuery.limit(queryLimit).get();
          snaps.forEach((docSnap: any) => addSignalDoc(docSnap));
        } catch (fallbackError: any) {
          logger.warn("collectWorkshopCommunitySignalCountsByEventIds source-free fallback failed", {
            message: toErrorMessage(fallbackError),
            eventIdChunkSize: chunk?.length ?? 0,
          });
        }
      }
    };

    if (!eventIdChunk?.length) {
      await collectChunk(undefined, true);
      return;
    }
    for (const eventIdChunkPart of splitArrayIntoChunks(eventIdChunk, WORKSHOP_SIGNAL_EVENT_ID_QUERY_CHUNK_SIZE)) {
      await collectChunk(eventIdChunkPart, true);
    }
  };

  try {
    await collectBySourceFilter(sourceFilter, normalizedEventIds);
    const eventsWithoutRecognizedSourceSignal = normalizedEventIds.filter(
      (eventId) => !eventIdsWithRecognizedSourceSignals.has(eventId)
    );

    if (eventsWithoutRecognizedSourceSignal.length > 0) {
      await collectWithoutSource(eventsWithoutRecognizedSourceSignal);
      await collectWithoutSourceFilter(eventsWithoutRecognizedSourceSignal);
    }

    const createEmptySignalCounts = (): WorkshopCommunitySignalEventCount => ({
      requestSignals: 0,
      interestSignals: 0,
      showcaseSignals: 0,
      withdrawnSignals: 0,
      latestSignalAtMs: null,
    });

    const latestRequestByMemberEvent = new Map<string, WorkshopCommunitySignalRequestEventCandidate>();
    const latestCommunityByMemberEvent = new Map<string, WorkshopCommunitySignalEventCandidate>();
    for (const { raw } of signalDocsById.values()) {
      const uid = safeString(raw.uid);
      if (!uid || uid === authUid) continue;

      const subject = safeString(raw.subject);
      const source = inferWorkshopSignalSource(raw.source, subject, safeString(raw.body));
      if (!source) continue;

      const action = parseWorkshopSignalAction(source);

      const body = safeString(raw.body);
      const eventId = parseWorkshopSignalEventId(raw.eventId, body);
      if (!eventId || !eventIdSet.has(eventId)) continue;
      eventIdsWithRecognizedSourceSignals.add(eventId);

      const createdAt = parseTimestamp(raw.createdAt);
      if (!createdAt) continue;
      const createdAtMs = createdAt.toMillis();
      if (!Number.isFinite(createdAtMs)) continue;

      if (action === "request") {
        const requestKey = `${uid}|request|${eventId}`;
        const existingRequest = latestRequestByMemberEvent.get(requestKey);
        if (existingRequest && existingRequest.createdAtMs >= createdAtMs) continue;
        latestRequestByMemberEvent.set(requestKey, { uid, sourceEventId: eventId, action, createdAtMs });
        continue;
      }

      const latestKey = `${uid}|${eventId}`;
      const latestCommunitySignal = latestCommunityByMemberEvent.get(latestKey);
      if (latestCommunitySignal && latestCommunitySignal.createdAtMs >= createdAtMs) continue;
      latestCommunityByMemberEvent.set(latestKey, { uid, sourceEventId: eventId, action, createdAtMs });
    }

    const countsByEvent = new Map<string, WorkshopCommunitySignalEventCount>();
    latestRequestByMemberEvent.forEach((signal) => {
      const next = countsByEvent.get(signal.sourceEventId) ?? createEmptySignalCounts();
      next.requestSignals += 1;
      next.latestSignalAtMs = next.latestSignalAtMs === null
        ? signal.createdAtMs
        : Math.max(next.latestSignalAtMs, signal.createdAtMs);
      countsByEvent.set(signal.sourceEventId, next);
    });

    latestCommunityByMemberEvent.forEach((signal) => {
      const next = countsByEvent.get(signal.sourceEventId) ?? createEmptySignalCounts();
      const action = signal.action as WorkshopDemandSignalAction;
      if (action === "withdrawal") {
        next.withdrawnSignals += 1;
      } else if (action === "showcase") {
        next.showcaseSignals += 1;
      } else {
        next.interestSignals += 1;
      }
      next.latestSignalAtMs = next.latestSignalAtMs === null
        ? signal.createdAtMs
        : Math.max(next.latestSignalAtMs, signal.createdAtMs);
      countsByEvent.set(signal.sourceEventId, next);
    });

    return countsByEvent;
  } catch (error: unknown) {
    logger.warn("collectWorkshopCommunitySignalCountsByEventIds failed; returning empty community signal counts", {
      message: toErrorMessage(error),
      authUid,
      requestedEventCount: normalizedEventIds.length,
    });
    return new Map<string, WorkshopCommunitySignalEventCount>();
  }
}

function normalizeWorkshopDemandSignalSourceList(value: unknown): WorkshopDemandSignalSource[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...WORKSHOP_DEMAND_SIGNAL_EVENT_SOURCES];
  }

  const out: WorkshopDemandSignalSource[] = [];
  value.forEach((entry) => {
    const source = parseWorkshopSignalSource(entry);
    if (source) out.push(source);
  });

  if (!out.length) {
    return [...WORKSHOP_DEMAND_SIGNAL_EVENT_SOURCES];
  }

  const deduped: WorkshopDemandSignalSource[] = [];
  out.forEach((source) => {
    if (!deduped.includes(source)) deduped.push(source);
  });

  return deduped;
}

function splitArrayIntoChunks<T>(values: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [];
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    out.push(values.slice(index, index + chunkSize));
  }
  return out;
}

const staffSetEventStatusSchema = z.object({
  eventId: z.string().min(1),
  status: z.enum(["draft", "cancelled"]),
  reason: z.string().max(500).optional().nullable(),
});

const createEventSchema = z.object({
  templateId: z.string().optional().nullable(),
  title: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().min(1),
  location: z.string().min(1),
  timezone: z.string().min(1),
  startAt: z.any(),
  endAt: z.any(),
  capacity: z.number().int().nonnegative(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().min(1),
  includesFiring: z.boolean(),
  firingDetails: z.string().optional().nullable(),
  policyCopy: z.string().optional().nullable(),
  addOns: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        priceCents: z.number().int().nonnegative(),
        isActive: z.boolean(),
      })
    )
    .optional(),
  waitlistEnabled: z.boolean().optional(),
  offerClaimWindowHours: z.number().int().positive().optional(),
  cancelCutoffHours: z.number().int().nonnegative().optional(),
});

const signupSchema = z.object({
  eventId: z.string().min(1),
});

const signupIdSchema = z.object({
  signupId: z.string().min(1),
});

const checkInSchema = z.object({
  signupId: z.string().min(1),
  method: z.enum(["staff", "self"]),
});

const checkoutSchema = z.object({
  eventId: z.string().min(1),
  signupId: z.string().min(1),
  addOnIds: z.array(z.string()).optional(),
});

function getStripe(): Stripe {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  if (!stripeClient) {
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

function getPortalBaseUrl(req: any): string {
  const configured = (process.env.PORTAL_BASE_URL ?? "").trim();
  if (configured) return configured.replace(/\/+$/, "");

  const origin = typeof req.headers?.origin === "string" ? req.headers.origin : "";
  if (origin) return origin.replace(/\/+$/, "");

  const referer = typeof req.headers?.referer === "string" ? req.headers.referer : "";
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin.replace(/\/+$/, "");
    } catch {
      // ignore
    }
  }

  return "";
}

function normalizeCurrency(value: string | undefined) {
  const raw = safeString(value).trim();
  if (!raw) return "USD";
  return raw.toUpperCase();
}

function parseTimestamp(value: unknown): Timestamp | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return Timestamp.fromDate(parsed);
  }
  if (typeof value === "object") {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      try {
        return Timestamp.fromDate(maybe.toDate());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function toIso(value: unknown): string | null {
  const ts = parseTimestamp(value);
  if (!ts) return null;
  try {
    return ts.toDate().toISOString();
  } catch {
    return null;
  }
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = safeString(value).trim();
  return normalized || null;
}

function normalizeOptionalUrl(value: unknown): string | null {
  const normalized = safeString(value).trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (!url.protocol.startsWith("http")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  raw.forEach((entry) => {
    const normalized = safeString(entry).trim().toLowerCase();
    if (!normalized || out.includes(normalized)) return;
    out.push(normalized);
  });
  return out.slice(0, 20);
}

function normalizeTitleForHash(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostForDedupe(url: string | null): string {
  if (!url) return "manual";
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "manual";
  }
}

function industryEventDedupeHash(params: {
  title: string;
  startAt: Timestamp | null;
  sourceUrl: string | null;
}): string {
  const dateKey = params.startAt ? params.startAt.toDate().toISOString().slice(0, 10) : "no-date";
  const raw = `${normalizeTitleForHash(params.title)}|${dateKey}|${hostForDedupe(params.sourceUrl)}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

function industryEventQualityScore(params: {
  summary: string;
  startAt: Timestamp | null;
  remoteUrl: string | null;
  registrationUrl: string | null;
  sourceUrl: string | null;
  verifiedAt: Timestamp | null;
}): number {
  let score = 35;
  if (params.summary.trim().length >= 24) score += 10;
  if (params.startAt) score += 20;
  if (params.remoteUrl || params.registrationUrl) score += 15;
  if (params.sourceUrl) score += 10;
  if (params.verifiedAt) score += 10;
  return Math.min(100, Math.max(0, score));
}

function industryCurationStateForStatus(status: "draft" | "published" | "cancelled"): string {
  if (status === "published") return "published";
  if (status === "cancelled") return "retired";
  return "draft";
}

type SweepIndustryEventsFreshnessOptions = {
  dryRun?: boolean;
  limit?: number;
  staleReviewMs?: number;
  retirePastMs?: number;
  source?: "scheduled" | "manual";
  nowMs?: number;
};

type SweepIndustryEventsFreshnessResult = {
  dryRun: boolean;
  source: "scheduled" | "manual";
  scanned: number;
  updated: number;
  retired: number;
  staleReview: number;
  fresh: number;
  nonPublished: number;
};

async function sweepIndustryEventsFreshness(
  options: SweepIndustryEventsFreshnessOptions = {}
): Promise<SweepIndustryEventsFreshnessResult> {
  const dryRun = options.dryRun === true;
  const source = options.source ?? "scheduled";
  const limit = Math.min(Math.max(asInt(options.limit, 250), 1), 500);
  const staleReviewMs = Math.max(
    60_000,
    asInt(options.staleReviewMs, INDUSTRY_EVENT_REVIEW_STALE_MS)
  );
  const retirePastMs = Math.max(
    60_000,
    asInt(options.retirePastMs, INDUSTRY_EVENT_RETIRE_PAST_MS)
  );
  const nowMs = options.nowMs ?? Date.now();

  const snap = await db.collection(INDUSTRY_EVENTS_COL).limit(limit).get();
  if (snap.empty) {
    return {
      dryRun,
      source,
      scanned: 0,
      updated: 0,
      retired: 0,
      staleReview: 0,
      fresh: 0,
      nonPublished: 0,
    };
  }

  const summary: SweepIndustryEventsFreshnessResult = {
    dryRun,
    source,
    scanned: 0,
    updated: 0,
    retired: 0,
    staleReview: 0,
    fresh: 0,
    nonPublished: 0,
  };
  const t = nowTs();

  for (const docSnap of snap.docs) {
    const raw = (docSnap.data() as Record<string, unknown>) ?? {};
    const normalized = normalizeIndustryEvent(docSnap.id, raw);
    const decision = evaluateIndustryEventFreshness(normalized, {
      nowMs,
      staleReviewMs,
      retirePastMs,
    });

    summary.scanned += 1;
    if (decision.outcome === "retired") summary.retired += 1;
    else if (decision.outcome === "stale_review") summary.staleReview += 1;
    else if (decision.outcome === "fresh") summary.fresh += 1;
    else summary.nonPublished += 1;

    const currentStatus = safeString(raw["status"]).trim() || "draft";
    const currentFreshnessState = normalizeOptionalText(raw["freshnessState"]);
    const currentNeedsReview = raw["needsReview"] === true;
    const currentReviewByAt = toIso(raw["reviewByAt"]);
    const currentRetiredReason = normalizeOptionalText(raw["retiredReason"]);
    const currentRetiredAt = toIso(raw["retiredAt"]);

    const patch: Record<string, unknown> = {};
    if (currentStatus !== decision.nextStatus) {
      patch.status = decision.nextStatus;
    }
    if (currentFreshnessState !== decision.freshnessState) {
      patch.freshnessState = decision.freshnessState;
    }
    if (currentNeedsReview !== decision.needsReview) {
      patch.needsReview = decision.needsReview;
    }
    if (currentReviewByAt !== decision.reviewByAt) {
      patch.reviewByAt = decision.reviewByAt ? parseTimestamp(decision.reviewByAt) : null;
    }
    if (decision.shouldRetire) {
      if (!currentRetiredAt) {
        patch.retiredAt = t;
      }
      if (currentRetiredReason !== decision.retiredReason) {
        patch.retiredReason = decision.retiredReason;
      }
    } else if (decision.nextStatus === "published" && (currentRetiredAt || currentRetiredReason)) {
      patch.retiredAt = null;
      patch.retiredReason = null;
    }

    if (Object.keys(patch).length === 0) continue;

    patch.freshnessCheckedAt = t;
    patch.freshnessSweepSource = source;
    patch.updatedAt = t;
    summary.updated += 1;

    if (!dryRun) {
      await docSnap.ref.set(patch, { merge: true });
    }
  }

  return summary;
}

type EventAddOn = {
  id: string;
  title: string;
  priceCents: number;
  isActive: boolean;
};

function normalizeAddOns(raw: unknown): EventAddOn[] {
  if (!Array.isArray(raw)) return [];
  const normalized: EventAddOn[] = [];

  raw.forEach((item) => {
    const id = safeString(item?.id).trim();
    const title = safeString(item?.title).trim();
    const priceCents = asInt(item?.priceCents, 0);
    const isActive = item?.isActive !== false;

    if (!id || !title || priceCents < 0) return;

    normalized.push({ id, title, priceCents, isActive });
  });

  return normalized;
}

function readCounts(eventData: Record<string, any>) {
  const ticketedCount = Math.max(asInt(eventData.ticketedCount, 0), 0);
  const offeredCount = Math.max(asInt(eventData.offeredCount, 0), 0);
  const checkedInCount = Math.max(asInt(eventData.checkedInCount, 0), 0);
  const waitlistCount = Math.max(asInt(eventData.waitlistCount, 0), 0);

  return { ticketedCount, offeredCount, checkedInCount, waitlistCount };
}

function computeRemainingCapacity(eventData: Record<string, any>): number {
  const capacity = Math.max(asInt(eventData.capacity, 0), 0);
  const counts = readCounts(eventData);
  const reserved = counts.ticketedCount + counts.offeredCount + counts.checkedInCount;
  return Math.max(capacity - reserved, 0);
}

async function readUserIdentity(uid: string): Promise<{ displayName: string | null; email: string | null }> {
  try {
    const user = await adminAuth.getUser(uid);
    return { displayName: user.displayName ?? null, email: user.email ?? null };
  } catch {
    return { displayName: null, email: null };
  }
}

function defaultPolicyCopy() {
  return "You won't be charged unless you attend. If plans change, no worries - cancel anytime up to 3 hours before the event.";
}
export const listEvents = onRequest({ region: REGION, cors: true }, async (req, res) => {
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

  const parsed = parseBody(listEventsSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "listEvents",
    max: 30,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const includeDrafts = parsed.data.includeDrafts === true;
  const includeCancelled = parsed.data.includeCancelled === true;
  const includeCommunitySignals = parsed.data.includeCommunitySignals === true;

  if (includeDrafts || includeCancelled) {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }
  }

  try {
    let snaps;
    if (includeDrafts || includeCancelled) {
      snaps = await db.collection(EVENTS_COL).get();
    } else {
      snaps = await db.collection(EVENTS_COL).where("status", "==", "published").get();
    }

    let events = snaps.docs.reduce<
      {
        id: string;
        title: string;
        summary: string;
        startAt: string | null;
        endAt: string | null;
        timezone: string;
        location: string;
        priceCents: number;
        currency: string;
        includesFiring: boolean;
        firingDetails: string | null;
        capacity: number;
        waitlistEnabled: boolean;
        waitlistCount?: number | null;
        status: string;
        remainingCapacity: number;
      }[]
    >((acc, docSnap) => {
      const data = (docSnap.data() as Record<string, any>) ?? {};
      const status = safeString(data.status).trim();
      if (!includeDrafts && status === "draft") return acc;
      if (!includeCancelled && status === "cancelled") return acc;

      const counts = readCounts(data);
      acc.push({
        id: docSnap.id,
        title: safeString(data.title),
        summary: safeString(data.summary),
        startAt: toIso(data.startAt),
        endAt: toIso(data.endAt),
        timezone: safeString(data.timezone),
        location: safeString(data.location),
        priceCents: asInt(data.priceCents, 0),
        currency: normalizeCurrency(data.currency),
        includesFiring: data.includesFiring === true,
        firingDetails: data.firingDetails ?? null,
        capacity: Math.max(asInt(data.capacity, 0), 0),
        waitlistEnabled: data.waitlistEnabled !== false,
        status: status || "draft",
        waitlistCount: counts.waitlistCount,
        remainingCapacity: computeRemainingCapacity(data),
      });
      return acc;
    }, []);

    if (includeCommunitySignals) {
      const eventIds = events.map((event) => event.id);
      const communitySignalCounts = await collectWorkshopCommunitySignalCountsByEventIds(auth.uid, eventIds);
      if (communitySignalCounts.size > 0) {
        events = events.map((event) => {
          const communitySignalCount = communitySignalCounts.get(event.id);
          if (!communitySignalCount) return event;
          const totalSignals = Math.max(
            communitySignalCount.requestSignals +
              communitySignalCount.interestSignals +
              communitySignalCount.showcaseSignals,
            0,
          );
          const demandScore = computeWorkshopDemandScore(communitySignalCount);
          return {
            ...event,
            communitySignalCounts: {
              requestSignals: communitySignalCount.requestSignals,
              interestSignals: communitySignalCount.interestSignals,
              showcaseSignals: communitySignalCount.showcaseSignals,
              withdrawnSignals: communitySignalCount.withdrawnSignals,
              totalSignals,
              demandScore,
              latestSignalAtMs: communitySignalCount.latestSignalAtMs,
            },
          };
        });
      }
    }

    res.status(200).json({ ok: true, events });
  } catch (err: any) {
    logger.error("listEvents failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});

export const listIndustryEvents = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(listIndustryEventsSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const includeDrafts = parsed.data.includeDrafts === true;
  const includeCancelled = parsed.data.includeCancelled === true;
  const includePast = parsed.data.includePast === true;
  const featuredOnly = parsed.data.featuredOnly === true;
  const mode = parsed.data.mode ?? "all";
  const limit = Math.min(Math.max(asInt(parsed.data.limit, 80), 1), 200);

  if (includeDrafts || includeCancelled) {
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }
  }

  const rate = await enforceRateLimit({
    req,
    key: "listIndustryEvents",
    max: 30,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  try {
    const baseQuery =
      includeDrafts || includeCancelled
        ? db.collection(INDUSTRY_EVENTS_COL)
        : db.collection(INDUSTRY_EVENTS_COL).where("status", "==", "published");
    const snaps = await baseQuery.limit(500).get();

    const normalized = snaps.docs.map((docSnap) => normalizeIndustryEvent(docSnap.id, docSnap.data()));
    const events = filterIndustryEvents(normalized, {
      mode,
      includePast,
      includeDrafts,
      includeCancelled,
      featuredOnly,
      limit,
    });

    res.status(200).json({ ok: true, events });
  } catch (err: any) {
    logger.error("listIndustryEvents failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});

export const getIndustryEvent = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(industryEventIdSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "getIndustryEvent",
    max: 60,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const eventId = safeString(parsed.data.eventId).trim();
  try {
    const docSnap = await db.collection(INDUSTRY_EVENTS_COL).doc(eventId).get();
    if (!docSnap.exists) {
      res.status(404).json({ ok: false, message: "Industry event not found" });
      return;
    }

    const event = normalizeIndustryEvent(docSnap.id, docSnap.data());
    if (event.status !== "published") {
      const admin = await requireAdmin(req);
      if (!admin.ok) {
        res.status(403).json({ ok: false, message: "Forbidden" });
        return;
      }
    }

    res.status(200).json({ ok: true, event });
  } catch (err: any) {
    logger.error("getIndustryEvent failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});

export const upsertIndustryEvent = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(upsertIndustryEventSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "upsertIndustryEvent",
    max: 20,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const eventIdInput = normalizeOptionalText(parsed.data.eventId);
  const title = safeString(parsed.data.title).trim();
  const summary = safeString(parsed.data.summary).trim();
  const description = normalizeOptionalText(parsed.data.description);
  const location = normalizeOptionalText(parsed.data.location);
  const remoteUrlInput = normalizeOptionalText(parsed.data.remoteUrl);
  const registrationUrlInput = normalizeOptionalText(parsed.data.registrationUrl);
  const sourceUrlInput = normalizeOptionalText(parsed.data.sourceUrl);
  const remoteUrl = normalizeOptionalUrl(remoteUrlInput);
  const registrationUrl = normalizeOptionalUrl(registrationUrlInput);
  const sourceUrl = normalizeOptionalUrl(sourceUrlInput);
  const sourceName = normalizeOptionalText(parsed.data.sourceName);
  const mode = normalizeIndustryEventMode(parsed.data.mode, { location, remoteUrl });
  const status = parsed.data.status ?? "draft";
  const featured = parsed.data.featured === true;
  const startAt = parseTimestamp(parsed.data.startAt);
  const endAt = parseTimestamp(parsed.data.endAt);
  const verifiedAt = parseTimestamp(parsed.data.verifiedAt);

  if (!title || !summary) {
    res.status(400).json({ ok: false, message: "title and summary are required." });
    return;
  }

  if (eventIdInput?.includes("/")) {
    res.status(400).json({ ok: false, message: "eventId cannot include '/'." });
    return;
  }

  if (remoteUrlInput && !remoteUrl) {
    res.status(400).json({ ok: false, message: "remoteUrl must be a valid http(s) URL." });
    return;
  }

  if (registrationUrlInput && !registrationUrl) {
    res.status(400).json({ ok: false, message: "registrationUrl must be a valid http(s) URL." });
    return;
  }

  if (sourceUrlInput && !sourceUrl) {
    res.status(400).json({ ok: false, message: "sourceUrl must be a valid http(s) URL." });
    return;
  }

  if (startAt && endAt && startAt.toMillis() >= endAt.toMillis()) {
    res.status(400).json({ ok: false, message: "startAt must be before endAt" });
    return;
  }

  if (status === "published") {
    if (!startAt) {
      res.status(400).json({ ok: false, message: "startAt is required for published industry events." });
      return;
    }
    if (!registrationUrl && !remoteUrl && !sourceUrl) {
      res.status(400).json({
        ok: false,
        message: "Published industry events require registrationUrl, remoteUrl, or sourceUrl.",
      });
      return;
    }
  }

  try {
    const t = nowTs();
    const dedupeHash = industryEventDedupeHash({ title, startAt, sourceUrl });
    const qualityScore = industryEventQualityScore({
      summary,
      startAt,
      remoteUrl,
      registrationUrl,
      sourceUrl,
      verifiedAt,
    });
    const curationState = industryCurationStateForStatus(status);
    const eventRef = eventIdInput
      ? db.collection(INDUSTRY_EVENTS_COL).doc(eventIdInput)
      : db.collection(INDUSTRY_EVENTS_COL).doc();
    const existingSnap = await eventRef.get();
    const existing = existingSnap.exists ? ((existingSnap.data() as Record<string, unknown>) ?? {}) : null;

    await eventRef.set(
      {
        title,
        summary,
        description,
        mode,
        status,
        startAt: startAt ?? null,
        endAt: endAt ?? null,
        timezone: normalizeOptionalText(parsed.data.timezone),
        location,
        city: normalizeOptionalText(parsed.data.city),
        region: normalizeOptionalText(parsed.data.region),
        country: normalizeOptionalText(parsed.data.country),
        remoteUrl,
        registrationUrl,
        sourceName,
        sourceUrl,
        curationState,
        qualityScore,
        dedupeHash,
        ingestedAt: existing?.ingestedAt ?? t,
        featured,
        tags: normalizeTags(parsed.data.tags),
        verifiedAt: verifiedAt ?? null,
        createdAt: existing?.createdAt ?? t,
        createdByUid: normalizeOptionalText(existing?.createdByUid) ?? auth.uid,
        updatedAt: t,
        updatedByUid: auth.uid,
      },
      { merge: true }
    );

    const nextSnap = await eventRef.get();
    const normalized = normalizeIndustryEvent(eventRef.id, nextSnap.data());
    res.status(200).json({
      ok: true,
      eventId: eventRef.id,
      created: !existingSnap.exists,
      event: normalized,
    });
  } catch (err: any) {
    logger.error("upsertIndustryEvent failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});

export const listEventSignups = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(listEventSignupsSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "listEventSignups",
    max: 20,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const eventId = safeString(parsed.data.eventId).trim();
  const includeCancelled = parsed.data.includeCancelled === true;
  const includeExpired = parsed.data.includeExpired === true;
  const limit = Math.min(Math.max(asInt(parsed.data.limit, 200), 1), 500);

  try {
    const snaps = await db
      .collection(SIGNUPS_COL)
      .where("eventId", "==", eventId)
      .orderBy("createdAt", "asc")
      .limit(limit)
      .get();

    const signups = snaps.docs
      .map((docSnap) => {
        const data = (docSnap.data() as Record<string, any>) ?? {};
        const status = safeString(data.status).trim();
        if (!status) return null;
        if (!includeCancelled && status === "cancelled") return null;
        if (!includeExpired && status === "expired") return null;

        return {
          id: docSnap.id,
          uid: safeString(data.uid) || null,
          status,
          paymentStatus: safeString(data.paymentStatus) || null,
          displayName: safeString(data.displayName) || null,
          email: safeString(data.email) || null,
          createdAt: toIso(data.createdAt),
          offerExpiresAt: toIso(data.offerExpiresAt),
          checkedInAt: toIso(data.checkedInAt),
          checkInMethod: safeString(data.checkInMethod) || null,
        };
      })
      .filter((row) => Boolean(row));

    res.status(200).json({ ok: true, signups });
  } catch (err: any) {
    logger.error("listEventSignups failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});

export const listWorkshopDemandSignals = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(listWorkshopDemandSignalsSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "listWorkshopDemandSignals",
    max: 20,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const sourceFilter = normalizeWorkshopDemandSignalSourceList(parsed.data.sources);
  const requestSourceFilter = sourceFilter.filter(isWorkshopDemandSignalRequestSource);
  const communitySourceFilter = sourceFilter.filter((entry) => !isWorkshopDemandSignalRequestSource(entry));
  const sourceFilterSet = new Set(sourceFilter);
  const limit = normalizeWorkshopSignalLimit(parsed.data.limit);
  const eventIdFilter = normalizeWorkshopSignalEventIds(parsed.data.eventIds);
  const eventIdFilterSet = new Set(eventIdFilter);
  const requestId = String(
    ((req.get && req.get("x-request-id")) || (req.headers["x-request-id"] as unknown) || "") ?? ""
  ).trim();
  const toErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message || "Unknown error";
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      return String((error as { message?: unknown }).message ?? "Unknown error");
    }
    return "Unknown error";
  };

  try {
    const signalDocsById = new Map<string, { id: string; raw: Record<string, any> }>();
    const eventIdsWithRecognizedSourceSignals = new Set<string>();

    const addSignalDoc = (docSnap: any) => {
      if (!docSnap?.id) return;
      if (signalDocsById.has(docSnap.id)) return;
      const raw = docSnap.data() as Record<string, any>;
      const eventId = parseWorkshopSignalEventId(raw.eventId, safeString(raw.body) || "");
      if (eventId && eventIdFilterSet.has(eventId)) {
        eventIdsWithRecognizedSourceSignals.add(eventId);
      }
      signalDocsById.set(docSnap.id, { id: docSnap.id, raw });
    };

    const collectBySourceFilter = async (
      sources: WorkshopDemandSignalSource[],
      eventIds: string[] = []
    ) => {
      if (sources.length === 0) return;
      const sourceChunks = splitArrayIntoChunks(sources, WORKSHOP_SIGNAL_SOURCE_QUERY_CHUNK_SIZE);

      const buildQuery = (
        sourceChunk: WorkshopDemandSignalSource[],
        eventIdChunk?: string[],
        includeOrder = true
      ) => {
        let query = db
          .collection(SUPPORT_REQUESTS_COL)
          .where("category", "==", "Workshops")
          .where("source", "in", sourceChunk) as any;
        if (eventIdChunk?.length) {
          query = query.where("eventId", "in", eventIdChunk);
        }
        if (includeOrder) {
          query = query.orderBy("createdAt", "desc");
        }
        return query.limit(limit);
      };

    const collectChunk = async (
      sourceChunk: WorkshopDemandSignalSource[],
      eventIdChunk?: string[],
      includeOrder = true
    ) => {
        try {
          const snaps = await buildQuery(sourceChunk, eventIdChunk, includeOrder).get();
          snaps.forEach((docSnap: any) => addSignalDoc(docSnap));
          return;
        } catch (error: any) {
          if (!includeOrder) throw error;
          logger.warn("listWorkshopDemandSignals source query fallback w/o orderBy", {
            requestId,
            message: toErrorMessage(error),
            sourceFilter: sourceChunk,
            sourceCount: sourceChunk.length,
            eventIdChunkSize: eventIdChunk?.length ?? 0,
          });
          const fallbackSnaps = await buildQuery(sourceChunk, eventIdChunk, false).get();
          fallbackSnaps.forEach((docSnap: any) => addSignalDoc(docSnap));
        }
      };

      if (eventIds.length === 0) {
        for (const sourceChunk of sourceChunks) {
          await collectChunk(sourceChunk, undefined, true);
        }
        return;
      }

      for (const sourceChunk of sourceChunks) {
        for (const eventIdChunk of splitArrayIntoChunks(eventIds, WORKSHOP_SIGNAL_EVENT_ID_QUERY_CHUNK_SIZE)) {
          await collectChunk(sourceChunk, eventIdChunk, true);
        }
      }
    };

    const collectWithoutSource = async (eventIds: string[] = []) => {
      const collectChunk = async (sourceValue: null | "", eventIdChunk: string[] = [], ordered = true) => {
        try {
          let query = db
            .collection(SUPPORT_REQUESTS_COL)
            .where("category", "==", "Workshops")
            .where("source", "==", sourceValue) as any;
          if (ordered) {
            query = query.orderBy("createdAt", "desc");
          }
          if (eventIdChunk.length > 0) {
            query = query.where("eventId", "in", eventIdChunk);
          }
          const snaps = await query.limit(limit).get();
          snaps.forEach((docSnap: any) => addSignalDoc(docSnap));
        } catch (error: any) {
          if (!ordered) throw error;
          logger.warn("listWorkshopDemandSignals null-source query fallback w/o orderBy", {
            requestId,
            message: toErrorMessage(error),
            eventIdChunkSize: eventIdChunk.length,
            sourceValue,
          });
          let fallbackQuery = db
            .collection(SUPPORT_REQUESTS_COL)
            .where("category", "==", "Workshops")
            .where("source", "==", sourceValue) as any;
          if (eventIdChunk.length > 0) {
            fallbackQuery = fallbackQuery.where("eventId", "in", eventIdChunk);
          }
          const fallbackSnaps = await fallbackQuery.limit(limit).get();
          fallbackSnaps.forEach((docSnap: any) => addSignalDoc(docSnap));
        }
      };

      if (eventIds.length === 0) {
        await collectChunk(null, [], true);
        await collectChunk("", [], true);
        return;
      }

      for (const eventIdChunk of splitArrayIntoChunks(eventIds, WORKSHOP_SIGNAL_EVENT_ID_QUERY_CHUNK_SIZE)) {
        await collectChunk(null, eventIdChunk, true);
        await collectChunk("", eventIdChunk, true);
      }
    };

    const collectWithoutSourceFilter = async (eventIds: string[] = []) => {
      const collectChunk = async (eventIdChunk: string[] = [], ordered = true) => {
        try {
          let query = db.collection(SUPPORT_REQUESTS_COL).where("category", "==", "Workshops") as any;
          if (ordered) {
            query = query.orderBy("createdAt", "desc");
          }
          if (eventIdChunk.length > 0) {
            query = query.where("eventId", "in", eventIdChunk);
          }
          const snaps = await query.limit(limit).get();
          snaps.forEach((docSnap: any) => addSignalDoc(docSnap));
        } catch (error: any) {
          if (!ordered) throw error;
          logger.warn("listWorkshopDemandSignals source-free query fallback w/o orderBy", {
            requestId,
            message: toErrorMessage(error),
            eventIdChunkSize: eventIdChunk.length,
          });
          let fallbackQuery = db.collection(SUPPORT_REQUESTS_COL).where("category", "==", "Workshops") as any;
          if (eventIdChunk.length > 0) {
            fallbackQuery = fallbackQuery.where("eventId", "in", eventIdChunk);
          }
          const fallbackSnaps = await fallbackQuery.limit(limit).get();
          fallbackSnaps.forEach((docSnap: any) => addSignalDoc(docSnap));
        }
      };

      if (eventIds.length === 0) {
        await collectChunk([], true);
        return;
      }

      for (const eventIdChunk of splitArrayIntoChunks(eventIds, WORKSHOP_SIGNAL_EVENT_ID_QUERY_CHUNK_SIZE)) {
        await collectChunk(eventIdChunk, true);
      }
    };

    if (eventIdFilter.length === 0) {
      await collectBySourceFilter(sourceFilter);
      await collectWithoutSource();
      await collectWithoutSourceFilter();
    } else {
      if (requestSourceFilter.length > 0) {
        await collectBySourceFilter(requestSourceFilter);
      }
      if (communitySourceFilter.length > 0) {
        await collectBySourceFilter(communitySourceFilter, eventIdFilter);
      }

      if (signalDocsById.size === 0) {
        await collectBySourceFilter(sourceFilter);
        await collectWithoutSource();
        await collectWithoutSourceFilter(eventIdFilter);
      } else {
        const eventsWithoutRecognizedSourceSignal = eventIdFilter.filter(
          (eventId) => !eventIdsWithRecognizedSourceSignals.has(eventId)
        );
        if (eventsWithoutRecognizedSourceSignal.length > 0) {
          await collectWithoutSourceFilter(eventsWithoutRecognizedSourceSignal);
        }
      }

      await collectWithoutSource(eventIdFilter);
    }

    const latestByMemberEvent = new Map<string, WorkshopDemandSignalCandidate>();
    for (const { id, raw } of signalDocsById.values()) {
      const uid = safeString(raw.uid);
      if (!uid || uid === auth.uid) continue;

      const subject = safeString(raw.subject);
      const source = inferWorkshopSignalSource(raw.source, subject, safeString(raw.body));
      if (!source) continue;
      if (!sourceFilterSet.has(source)) continue;

      const body = safeString(raw.body) || "";
      const eventId = parseWorkshopSignalEventId(raw.eventId, body);
      if (!eventId && eventIdFilterSet.size > 0 && source !== "events-request-form" && source !== "cluster-routing") {
        continue;
      }
      if (eventId && eventIdFilterSet.size > 0 && !eventIdFilterSet.has(eventId)) {
        continue;
      }

      const createdAt = parseTimestamp(raw.createdAt);
      if (!createdAt) continue;

      const createdAtMs = createdAt.toMillis();
      if (!Number.isFinite(createdAtMs)) continue;

      const action = parseWorkshopSignalAction(source);
      const sourceEventTitle = parseWorkshopSignalEventTitle(raw.eventTitle, raw.workshopTitle, body);
      const rawLevel = safeString(raw.level);
      const rawSchedule = safeString(raw.schedule);
      const rawBuddyMode = safeString(raw.buddyMode);
      const techniqueLine =
        action === "request"
          ? parseSignalLineValueFromAliases(body, ["Technique/topic", "Technique", "Techniques", "Technique focus"])
          : parseSignalLineValueFromAliases(body, [
              "Technique focus",
              "Technique",
              "Techniques",
              "Member techniques",
            ]);
      const signalNote = parseWorkshopSignalNote(body);
      const level = parseWorkshopSignalLevel(
        action === "request"
          ? rawLevel || parseSignalLineValueFromAliases(body, ["Level", "Level focus", "Preferred level", "Requested level"])
          : parseSignalLineValueFromAliases(body, [
              "Member level focus",
              "Member level",
              "Level",
              "Preferred level",
            ])
      );
      const schedule = parseWorkshopSignalSchedule(
        action === "request"
          ? rawSchedule || parseSignalLineValueFromAliases(body, [
              "Schedule preference",
              "Preferred schedule",
              "Requested schedule",
              "Schedule",
            ])
          : parseSignalLineValueFromAliases(body, [
              "Member schedule focus",
              "Member schedule",
              "Schedule preference",
              "Preferred schedule",
            ])
      );
      const buddyMode = parseWorkshopSignalBuddyMode(
        rawBuddyMode || parseSignalLineValueFromAliases(body, ["Buddy mode", "Buddy", "Buddy group", "Presence mode"])
      );

      const nextSignal: WorkshopDemandSignalCandidate = {
        id,
        uid,
        action,
        createdAtMs,
        sourceEventId: eventId || undefined,
        sourceEventTitle,
        level,
        schedule,
        buddyMode,
        source,
        techniqueIds: parseWorkshopSignalTechniqueIds(raw.techniqueIds, techniqueLine, sourceEventTitle),
        techniqueLine,
        signalNote,
      };

      if (action === "request") {
        const requestBucketKey = nextSignal.sourceEventId
          ? `${uid}|request|${nextSignal.sourceEventId}`
          : `${uid}|request|${id}`;
        const existing = latestByMemberEvent.get(requestBucketKey);
        if (existing && existing.createdAtMs >= createdAtMs) continue;
        latestByMemberEvent.set(requestBucketKey, nextSignal);
        continue;
      }

      if (!eventId) continue;
      const key = `${uid}|${eventId}`;
      const existing = latestByMemberEvent.get(key);
      if (existing && existing.createdAtMs >= createdAtMs) continue;

      latestByMemberEvent.set(key, nextSignal);
    }

    const eventIdsForTechniqueLookup = Array.from(
      new Set(
        Array.from(latestByMemberEvent.values())
          .map((row) => row.sourceEventId)
          .filter((eventId): eventId is string => Boolean(eventId))
      )
    );
    const eventTitleById = await fetchEventTitlesById(eventIdsForTechniqueLookup);

    const signals = Array.from(latestByMemberEvent.values())
      .filter((signal) => signal.action !== "withdrawal")
      .map((signal) => {
        const eventTitle =
          signal.sourceEventTitle ||
          (signal.sourceEventId ? eventTitleById.get(signal.sourceEventId) ?? "" : "");
        const techniqueIds = normalizeWorkshopSignalTechniques(
          signal.techniqueIds.length > 0
            ? signal.techniqueIds
            : parseWorkshopSignalTechniqueIdsFromText("", eventTitle)
        );
      return {
          id: signal.id,
          kind: signal.action,
          techniqueIds,
          techniqueLabel: techniqueLabelFromIds(techniqueIds),
          level: signal.level,
          schedule: signal.schedule,
          buddyMode: signal.buddyMode,
          action: signal.action,
          createdAt: signal.createdAtMs,
          sourceEventId: signal.sourceEventId,
          source: signal.source,
          sourceEventTitle: eventTitle || null,
          sourceLabel: workshopDemandSignalSourceLabel(signal.source),
          signalNote: signal.signalNote || "",
        };
      })
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);

    res.status(200).json({ ok: true, signals });
  } catch (err: any) {
    logger.error("listWorkshopDemandSignals failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});


export const getEvent = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(eventIdSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const eventId = safeString(parsed.data.eventId).trim();
  const includeCommunitySignals = parsed.data.includeCommunitySignals === true;

  try {
    const eventRef = db.collection(EVENTS_COL).doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      res.status(404).json({ ok: false, message: "Event not found" });
      return;
    }

    const eventData = (eventSnap.data() as Record<string, any>) ?? {};
    const status = safeString(eventData.status).trim();
    const admin = await requireAdmin(req);
    const counts = readCounts(eventData);

    if (status !== "published" && !admin.ok) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    const signupQuery = db
      .collection(SIGNUPS_COL)
      .where("eventId", "==", eventId)
      .where("uid", "==", auth.uid)
      .limit(1);

    const signupSnap = await signupQuery.get();
    const signupDoc = signupSnap.docs[0];

    const signup = signupDoc
      ? {
          id: signupDoc.id,
          status: safeString(signupDoc.data().status),
          paymentStatus: safeString(signupDoc.data().paymentStatus),
        }
      : null;

    const eventCommunitySignalCounts = includeCommunitySignals
      ? await collectWorkshopCommunitySignalCountsByEventIds(auth.uid, [eventSnap.id])
      : null;
    const communitySignalCount = eventCommunitySignalCounts?.get(eventSnap.id) ?? null;

    const responseEvent = {
      id: eventSnap.id,
      title: safeString(eventData.title),
      summary: safeString(eventData.summary),
      description: safeString(eventData.description),
      startAt: toIso(eventData.startAt),
      endAt: toIso(eventData.endAt),
      timezone: safeString(eventData.timezone),
      location: safeString(eventData.location),
      priceCents: asInt(eventData.priceCents, 0),
      currency: normalizeCurrency(eventData.currency),
      includesFiring: eventData.includesFiring === true,
      firingDetails: eventData.firingDetails ?? null,
      policyCopy: safeString(eventData.policyCopy) || defaultPolicyCopy(),
      addOns: normalizeAddOns(eventData.addOns ?? []),
      capacity: Math.max(asInt(eventData.capacity, 0), 0),
      waitlistEnabled: eventData.waitlistEnabled !== false,
      waitlistCount: counts.waitlistCount,
      offerClaimWindowHours: Math.max(asInt(eventData.offerClaimWindowHours, DEFAULT_OFFER_HOURS), 1),
      cancelCutoffHours: Math.max(asInt(eventData.cancelCutoffHours, DEFAULT_CANCEL_HOURS), 0),
      status: status || "draft",
        ...(communitySignalCount
          ? {
              communitySignalCounts: {
                requestSignals: communitySignalCount.requestSignals,
                interestSignals: communitySignalCount.interestSignals,
                showcaseSignals: communitySignalCount.showcaseSignals,
                withdrawnSignals: communitySignalCount.withdrawnSignals,
                totalSignals:
                  Math.max(
                    communitySignalCount.requestSignals +
                      communitySignalCount.interestSignals +
                      communitySignalCount.showcaseSignals,
                    0,
                  ),
                demandScore: computeWorkshopDemandScore(communitySignalCount),
                latestSignalAtMs: communitySignalCount.latestSignalAtMs,
              },
            }
          : {}),
    };

    res.status(200).json({ ok: true, event: responseEvent, signup });
  } catch (err: any) {
    logger.error("getEvent failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});
export const createEvent = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const parsed = parseBody(createEventSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "createEvent",
    max: 10,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const templateId = safeString(parsed.data.templateId).trim() || null;
  const title = safeString(parsed.data.title).trim();
  const summary = safeString(parsed.data.summary).trim();
  const description = safeString(parsed.data.description).trim();
  const location = safeString(parsed.data.location).trim();
  const timezone = safeString(parsed.data.timezone).trim();
  const capacity = Math.max(asInt(parsed.data.capacity, 0), 0);
  const priceCents = Math.max(asInt(parsed.data.priceCents, 0), 0);
  const currency = normalizeCurrency(parsed.data.currency);
  const includesFiring = parsed.data.includesFiring === true;
  const firingDetails = safeString(parsed.data.firingDetails).trim() || null;
  const policyCopy = safeString(parsed.data.policyCopy).trim() || defaultPolicyCopy();
  const addOns = normalizeAddOns(parsed.data.addOns ?? []);
  const waitlistEnabled = parsed.data.waitlistEnabled !== false;
  const offerClaimWindowHours = Math.max(
    asInt(parsed.data.offerClaimWindowHours, DEFAULT_OFFER_HOURS),
    1
  );
  const cancelCutoffHours = Math.max(asInt(parsed.data.cancelCutoffHours, DEFAULT_CANCEL_HOURS), 0);

  const startAt = parseTimestamp(parsed.data.startAt);
  const endAt = parseTimestamp(parsed.data.endAt);

  if (!startAt || !endAt) {
    res.status(400).json({ ok: false, message: "startAt and endAt required" });
    return;
  }

  if (startAt.toMillis() >= endAt.toMillis()) {
    res.status(400).json({ ok: false, message: "startAt must be before endAt" });
    return;
  }

  const safetyConfig = await getCommunitySafetyConfig();
  if (safetyConfig.publishKillSwitch) {
    res.status(503).json({
      ok: false,
      message: "Community publishing is temporarily paused by staff.",
    });
    return;
  }

  const scan = evaluateCommunityContentRisk(
    {
      textFields: [
        { field: "title", text: title },
        { field: "summary", text: summary },
        { field: "description", text: description },
        { field: "location", text: location },
        { field: "policyCopy", text: policyCopy },
        { field: "firingDetails", text: firingDetails ?? "" },
      ],
      explicitUrls: [],
    },
    safetyConfig
  );
  const requiresReview = safetyConfig.autoFlagEnabled && scan.flagged && scan.severity === "high";
  const initialStatus = requiresReview ? "review_required" : "draft";

  const ref = db.collection(EVENTS_COL).doc();
  const t = nowTs();

  await ref.set({
    templateId,
    title,
    summary,
    description,
    location,
    timezone,
    startAt,
    endAt,
    capacity,
    priceCents,
    currency,
    includesFiring,
    firingDetails,
    policyCopy,
    addOns,
    waitlistEnabled,
    offerClaimWindowHours,
    cancelCutoffHours,
    status: initialStatus,
    moderation: {
      score: scan.score,
      severity: scan.severity,
      flagged: scan.flagged,
      triggers: scan.triggers,
      requiresReview,
      reviewed: false,
      reviewDecision: null,
      reviewNote: null,
      scannedAt: t,
      scannedByUid: auth.uid,
    },
    ticketedCount: 0,
    offeredCount: 0,
    checkedInCount: 0,
    waitlistCount: 0,
    createdAt: t,
    updatedAt: t,
    publishedAt: null,
  });

  res.status(200).json({
    ok: true,
    eventId: ref.id,
    status: initialStatus,
    moderation: {
      score: scan.score,
      severity: scan.severity,
      flagged: scan.flagged,
      triggerCount: scan.triggers.length,
      requiresReview,
    },
  });
});

export const publishEvent = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(publishEventSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "publishEvent",
    max: 10,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const safetyConfig = await getCommunitySafetyConfig();
  if (safetyConfig.publishKillSwitch) {
    res.status(503).json({
      ok: false,
      message: "Community publishing is temporarily paused by staff.",
    });
    return;
  }

  const eventId = safeString(parsed.data.eventId).trim();
  const forcePublish = parsed.data.forcePublish === true;
  const overrideReason = safeString(parsed.data.overrideReason).trim();

  const eventRef = db.collection(EVENTS_COL).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    res.status(404).json({ ok: false, message: "Event not found" });
    return;
  }

  const eventData = (eventSnap.data() as Record<string, any>) ?? {};
  const moderation = (eventData.moderation as Record<string, any> | undefined) ?? {};
  const requiresReview = moderation.requiresReview === true || (moderation.flagged === true && safeString(moderation.severity) === "high");

  if (requiresReview && !forcePublish) {
    res.status(409).json({
      ok: false,
      message: "Event is flagged for safety review. Provide forcePublish with overrideReason to proceed.",
    });
    return;
  }
  if (forcePublish && !overrideReason) {
    res.status(400).json({
      ok: false,
      message: "overrideReason is required when forcePublish is true.",
    });
    return;
  }

  const t = nowTs();

  await eventRef.set(
    {
      status: "published",
      publishedAt: t,
      updatedAt: t,
      moderation: {
        ...moderation,
        reviewed: true,
        reviewDecision: forcePublish ? "allow_override" : "allow",
        reviewNote: forcePublish ? overrideReason : null,
        reviewedAt: t,
        reviewedByUid: auth.uid,
      },
    },
    { merge: true }
  );

  res.status(200).json({ ok: true, status: "published" });
});

export const staffSetEventStatus = onRequest({ region: REGION }, async (req, res) => {
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

  const parsed = parseBody(staffSetEventStatusSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "staffSetEventStatus",
    max: 20,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const eventId = safeString(parsed.data.eventId).trim();
  const nextStatus = parsed.data.status;
  const reason = safeString(parsed.data.reason).trim();
  if (nextStatus === "cancelled" && !reason) {
    res.status(400).json({ ok: false, message: "Reason is required when cancelling an event." });
    return;
  }

  const eventRef = db.collection(EVENTS_COL).doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    res.status(404).json({ ok: false, message: "Event not found" });
    return;
  }

  const t = nowTs();
  const patch: Record<string, unknown> = {
    status: nextStatus,
    updatedAt: t,
    lastStatusChangedByUid: auth.uid,
    lastStatusReason: reason || null,
    lastStatusChangedAt: t,
  };

  if (nextStatus === "cancelled") {
    patch.cancelledAt = t;
  } else if (nextStatus === "draft") {
    patch.cancelledAt = null;
  }

  await eventRef.set(patch, { merge: true });
  res.status(200).json({ ok: true, status: nextStatus });
});

export const signupForEvent = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const parsed = parseBody(signupSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "signupForEvent",
    max: 6,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  const eventId = safeString(parsed.data.eventId).trim();

  const { displayName, email } = await readUserIdentity(auth.uid);

  const eventRef = db.collection(EVENTS_COL).doc(eventId);
  const signupRef = db.collection(SIGNUPS_COL).doc();

  try {
    const result = await db.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) {
        throw new Error("Event not found");
      }

      const eventData = (eventSnap.data() as Record<string, any>) ?? {};
      const status = safeString(eventData.status).trim();
      if (status !== "published") {
        throw new Error("Event not published");
      }

      const existingSnap = await tx.get(
        db.collection(SIGNUPS_COL).where("eventId", "==", eventId).where("uid", "==", auth.uid)
      );

      const existing = existingSnap.docs.find((doc) => {
        const s = safeString(doc.data().status).trim();
        return s && s !== "cancelled" && s !== "expired";
      });

      if (existing) {
        return { signupId: existing.id, status: safeString(existing.data().status) };
      }

      const capacity = Math.max(asInt(eventData.capacity, 0), 0);
      const waitlistEnabled = eventData.waitlistEnabled !== false;
      const counts = readCounts(eventData);
      const reserved = counts.ticketedCount + counts.offeredCount + counts.checkedInCount;
      const hasCapacity = capacity > 0 && reserved < capacity;

      let nextStatus = "waitlisted";
      if (hasCapacity) {
        nextStatus = "ticketed";
      } else if (!waitlistEnabled) {
        throw new Error("Event sold out");
      }

      const t = nowTs();
      tx.set(signupRef, {
        eventId,
        uid: auth.uid,
        status: nextStatus,
        offerExpiresAt: null,
        offeredAt: null,
        checkedInAt: null,
        checkedInByUid: null,
        checkInMethod: null,
        paymentStatus: "unpaid",
        displayName,
        email,
        createdAt: t,
        updatedAt: t,
      });

      const nextCounts = {
        ticketedCount: counts.ticketedCount + (nextStatus === "ticketed" ? 1 : 0),
        offeredCount: counts.offeredCount,
        checkedInCount: counts.checkedInCount,
        waitlistCount: counts.waitlistCount + (nextStatus === "waitlisted" ? 1 : 0),
      };

      tx.set(
        eventRef,
        {
          ...nextCounts,
          updatedAt: t,
        },
        { merge: true }
      );

      return { signupId: signupRef.id, status: nextStatus };
    });

    res.status(200).json({ ok: true, signupId: result.signupId, status: result.status });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    const status = msg === "Event not found" ? 404 : msg === "Event sold out" ? 409 : 400;
    res.status(status).json({ ok: false, message: msg });
  }
});
export const cancelEventSignup = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
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

    const parsed = parseBody(signupIdSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "cancelEventSignup",
      max: 6,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const signupId = safeString(parsed.data.signupId).trim();

    const signupRef = db.collection(SIGNUPS_COL).doc(signupId);

    try {
      await db.runTransaction(async (tx) => {
        const signupSnap = await tx.get(signupRef);
        if (!signupSnap.exists) {
          throw new Error("Signup not found");
        }

        const signup = signupSnap.data() as Record<string, any>;
        if (signup.uid !== auth.uid) {
          throw new Error("Forbidden");
        }

        const status = safeString(signup.status).trim();
        if (status === "cancelled" || status === "expired") return;
        if (status === "checked_in") {
          throw new Error("Already checked in");
        }

        const eventId = safeString(signup.eventId).trim();
        if (!eventId) {
          throw new Error("Event missing");
        }

        const eventRef = db.collection(EVENTS_COL).doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
          throw new Error("Event not found");
        }

        const eventData = (eventSnap.data() as Record<string, any>) ?? {};
        if (status === "ticketed" || status === "offered") {
          const cancelCutoffHours = Math.max(
            asInt(eventData.cancelCutoffHours, DEFAULT_CANCEL_HOURS),
            0
          );
          const startAt = parseTimestamp(eventData.startAt);
          if (startAt) {
            const cutoff = startAt.toMillis() - cancelCutoffHours * 60 * 60 * 1000;
            if (Date.now() > cutoff) {
              throw new Error("Cancellation window closed");
            }
          }
        }

        const counts = readCounts(eventData);
        const t = nowTs();

        tx.set(
          signupRef,
          {
            status: "cancelled",
            updatedAt: t,
          },
          { merge: true }
        );

        let ticketedCount = counts.ticketedCount;
        let offeredCount = counts.offeredCount;
        let checkedInCount = counts.checkedInCount;
        let waitlistCount = counts.waitlistCount;

        if (status === "ticketed") ticketedCount = Math.max(ticketedCount - 1, 0);
        if (status === "offered") offeredCount = Math.max(offeredCount - 1, 0);
        if (status === "waitlisted") waitlistCount = Math.max(waitlistCount - 1, 0);
        if (status === "checked_in") checkedInCount = Math.max(checkedInCount - 1, 0);

        const waitlistEnabled = eventData.waitlistEnabled !== false;

        const capacity = Math.max(asInt(eventData.capacity, 0), 0);
        const reserved = ticketedCount + offeredCount + checkedInCount;
        const openSpots = capacity > reserved ? capacity - reserved : 0;

        if (waitlistEnabled && openSpots > 0 && waitlistCount > 0) {
          const waitlistQuery = db
            .collection(SIGNUPS_COL)
            .where("eventId", "==", eventId)
            .where("status", "==", "waitlisted")
            .orderBy("createdAt", "asc")
            .limit(1);

          const waitlistSnap = await tx.get(waitlistQuery);
          if (!waitlistSnap.empty) {
            const offeredSignupRef = waitlistSnap.docs[0].ref;
            const offerExpiresAt = Timestamp.fromMillis(
              Date.now() +
                Math.max(asInt(eventData.offerClaimWindowHours, DEFAULT_OFFER_HOURS), 1) *
                  60 *
                  60 *
                  1000
            );

            tx.set(
              offeredSignupRef,
              {
                status: "offered",
                offeredAt: t,
                offerExpiresAt,
                updatedAt: t,
              },
              { merge: true }
            );

            waitlistCount = Math.max(waitlistCount - 1, 0);
            offeredCount += 1;
          }
        }

        tx.set(
          eventRef,
          {
            ticketedCount,
            offeredCount,
            checkedInCount,
            waitlistCount,
            updatedAt: t,
          },
          { merge: true }
        );
      });

      res.status(200).json({ ok: true, status: "cancelled" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const status =
        msg === "Signup not found" || msg === "Event not found"
          ? 404
          : msg === "Forbidden"
            ? 403
            : 400;
      res.status(status).json({ ok: false, message: msg });
    }
  }
);
export const claimEventOffer = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
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

    const parsed = parseBody(signupIdSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "claimEventOffer",
      max: 6,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const signupId = safeString(parsed.data.signupId).trim();

    const signupRef = db.collection(SIGNUPS_COL).doc(signupId);

    try {
      await db.runTransaction(async (tx) => {
        const signupSnap = await tx.get(signupRef);
        if (!signupSnap.exists) {
          throw new Error("Signup not found");
        }

        const signup = signupSnap.data() as Record<string, any>;
        if (signup.uid !== auth.uid) {
          throw new Error("Forbidden");
        }

        const status = safeString(signup.status).trim();
        if (status !== "offered") {
          throw new Error("Offer not available");
        }

        const eventId = safeString(signup.eventId).trim();
        if (!eventId) {
          throw new Error("Event missing");
        }

        const eventRef = db.collection(EVENTS_COL).doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
          throw new Error("Event not found");
        }

        const eventData = (eventSnap.data() as Record<string, any>) ?? {};
        const counts = readCounts(eventData);
        const t = nowTs();

        const offerExpiresAt = parseTimestamp(signup.offerExpiresAt);
        if (offerExpiresAt && offerExpiresAt.toMillis() < Date.now()) {
          tx.set(
            signupRef,
            {
              status: "expired",
              updatedAt: t,
            },
            { merge: true }
          );

          const offeredCount = Math.max(counts.offeredCount - 1, 0);
          tx.set(
            eventRef,
            {
              offeredCount,
              updatedAt: t,
            },
            { merge: true }
          );

          throw new Error("Offer expired");
        }

        tx.set(
          signupRef,
          {
            status: "ticketed",
            offerExpiresAt: null,
            updatedAt: t,
          },
          { merge: true }
        );

        tx.set(
          eventRef,
          {
            ticketedCount: counts.ticketedCount + 1,
            offeredCount: Math.max(counts.offeredCount - 1, 0),
            updatedAt: t,
          },
          { merge: true }
        );
      });

      res.status(200).json({ ok: true, status: "ticketed" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const status =
        msg === "Signup not found" || msg === "Event not found"
          ? 404
          : msg === "Forbidden"
            ? 403
            : 400;
      res.status(status).json({ ok: false, message: msg });
    }
  }
);

export const checkInEvent = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
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

    const parsed = parseBody(checkInSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "checkInEvent",
      max: 10,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const signupId = safeString(parsed.data.signupId).trim();
    const method = parsed.data.method;

    if (method === "staff") {
      const admin = await requireAdmin(req);
      if (!admin.ok) {
        res.status(403).json({ ok: false, message: "Forbidden" });
        return;
      }
    }

    const signupRef = db.collection(SIGNUPS_COL).doc(signupId);

    try {
      await db.runTransaction(async (tx) => {
        const signupSnap = await tx.get(signupRef);
        if (!signupSnap.exists) {
          throw new Error("Signup not found");
        }

        const signup = signupSnap.data() as Record<string, any>;
        if (method === "self" && signup.uid !== auth.uid) {
          throw new Error("Forbidden");
        }

        const status = safeString(signup.status).trim();
        if (status === "checked_in") return;
        if (status !== "ticketed") {
          throw new Error("Ticket not active");
        }

        const eventId = safeString(signup.eventId).trim();
        if (!eventId) {
          throw new Error("Event missing");
        }

        const eventRef = db.collection(EVENTS_COL).doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
          throw new Error("Event not found");
        }

        const eventData = (eventSnap.data() as Record<string, any>) ?? {};
        const counts = readCounts(eventData);
        const t = nowTs();

        tx.set(
          signupRef,
          {
            status: "checked_in",
            checkedInAt: t,
            checkedInByUid: auth.uid,
            checkInMethod: method,
            updatedAt: t,
          },
          { merge: true }
        );

        tx.set(
          eventRef,
          {
            ticketedCount: Math.max(counts.ticketedCount - 1, 0),
            checkedInCount: counts.checkedInCount + 1,
            updatedAt: t,
          },
          { merge: true }
        );
      });

      res.status(200).json({ ok: true, status: "checked_in", paymentStatus: "unpaid" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const status =
        msg === "Signup not found" || msg === "Event not found"
          ? 404
          : msg === "Forbidden"
            ? 403
            : 400;
      res.status(status).json({ ok: false, message: msg });
    }
  }
);
export const createEventCheckoutSession = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
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

    const parsed = parseBody(checkoutSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "eventCheckout",
      max: 6,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const eventId = safeString(parsed.data.eventId).trim();
    const signupId = safeString(parsed.data.signupId).trim();
    const rawAddOns = Array.isArray(parsed.data.addOnIds) ? parsed.data.addOnIds : [];

    try {
      const eventRef = db.collection(EVENTS_COL).doc(eventId);
      const signupRef = db.collection(SIGNUPS_COL).doc(signupId);

      const [eventSnap, signupSnap] = await Promise.all([eventRef.get(), signupRef.get()]);

      if (!eventSnap.exists) {
        res.status(404).json({ ok: false, message: "Event not found" });
        return;
      }
      if (!signupSnap.exists) {
        res.status(404).json({ ok: false, message: "Signup not found" });
        return;
      }

      const eventData = (eventSnap.data() as Record<string, any>) ?? {};
      const signup = signupSnap.data() as Record<string, any>;

      if (signup.uid !== auth.uid) {
        res.status(403).json({ ok: false, message: "Forbidden" });
        return;
      }

      if (safeString(signup.status).trim() !== "checked_in") {
        res.status(400).json({ ok: false, message: "Check-in required" });
        return;
      }

      if (safeString(signup.paymentStatus).trim() === "paid") {
        res.status(409).json({ ok: false, message: "Already paid" });
        return;
      }

      if (safeString(eventData.status).trim() === "cancelled") {
        res.status(400).json({ ok: false, message: "Event cancelled" });
        return;
      }

      const addOns = normalizeAddOns(eventData.addOns ?? []);
      const addOnIds = rawAddOns
        .map((item: any) => safeString(item).trim())
        .filter((id: string) => id.length > 0);

      const addOnLookup = new Map(addOns.map((addOn) => [addOn.id, addOn]));
      const selectedAddOns: EventAddOn[] = [];
      for (const id of addOnIds) {
        const addOn = addOnLookup.get(id);
        if (!addOn || !addOn.isActive) {
          res.status(400).json({ ok: false, message: `Invalid add-on: ${id}` });
          return;
        }
        selectedAddOns.push(addOn);
      }

      const priceCents = Math.max(asInt(eventData.priceCents, 0), 0);
      if (priceCents <= 0) {
        res.status(400).json({ ok: false, message: "Event price missing" });
        return;
      }

      const currency = normalizeCurrency(eventData.currency);
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      const receiptItems: Array<{ id: string; title: string; priceCents: number; quantity: number }> = [];

      const baseTitle = safeString(eventData.title) || "Event ticket";
      const baseSummary = safeString(eventData.summary) || undefined;

      lineItems.push({
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: priceCents,
          product_data: {
            name: baseTitle,
            description: baseSummary,
          },
        },
        quantity: 1,
      });

      receiptItems.push({
        id: "ticket",
        title: baseTitle,
        priceCents,
        quantity: 1,
      });

      let totalCents = priceCents;

      for (const addOn of selectedAddOns) {
        if (addOn.priceCents <= 0) continue;
        lineItems.push({
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: addOn.priceCents,
            product_data: {
              name: addOn.title,
            },
          },
          quantity: 1,
        });
        receiptItems.push({
          id: addOn.id,
          title: addOn.title,
          priceCents: addOn.priceCents,
          quantity: 1,
        });
        totalCents += addOn.priceCents;
      }

      const baseUrl = getPortalBaseUrl(req);
      if (!baseUrl) {
        res.status(500).json({ ok: false, message: "PORTAL_BASE_URL not configured" });
        return;
      }

      const stripe = getStripe();
      const chargeRef = db.collection(CHARGES_COL).doc();
      const chargeId = chargeRef.id;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: lineItems,
        success_url: `${baseUrl}/events?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/events?status=cancel`,
        customer_email: signup.email ?? undefined,
        phone_number_collection: { enabled: true },
        billing_address_collection: "auto",
        automatic_tax: { enabled: true },
        client_reference_id: signupId,
        metadata: {
          chargeId,
          signupId,
          eventId,
          uid: auth.uid,
        },
      });

      const t = nowTs();
      await chargeRef.set({
        eventId,
        signupId,
        uid: auth.uid,
        lineItems: receiptItems,
        totalCents,
        currency,
        paymentStatus: "checkout_pending",
        stripeCheckoutSessionId: session.id ?? null,
        stripePaymentIntentId: null,
        createdAt: t,
        updatedAt: t,
      });

      res.status(200).json({ ok: true, checkoutUrl: session.url });
    } catch (err: any) {
      logger.error("createEventCheckoutSession failed", err);
      res.status(500).json({
        ok: false,
        message: "Unable to start checkout right now. Please try again in a minute.",
      });
    }
  }
);
export const eventStripeWebhook = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    res.status(400).send("Missing Stripe signature");
    return;
  }

  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!webhookSecret) {
    res.status(500).send("STRIPE_WEBHOOK_SECRET not configured");
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
  } catch (err: any) {
    logger.error("eventStripeWebhook signature verification failed", err);
    res.status(400).send(`Webhook Error: ${err?.message ?? "Invalid signature"}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const chargeId = session.metadata?.chargeId;
    const signupId = session.metadata?.signupId;

    if (!chargeId) {
      logger.warn("eventStripeWebhook missing chargeId", { sessionId: session.id });
      res.status(200).json({ ok: true });
      return;
    }

    const chargeRef = db.collection(CHARGES_COL).doc(chargeId);

    try {
      await db.runTransaction(async (tx) => {
        const chargeSnap = await tx.get(chargeRef);
        if (!chargeSnap.exists) {
          logger.warn("eventStripeWebhook charge not found", { chargeId });
          return;
        }

        const charge = chargeSnap.data() as Record<string, any>;
        if (charge.paymentStatus === "paid") return;

        const t = nowTs();
        tx.set(
          chargeRef,
          {
            paymentStatus: "paid",
            updatedAt: t,
            paidAt: t,
            stripePaymentIntentId: session.payment_intent ?? null,
          },
          { merge: true }
        );

        if (signupId) {
          const signupRef = db.collection(SIGNUPS_COL).doc(signupId);
          tx.set(
            signupRef,
            {
              paymentStatus: "paid",
              updatedAt: t,
            },
            { merge: true }
          );
        }
      });
    } catch (err) {
      logger.error("eventStripeWebhook processing failed", err);
    }
  }

  res.status(200).json({ ok: true });
});

export const runIndustryEventsFreshnessNow = onRequest(
  { region: REGION, timeoutSeconds: 120 },
  async (req, res) => {
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

    const parsed = parseBody(runIndustryEventsFreshnessSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "runIndustryEventsFreshnessNow",
      max: 6,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many freshness sweep requests" });
      return;
    }

    try {
      const result = await sweepIndustryEventsFreshness({
        dryRun: parsed.data.dryRun === true,
        limit: parsed.data.limit,
        staleReviewMs:
          typeof parsed.data.staleReviewDays === "number"
            ? parsed.data.staleReviewDays * 24 * 60 * 60 * 1000
            : INDUSTRY_EVENT_REVIEW_STALE_MS,
        retirePastMs:
          typeof parsed.data.retirePastHours === "number"
            ? parsed.data.retirePastHours * 60 * 60 * 1000
            : INDUSTRY_EVENT_RETIRE_PAST_MS,
        source: "manual",
      });
      res.status(200).json({ ok: true, result });
    } catch (err: any) {
      logger.error("runIndustryEventsFreshnessNow failed", err);
      res.status(500).json({ ok: false, message: err?.message ?? String(err) });
    }
  }
);

export const sweepIndustryEvents = onSchedule(
  { region: REGION, schedule: "every 6 hours", timeZone: "America/Phoenix" },
  async () => {
    try {
      const result = await sweepIndustryEventsFreshness({
        source: "scheduled",
        limit: 250,
      });
      logger.info("sweepIndustryEvents completed", result);
    } catch (err) {
      logger.error("sweepIndustryEvents failed", err);
    }
  }
);

export const sweepEventOffers = onSchedule(
  { region: REGION, schedule: "every 30 minutes", timeZone: "America/Phoenix" },
  async () => {
    const now = Timestamp.fromMillis(Date.now());
    const expiredQuery = db
      .collection(SIGNUPS_COL)
      .where("status", "==", "offered")
      .where("offerExpiresAt", "<=", now)
      .limit(25);

    const snap = await expiredQuery.get();
    if (snap.empty) return;

    for (const docSnap of snap.docs) {
      const signupRef = docSnap.ref;

      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(signupRef);
          if (!fresh.exists) return;

          const signup = fresh.data() as Record<string, any>;
          if (safeString(signup.status).trim() !== "offered") return;

          const offerExpiresAt = parseTimestamp(signup.offerExpiresAt);
          if (!offerExpiresAt || offerExpiresAt.toMillis() > Date.now()) return;

          const eventId = safeString(signup.eventId).trim();
          if (!eventId) return;

          const eventRef = db.collection(EVENTS_COL).doc(eventId);
          const eventSnap = await tx.get(eventRef);
          if (!eventSnap.exists) return;

          const eventData = (eventSnap.data() as Record<string, any>) ?? {};
          const counts = readCounts(eventData);
          const t = nowTs();

          tx.set(
            signupRef,
            {
              status: "expired",
              updatedAt: t,
            },
            { merge: true }
          );

          let offeredCount = Math.max(counts.offeredCount - 1, 0);
          let waitlistCount = counts.waitlistCount;
          const ticketedCount = counts.ticketedCount;
          const checkedInCount = counts.checkedInCount;

          const waitlistEnabled = eventData.waitlistEnabled !== false;
          const capacity = Math.max(asInt(eventData.capacity, 0), 0);
          const reserved = ticketedCount + offeredCount + checkedInCount;
          const openSpots = capacity > reserved ? capacity - reserved : 0;

          if (waitlistEnabled && openSpots > 0 && waitlistCount > 0) {
            const waitlistQuery = db
              .collection(SIGNUPS_COL)
              .where("eventId", "==", eventId)
              .where("status", "==", "waitlisted")
              .orderBy("createdAt", "asc")
              .limit(1);

            const waitlistSnap = await tx.get(waitlistQuery);
            if (!waitlistSnap.empty) {
              const nextRef = waitlistSnap.docs[0].ref;
              const offerExpiresAtNext = Timestamp.fromMillis(
                Date.now() +
                  Math.max(asInt(eventData.offerClaimWindowHours, DEFAULT_OFFER_HOURS), 1) *
                    60 *
                    60 *
                    1000
              );

              tx.set(
                nextRef,
                {
                  status: "offered",
                  offeredAt: t,
                  offerExpiresAt: offerExpiresAtNext,
                  updatedAt: t,
                },
                { merge: true }
              );

              waitlistCount = Math.max(waitlistCount - 1, 0);
              offeredCount += 1;
            }
          }

          tx.set(
            eventRef,
            {
              ticketedCount,
              offeredCount,
              checkedInCount,
              waitlistCount,
              updatedAt: t,
            },
            { merge: true }
          );
        });
      } catch (err) {
        logger.error("sweepEventOffers failed", err);
      }
    }
  }
);
