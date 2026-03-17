import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import { randomBytes } from "crypto";
import { z } from "zod";
import {
  applyCors,
  db,
  requireAdmin,
  requireAuthContext,
  requireAuthUid,
  isStaffFromDecoded,
  nowTs,
  enforceRateLimit,
  parseBody,
  safeString,
} from "./shared";

const REGION = "us-central1";
const LIBRARY_PROVIDER_TIMEOUT_MS = Math.max(1200, Number(process.env.LIBRARY_PROVIDER_TIMEOUT_MS ?? 4200) || 4200);
const LIBRARY_PROVIDER_MAX_ATTEMPTS = Math.max(1, Math.min(4, Number(process.env.LIBRARY_PROVIDER_MAX_ATTEMPTS ?? 3) || 3));
const LIBRARY_PROVIDER_BACKOFF_MS = Math.max(150, Number(process.env.LIBRARY_PROVIDER_BACKOFF_MS ?? 350) || 350);
const LIBRARY_PROVIDER_MAX_BACKOFF_MS = Math.max(
  LIBRARY_PROVIDER_BACKOFF_MS,
  Number(process.env.LIBRARY_PROVIDER_MAX_BACKOFF_MS ?? 4000) || 4000
);
const LIBRARY_PROVIDER_PACING_MS = Math.max(80, Number(process.env.LIBRARY_PROVIDER_PACING_MS ?? 200) || 200);
const LIBRARY_EXTERNAL_LOOKUP_DEFAULT_LIMIT = Math.max(
  1,
  Math.min(10, Number(process.env.LIBRARY_EXTERNAL_LOOKUP_DEFAULT_LIMIT ?? 6) || 6)
);
const LIBRARY_EXTERNAL_LOOKUP_MAX_LIMIT = Math.max(
  LIBRARY_EXTERNAL_LOOKUP_DEFAULT_LIMIT,
  Math.min(20, Number(process.env.LIBRARY_EXTERNAL_LOOKUP_MAX_LIMIT ?? 12) || 12)
);
const LIBRARY_EXTERNAL_LOOKUP_CACHE_TTL_MS = Math.max(
  30_000,
  Number(process.env.LIBRARY_EXTERNAL_LOOKUP_CACHE_TTL_MS ?? 10 * 60_000) || 10 * 60_000
);
const LIBRARY_EXTERNAL_LOOKUP_CACHE_MAX_ENTRIES = Math.max(
  25,
  Number(process.env.LIBRARY_EXTERNAL_LOOKUP_CACHE_MAX_ENTRIES ?? 250) || 250
);
const LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_CACHE_TTL_MS = Math.max(
  5_000,
  Number(process.env.LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_CACHE_TTL_MS ?? 60_000) || 60_000
);
const LIBRARY_ROLLOUT_CONFIG_CACHE_TTL_MS = Math.max(
  5_000,
  Number(process.env.LIBRARY_ROLLOUT_CONFIG_CACHE_TTL_MS ?? 60_000) || 60_000
);
const LIBRARY_SETTINGS_COLLECTION = "librarySettings";
const LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_DOC = "externalLookupProviders";
const LIBRARY_ROLLOUT_CONFIG_DOC = "rolloutPhase";
const LIBRARY_METADATA_REFRESH_STALE_MS = Math.max(
  24 * 60 * 60 * 1000,
  Number(process.env.LIBRARY_METADATA_REFRESH_STALE_MS ?? 14 * 24 * 60 * 60 * 1000) || 14 * 24 * 60 * 60 * 1000
);
const LIBRARY_METADATA_REFRESH_LIMIT = Math.max(1, Math.min(250, Number(process.env.LIBRARY_METADATA_REFRESH_LIMIT ?? 60) || 60));
const LIBRARY_SYNC_SCHEDULE = safeString(process.env.LIBRARY_METADATA_REFRESH_SCHEDULE).trim() || "every 6 hours";
const LIBRARY_METADATA_ENRICHMENT_LIMIT = Math.max(
  1,
  Math.min(250, Number(process.env.LIBRARY_METADATA_ENRICHMENT_LIMIT ?? 40) || 40)
);
const LIBRARY_METADATA_ENRICHMENT_SCHEDULE =
  safeString(process.env.LIBRARY_METADATA_ENRICHMENT_SCHEDULE).trim() || "every 15 minutes";
const LIBRARY_METADATA_DESCRIPTION_THIN_LENGTH = Math.max(
  60,
  Number(process.env.LIBRARY_METADATA_DESCRIPTION_THIN_LENGTH ?? 140) || 140
);
const LIBRARY_METADATA_DESCRIPTION_REPLACE_DELTA = Math.max(
  20,
  Number(process.env.LIBRARY_METADATA_DESCRIPTION_REPLACE_DELTA ?? 40) || 40
);
const LIBRARY_OVERDUE_SYNC_SCHEDULE = safeString(process.env.LIBRARY_OVERDUE_SYNC_SCHEDULE).trim() || "every 3 hours";
const LIBRARY_OVERDUE_SYNC_LIMIT = Math.max(10, Math.min(1000, Number(process.env.LIBRARY_OVERDUE_SYNC_LIMIT ?? 320) || 320));
const DAY_MS = 24 * 60 * 60 * 1000;
const LIBRARY_RUN_AUDIT_COLLECTION = "libraryRunAudit";

type ProviderName =
  | "openlibrary"
  | "googlebooks"
  | "loc"
  | "wikidata"
  | "boardgamegeek"
  | "rpggeek"
  | "videogamegeek";
type ProviderAuthMode = "none" | "token";
type ProviderLookupMode = "isbn" | "title" | "title_author";
type ProviderSupportedMediaType = "book" | "comic" | "tabletop_rpg" | "board_game" | "video_game";

type ImportRequest = {
  isbns: string[];
  source?: string;
};

export type ImportLibraryIsbnsResult = {
  requested: number;
  created: number;
  updated: number;
  manualPassRequired: Array<{
    isbn: string;
    itemId: string | null;
    reason: "unresolved_isbn" | "manual_finish_required";
    message: string;
  }>;
  rejected: Array<{
    isbn: string;
    reason: "invalid_isbn" | "malformed_identifier";
    message: string;
  }>;
  errors: Array<{ isbn: string; message: string }>;
};

type LookupSource =
  | "local_reference"
  | "openlibrary"
  | "googlebooks"
  | "loc"
  | "wikidata"
  | "boardgamegeek"
  | "rpggeek"
  | "videogamegeek"
  | "manual";

type LookupResult = {
  title: string;
  subtitle?: string | null;
  authors: string[];
  description?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  pageCount?: number | null;
  subjects?: string[];
  coverUrl?: string | null;
  format?: string | null;
  mediaType?: string | null;
  identifiers: {
    isbn10?: string | null;
    isbn13?: string | null;
    olid?: string | null;
    googleVolumeId?: string | null;
  };
  source: LookupSource;
  raw?: Record<string, unknown>;
};

export type ResolvedLibraryIsbnResult = {
  normalized: {
    primary: string;
    isbn10: string | null;
    isbn13: string | null;
  };
  lookup: {
    title: string;
    subtitle: string | null;
    authors: string[];
    description: string | null;
    publisher: string | null;
    publishedDate: string | null;
    pageCount: number | null;
    subjects: string[];
    coverUrl: string | null;
    format: string | null;
    source: LookupSource;
    identifiers: {
      isbn10: string | null;
      isbn13: string | null;
      olid: string | null;
      googleVolumeId: string | null;
    };
    raw: Record<string, unknown> | null;
  };
  fallback: boolean;
  usedRemoteLookup: boolean;
};

export type LibraryExternalLookupItem = {
  title: string;
  subtitle: string | null;
  authors: string[];
  description: string | null;
  publisher: string | null;
  publishedDate: string | null;
  coverUrl: string | null;
  format: string | null;
  mediaType: string | null;
  summary: string | null;
  source: ProviderName;
  sourceLabel: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  publicLibraryUrl: string | null;
  identifiers: {
    isbn10: string | null;
    isbn13: string | null;
    olid: string | null;
    googleVolumeId: string | null;
  };
};

type LibraryExternalLookupProviderStatus = {
  provider: ProviderName;
  label: string;
  authMode: ProviderAuthMode;
  available: boolean;
  tokenConfigured: boolean;
  enabled: boolean;
  supportedLookupModes: ProviderLookupMode[];
  supportedMediaTypes: ProviderSupportedMediaType[];
  ok: boolean;
  itemCount: number;
  cached: boolean;
  disabled: boolean;
};

export type LibraryExternalLookupResult = {
  q: string;
  limit: number;
  items: LibraryExternalLookupItem[];
  cacheHit: boolean;
  degraded: boolean;
  policyLimited: boolean;
  providers: LibraryExternalLookupProviderStatus[];
};

export type LibraryExternalLookupProviderConfig = {
  openlibraryEnabled: boolean;
  googlebooksEnabled: boolean;
  disabledProviders: ProviderName[];
  providers: Array<{
    provider: ProviderName;
    label: string;
    authMode: ProviderAuthMode;
    available: boolean;
    tokenConfigured: boolean;
    enabled: boolean;
    supportedLookupModes: ProviderLookupMode[];
    supportedMediaTypes: ProviderSupportedMediaType[];
  }>;
  coverReviewGuardrailEnabled: boolean;
  updatedAtMs: number;
  updatedByUid: string | null;
  note: string | null;
};

export const LIBRARY_ROLLOUT_PHASES = [
  "phase_1_read_only",
  "phase_2_member_writes",
  "phase_3_admin_full",
] as const;

export type LibraryRolloutPhase = (typeof LIBRARY_ROLLOUT_PHASES)[number];

export type LibraryRolloutConfig = {
  phase: LibraryRolloutPhase;
  updatedAtMs: number;
  updatedByUid: string | null;
  note: string | null;
};

export const LIBRARY_METADATA_LOCK_FIELDS = [
  "title",
  "subtitle",
  "authors",
  "summary",
  "description",
  "publisher",
  "publishedDate",
  "pageCount",
  "subjects",
  "format",
  "coverUrl",
] as const;

export type LibraryMetadataLockField = (typeof LIBRARY_METADATA_LOCK_FIELDS)[number];
export type LibraryMetadataEnrichmentRunScope = "pending" | "recent_imports" | "thin_backfill" | "item_ids";
export type LibraryItemDetailStatus = "ready" | "enriching" | "sparse";

type LibraryMetadataLocks = Partial<Record<LibraryMetadataLockField, true>>;
type LibraryMetadataEnrichmentReason =
  | "recent_import"
  | "recent_imports"
  | "thin_backfill"
  | "manual_save"
  | "manual_run"
  | "refresh_follow_up";

export type LibraryMetadataEnrichmentRunResult = {
  queued: number;
  attempted: number;
  enriched: number;
  skipped: number;
  errors: number;
  stillPending: number;
};

export type LibraryMetadataEnrichmentSummary = {
  pendingCount: number;
  thinBacklogCount: number;
  lastRunAtMs: number;
  lastRunStatus: string;
  lastRunSource: string;
  lastRunQueued: number;
  lastRunAttempted: number;
  lastRunEnriched: number;
  lastRunSkipped: number;
  lastRunErrors: number;
  lastRunStillPending: number;
};

export type LibraryMetadataGapReason =
  | "placeholder_title"
  | "malformed_identifier"
  | "missing_cover"
  | "sparse_synopsis"
  | "thin_metadata"
  | "missing_creator"
  | "manual_finish_required";

export type LibraryMetadataGapRow = {
  itemId: string;
  title: string;
  source: string | null;
  mediaType: string | null;
  coverQualityStatus: string | null;
  coverQualityReason: string | null;
  detailStatus: string | null;
  gapReasons: LibraryMetadataGapReason[];
  updatedAtMs: number;
  isbn: string | null;
};

const importSchema = z.object({
  isbns: z.array(z.string().min(1)).min(1).max(200),
  source: z.string().optional(),
});

const refreshMetadataSchema = z.object({
  limit: z.number().int().min(1).max(250).optional(),
  staleMs: z.number().int().min(60_000).max(180 * 24 * 60 * 60 * 1000).optional(),
});

const overdueSyncSchema = z.object({
  limit: z.number().int().min(10).max(1000).optional(),
});

type RunTrigger = "manual" | "scheduled";

type RunAuditParams = {
  requestId: string;
  job:
    | "library.items.import_isbns"
    | "library.metadata.refresh"
    | "library.metadata.enrichment"
    | "library.loans.overdue_sync";
  trigger: RunTrigger;
  status: "started" | "success" | "error";
  source: RunTrigger;
  actorUid?: string | null;
  input?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  code?: string | null;
  message?: string | null;
};

function readHeaderFirst(req: { headers?: Record<string, unknown> }, name: string): string {
  const key = name.toLowerCase();
  const raw = req.headers?.[key] ?? req.headers?.[name];
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (typeof first === "string" || typeof first === "number") return String(first).trim();
  }
  return "";
}

function makeRequestId(prefix = "req"): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

function getRequestId(req: { headers?: Record<string, unknown> }): string {
  const provided = readHeaderFirst(req, "x-request-id");
  if (provided) return provided.slice(0, 128);
  return makeRequestId("req");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return safeString(error) || "Request failed";
}

function setRequestIdHeader(res: { set: (name: string, value: string) => unknown }, requestId: string) {
  res.set("x-request-id", requestId);
}

function jsonOk(
  res: {
    set: (name: string, value: string) => unknown;
    status: (code: number) => { json: (body: unknown) => unknown };
  },
  requestId: string,
  payload: Record<string, unknown>,
  status = 200,
) {
  setRequestIdHeader(res, requestId);
  res.status(status).json({
    ok: true,
    requestId,
    ...payload,
  });
}

function jsonError(
  res: {
    set: (name: string, value: string) => unknown;
    status: (code: number) => { json: (body: unknown) => unknown };
  },
  requestId: string,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown> | null,
) {
  setRequestIdHeader(res, requestId);
  res.status(status).json({
    ok: false,
    requestId,
    code,
    message,
    details: details ?? null,
  });
}

export async function emitLibraryRunAudit(params: RunAuditParams): Promise<void> {
  const row = {
    requestId: params.requestId,
    job: params.job,
    trigger: params.trigger,
    status: params.status,
    source: params.source,
    actorUid: params.actorUid ?? null,
    input: params.input ?? null,
    result: params.result ?? null,
    code: params.code ?? null,
    message: params.message ?? null,
    createdAt: nowTs(),
  };

  logger.info("Library run audit", {
    requestId: row.requestId,
    job: row.job,
    trigger: row.trigger,
    status: row.status,
    source: row.source,
    actorUid: row.actorUid,
    code: row.code,
  });

  try {
    await db.collection(LIBRARY_RUN_AUDIT_COLLECTION).add(row);
  } catch (error: unknown) {
    logger.warn("Library run audit write failed", {
      requestId: params.requestId,
      job: params.job,
      status: params.status,
      message: toErrorMessage(error),
    });
  }
}

const emitRunAudit = emitLibraryRunAudit;

const LOCAL_ISBN_REFERENCE_CATALOG: Record<
  string,
  Omit<LookupResult, "source" | "identifiers"> & { identifiers?: LookupResult["identifiers"] }
> = {
  "0131103628": {
    title: "The C Programming Language",
    subtitle: "2nd Edition",
    authors: ["Brian W. Kernighan", "Dennis M. Ritchie"],
    description: "Reference copy from local Monsoon Fire ISBN catalog.",
    publisher: "Prentice Hall",
    publishedDate: "1988-03-22",
    pageCount: 288,
    subjects: ["programming", "foundations"],
    coverUrl: null,
    format: "paperback",
    identifiers: {
      isbn10: "0131103628",
      isbn13: "9780131103627",
      olid: null,
      googleVolumeId: null,
    },
  },
  "9780132350884": {
    title: "Clean Code",
    subtitle: "A Handbook of Agile Software Craftsmanship",
    authors: ["Robert C. Martin"],
    description: "Reference copy from local Monsoon Fire ISBN catalog.",
    publisher: "Prentice Hall",
    publishedDate: "2008-08-11",
    pageCount: 464,
    subjects: ["software craftsmanship", "clean code"],
    coverUrl: null,
    format: "paperback",
    identifiers: {
      isbn10: "0132350882",
      isbn13: "9780132350884",
      olid: null,
      googleVolumeId: null,
    },
  },
  "9780596007126": {
    title: "Head First Design Patterns",
    subtitle: null,
    authors: ["Eric Freeman", "Elisabeth Robson", "Bert Bates", "Kathy Sierra"],
    description: "Reference copy from local Monsoon Fire ISBN catalog.",
    publisher: "O'Reilly Media",
    publishedDate: "2004-10-25",
    pageCount: 694,
    subjects: ["design patterns", "software architecture"],
    coverUrl: null,
    format: "paperback",
    identifiers: {
      isbn10: "0596007124",
      isbn13: "9780596007126",
      olid: null,
      googleVolumeId: null,
    },
  },
};

function cleanIsbn(raw: string): string {
  return raw.replace(/[^0-9xX]/g, "").toUpperCase();
}

function computeIsbn13Check(base12: string): string {
  let sum = 0;
  for (let i = 0; i < base12.length; i += 1) {
    const digit = Number(base12[i]);
    if (!Number.isFinite(digit)) return "";
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const remainder = sum % 10;
  return String((10 - remainder) % 10);
}

function computeIsbn10Check(base9: string): string {
  let sum = 0;
  for (let i = 0; i < base9.length; i += 1) {
    const digit = Number(base9[i]);
    if (!Number.isFinite(digit)) return "";
    sum += digit * (10 - i);
  }
  const remainder = sum % 11;
  const check = (11 - remainder) % 11;
  return check === 10 ? "X" : String(check);
}

function isValidIsbn10(isbn10: string): boolean {
  if (!/^[0-9]{9}[0-9X]$/.test(isbn10)) return false;
  return computeIsbn10Check(isbn10.slice(0, 9)) === isbn10.slice(9);
}

function isValidIsbn13(isbn13: string): boolean {
  if (!/^[0-9]{13}$/.test(isbn13)) return false;
  return computeIsbn13Check(isbn13.slice(0, 12)) === isbn13.slice(12);
}

function isbn10To13(isbn10: string): string | null {
  if (isbn10.length !== 10 || !isValidIsbn10(isbn10)) return null;
  const base = `978${isbn10.slice(0, 9)}`;
  const check = computeIsbn13Check(base);
  return check ? `${base}${check}` : null;
}

function isbn13To10(isbn13: string): string | null {
  if (isbn13.length !== 13 || !isValidIsbn13(isbn13)) return null;
  if (!isbn13.startsWith("978")) return null;
  const base = isbn13.slice(3, 12);
  const check = computeIsbn10Check(base);
  return check ? `${base}${check}` : null;
}

function normalizeIsbn(raw: string) {
  const cleaned = cleanIsbn(raw);
  let isbn10: string | null = null;
  let isbn13: string | null = null;

  if (cleaned.length === 10 && isValidIsbn10(cleaned)) {
    isbn10 = cleaned;
    isbn13 = isbn10To13(cleaned);
  } else if (cleaned.length === 13 && isValidIsbn13(cleaned)) {
    isbn13 = cleaned;
    isbn10 = isbn13To10(cleaned);
  }

  const primary = isbn13 || isbn10 || cleaned;
  return { primary, isbn10, isbn13 };
}

function normalizeValidIsbn(raw: string): { primary: string; isbn10: string | null; isbn13: string | null } | null {
  const normalized = normalizeIsbn(raw);
  if (!normalized.isbn10 && !normalized.isbn13) return null;
  return normalized;
}

function lookupLocalIsbnReference(isbn: string): LookupResult | null {
  const normalized = normalizeIsbn(isbn);
  const candidates = Array.from(
    new Set([normalized.primary, normalized.isbn10, normalized.isbn13].filter(Boolean).map((value) => cleanIsbn(String(value))))
  );

  for (const candidate of candidates) {
    const match = LOCAL_ISBN_REFERENCE_CATALOG[candidate];
    if (!match) continue;
    return {
      title: match.title,
      subtitle: match.subtitle ?? null,
      authors: match.authors ?? [],
      description: match.description ?? null,
      publisher: match.publisher ?? null,
      publishedDate: match.publishedDate ?? null,
      pageCount: typeof match.pageCount === "number" ? match.pageCount : null,
      subjects: match.subjects ?? [],
      coverUrl: match.coverUrl ?? null,
      format: match.format ?? null,
      mediaType: "book",
      identifiers: {
        isbn10: match.identifiers?.isbn10 ?? normalized.isbn10 ?? null,
        isbn13: match.identifiers?.isbn13 ?? normalized.isbn13 ?? null,
        olid: match.identifiers?.olid ?? null,
        googleVolumeId: match.identifiers?.googleVolumeId ?? null,
      },
      source: "local_reference",
      raw: {
        catalog: "local_isbn_reference",
        matchedIsbn: candidate,
      },
    };
  }

  return null;
}

function buildSearchTokens(input: Array<string | null | undefined>) {
  const tokens = input
    .filter(Boolean)
    .flatMap((value) =>
      String(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((token) => token.trim())
        .filter(Boolean)
    );
  return Array.from(new Set(tokens));
}

function asRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asUnknownArray(value).map((entry) => safeString(entry)).filter((entry) => entry.length > 0);
}

function firstString(value: unknown): string | null {
  return (
    asUnknownArray(value).find((entry): entry is string => typeof entry === "string" && entry.length > 0) ?? null
  );
}

function textOrNull(value: unknown): string | null {
  const valueText = safeString(value);
  return valueText ? valueText : null;
}

function boolOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  const normalized = safeString(value).trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function getIndustryIdentifier(info: unknown, targetType: "ISBN_10" | "ISBN_13"): string | null {
  if (!Array.isArray(info)) return null;
  const found = info.find((entry): entry is Record<string, unknown> => asRecord(entry) && safeString(entry.type) === targetType);
  return textOrNull(found?.identifier);
}

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.max(0, Math.round(numeric * 1000));
  }
  const parsedDate = Date.parse(trimmed);
  if (!Number.isFinite(parsedDate)) return null;
  return Math.max(0, parsedDate - Date.now());
}

type ExternalLookupProviderDefinition = {
  provider: ProviderName;
  label: string;
  authMode: ProviderAuthMode;
  tokenEnvKeys: string[];
  defaultEnabled: boolean;
  supportedLookupModes: ProviderLookupMode[];
  supportedMediaTypes: ProviderSupportedMediaType[];
};

const EXTERNAL_LOOKUP_PROVIDER_DEFINITIONS: Record<ProviderName, ExternalLookupProviderDefinition> = {
  openlibrary: {
    provider: "openlibrary",
    label: "Open Library",
    authMode: "none",
    tokenEnvKeys: [],
    defaultEnabled: true,
    supportedLookupModes: ["isbn", "title", "title_author"],
    supportedMediaTypes: ["book", "comic"],
  },
  googlebooks: {
    provider: "googlebooks",
    label: "Google Books",
    authMode: "none",
    tokenEnvKeys: [],
    defaultEnabled: true,
    supportedLookupModes: ["isbn", "title", "title_author"],
    supportedMediaTypes: ["book", "comic"],
  },
  loc: {
    provider: "loc",
    label: "Library of Congress",
    authMode: "none",
    tokenEnvKeys: [],
    defaultEnabled: true,
    supportedLookupModes: ["title", "title_author"],
    supportedMediaTypes: ["book", "comic"],
  },
  wikidata: {
    provider: "wikidata",
    label: "Wikidata",
    authMode: "none",
    tokenEnvKeys: [],
    defaultEnabled: true,
    supportedLookupModes: ["title", "title_author"],
    supportedMediaTypes: ["book", "comic", "tabletop_rpg", "board_game", "video_game"],
  },
  boardgamegeek: {
    provider: "boardgamegeek",
    label: "BoardGameGeek",
    authMode: "token",
    tokenEnvKeys: ["LIBRARY_BOARDGAMEGEEK_TOKEN", "LIBRARY_GEEKDO_TOKEN"],
    defaultEnabled: false,
    supportedLookupModes: ["title", "title_author"],
    supportedMediaTypes: ["board_game"],
  },
  rpggeek: {
    provider: "rpggeek",
    label: "RPGGeek",
    authMode: "token",
    tokenEnvKeys: ["LIBRARY_RPGGEEK_TOKEN", "LIBRARY_GEEKDO_TOKEN"],
    defaultEnabled: false,
    supportedLookupModes: ["title", "title_author"],
    supportedMediaTypes: ["tabletop_rpg"],
  },
  videogamegeek: {
    provider: "videogamegeek",
    label: "VideoGameGeek",
    authMode: "token",
    tokenEnvKeys: ["LIBRARY_VIDEOGAMEGEEK_TOKEN", "LIBRARY_GEEKDO_TOKEN"],
    defaultEnabled: false,
    supportedLookupModes: ["title", "title_author"],
    supportedMediaTypes: ["video_game"],
  },
};

export const KNOWN_EXTERNAL_LOOKUP_PROVIDERS = Object.keys(EXTERNAL_LOOKUP_PROVIDER_DEFINITIONS) as ProviderName[];

function getProviderDefinition(provider: ProviderName): ExternalLookupProviderDefinition {
  return EXTERNAL_LOOKUP_PROVIDER_DEFINITIONS[provider];
}

function getProviderToken(provider: ProviderName): string | null {
  const definition = getProviderDefinition(provider);
  for (const key of definition.tokenEnvKeys) {
    const value = textOrNull(process.env[key]);
    if (value) return value;
  }
  return null;
}

function isProviderTokenConfigured(provider: ProviderName): boolean {
  return Boolean(getProviderToken(provider));
}

function isProviderAvailable(provider: ProviderName): boolean {
  const definition = getProviderDefinition(provider);
  if (definition.authMode === "none") return true;
  return isProviderTokenConfigured(provider);
}

function buildProviderConfigState(input: {
  provider: ProviderName;
  disabledProviders: Set<ProviderName>;
}): LibraryExternalLookupProviderConfig["providers"][number] {
  const definition = getProviderDefinition(input.provider);
  const tokenConfigured = isProviderTokenConfigured(input.provider);
  const available = definition.authMode === "none" ? true : tokenConfigured;
  const enabled = !input.disabledProviders.has(input.provider) && available;
  return {
    provider: input.provider,
    label: definition.label,
    authMode: definition.authMode,
    available,
    tokenConfigured,
    enabled,
    supportedLookupModes: [...definition.supportedLookupModes],
    supportedMediaTypes: [...definition.supportedMediaTypes],
  };
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600);
}

function nextBackoffMs(attempt: number): number {
  const jitter = 0.85 + Math.random() * 0.3;
  const expo = LIBRARY_PROVIDER_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.max(
    LIBRARY_PROVIDER_BACKOFF_MS,
    Math.min(LIBRARY_PROVIDER_MAX_BACKOFF_MS, Math.round(expo * jitter))
  );
}

const providerNextAllowedAt = new Map<ProviderName, number>();

async function paceProvider(provider: ProviderName): Promise<void> {
  const now = Date.now();
  const next = providerNextAllowedAt.get(provider) ?? now;
  if (next > now) {
    await sleep(next - now);
  }
  providerNextAllowedAt.set(provider, Date.now() + LIBRARY_PROVIDER_PACING_MS);
}

function buildProviderRequestHeaders(provider: ProviderName, accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "MonsoonFire-Portal/1.0 (+https://portal.monsoonfire.com; contact support@monsoonfire.com)",
  };
  const token = getProviderToken(provider);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchTextWithProviderPolicy(params: {
  provider: ProviderName;
  url: string;
  accept?: string;
}): Promise<string | null> {
  const definition = getProviderDefinition(params.provider);
  if (definition.authMode === "token" && !isProviderAvailable(params.provider)) {
    logger.warn("Library provider unavailable due to missing token", {
      provider: params.provider,
    });
    return null;
  }
  const headers = buildProviderRequestHeaders(params.provider, params.accept ?? "application/json");

  for (let attempt = 1; attempt <= LIBRARY_PROVIDER_MAX_ATTEMPTS; attempt += 1) {
    await paceProvider(params.provider);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LIBRARY_PROVIDER_TIMEOUT_MS);
    try {
      const response = await fetch(params.url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        const retryable = isRetryableProviderStatus(response.status);
        if (retryable && attempt < LIBRARY_PROVIDER_MAX_ATTEMPTS) {
          const waitMs = retryAfterMs ?? nextBackoffMs(attempt);
          logger.warn("Library provider request retry scheduled", {
            provider: params.provider,
            status: response.status,
            attempt,
            waitMs,
          });
          await sleep(waitMs);
          continue;
        }
        logger.warn("Library provider request failed", {
          provider: params.provider,
          status: response.status,
          attempt,
        });
        return null;
      }
      return await response.text();
    } catch (error: unknown) {
      const code = asRecord(error) ? safeString(error.code) : "";
      const message = error instanceof Error ? error.message : String(error);
      const aborted = code === "ABORT_ERR" || /abort|timed? ?out/i.test(message);
      if (attempt < LIBRARY_PROVIDER_MAX_ATTEMPTS) {
        const waitMs = nextBackoffMs(attempt);
        logger.warn("Library provider request transient failure", {
          provider: params.provider,
          attempt,
          waitMs,
          aborted,
          message,
        });
        await sleep(waitMs);
        continue;
      }
      logger.warn("Library provider request exhausted retries", {
        provider: params.provider,
        attempt,
        aborted,
        message,
      });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

async function fetchJsonWithProviderPolicy(params: {
  provider: ProviderName;
  url: string;
}): Promise<Record<string, unknown> | null> {
  const text = await fetchTextWithProviderPolicy({
    provider: params.provider,
    url: params.url,
    accept: "application/json",
  });
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return asRecord(parsed) ? parsed : null;
  } catch (error: unknown) {
    logger.warn("Library provider returned non-JSON response", {
      provider: params.provider,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function tsToMs(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (asRecord(value)) {
    const timestampLike = value as { toMillis?: unknown };
    if (typeof timestampLike.toMillis === "function") {
      const output = timestampLike.toMillis();
      if (typeof output === "number" && Number.isFinite(output)) return output;
    }
    const seconds = (value as { seconds?: unknown }).seconds;
    const nanos = (value as { nanoseconds?: unknown }).nanoseconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      const nanosValue = typeof nanos === "number" && Number.isFinite(nanos) ? nanos : 0;
      return Math.round(seconds * 1000 + nanosValue / 1_000_000);
    }
  }
  return 0;
}

function hasMeaningfulText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

const LIBRARY_SUMMARY_MAX_LENGTH = 500;

function trimSummaryAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const slice = value.slice(0, Math.max(0, maxLength + 1));
  const boundary = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"), slice.lastIndexOf("\t"));
  const trimmed = (boundary >= Math.max(80, Math.floor(maxLength * 0.55)) ? slice.slice(0, boundary) : slice.slice(0, maxLength))
    .trim()
    .replace(/[,:;]+$/g, "");
  return trimmed || value.slice(0, maxLength).trim();
}

function normalizeSummarySourceText(value: unknown): string | null {
  const raw = textOrNull(value);
  if (!raw) return null;
  const normalized = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

export function deriveLibraryItemSummary(value: unknown): string | null {
  const normalized = normalizeSummarySourceText(value);
  if (!normalized || descriptionLooksPlaceholder(normalized)) return null;
  const sentences = normalized
    .match(/[^.!?]+[.!?]?/g)
    ?.map((entry) => entry.trim())
    .filter((entry) => entry.length > 0) ?? [];
  const base = sentences.length > 0 ? sentences.slice(0, 2).join(" ") : normalized;
  const summary = trimSummaryAtWordBoundary(base, LIBRARY_SUMMARY_MAX_LENGTH).trim();
  return summary || null;
}

function normalizeProviderAssetUrl(value: unknown): string | null {
  const raw = textOrNull(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:") {
      parsed.protocol = "https:";
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return raw.trim() || null;
  }
}

function selectBestImageLink(input: {
  provider: ProviderName;
  imageLinks: Record<string, unknown>;
  order: string[];
}): string | null {
  const candidates = input.order
    .map((key, index) => {
      const url = normalizeProviderAssetUrl(input.imageLinks[key]);
      if (!url) return null;
      const parsedUrl = parseCoverUrl(url);
      const normalized = url.toLowerCase();
      const lowConfidence = parsedUrl ? hasLowConfidenceCoverPattern(normalized, parsedUrl) : false;
      const zoom = parsedUrl ? Number(parsedUrl.searchParams.get("zoom")) : NaN;
      return {
        url,
        index,
        lowConfidence,
        zoom: Number.isFinite(zoom) ? zoom : 0,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (candidates.length === 0) return null;
  candidates.sort((left, right) => {
    if (left.lowConfidence !== right.lowConfidence) {
      return Number(left.lowConfidence) - Number(right.lowConfidence);
    }
    if (left.zoom !== right.zoom) return right.zoom - left.zoom;
    return left.index - right.index;
  });
  return candidates[0]?.url ?? null;
}

function preferredCoverUrl(existing: unknown, incoming: unknown): string | null {
  const current = textOrNull(existing);
  const next = textOrNull(incoming);
  if (!next) return current;
  if (!current) return next;
  if (current.includes("openlibrary.org") && next.includes("googleusercontent.com")) return next;
  return current;
}

export type CoverQualityStatus = "approved" | "needs_review" | "missing";

type CoverQualityProvider = ProviderName | "amazon" | "wikimedia" | "unknown";
export type LibraryCoverProvider = CoverQualityProvider;
export type LibraryCoverIssueKind =
  | "missing"
  | "invalid"
  | "low_confidence"
  | "untrusted"
  | "non_book_mismatch"
  | "manual_review";
type CoverMediaKind = "book" | "non_book" | "unknown";
type CoverQualityContext = {
  mediaType?: unknown;
  format?: unknown;
  source?: unknown;
  googleVolumeId?: unknown;
};

function normalizeCoverMediaSignal(value: unknown): CoverMediaKind {
  const normalized = safeString(value).trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return "unknown";

  if (
    [
      "book",
      "physicalbook",
      "print",
      "paperback",
      "hardcover",
      "softcover",
      "ebook",
      "comic",
      "graphicnovel",
      "manga",
      "tabletoprpg",
      "roleplayinggame",
    ].includes(normalized)
  ) {
    return "book";
  }

  if (
    [
      "media",
      "tool",
      "other",
      "dvd",
      "bluray",
      "cd",
      "vinyl",
      "audio",
      "video",
      "equipment",
      "kit",
      "magazine",
      "journal",
      "boardgame",
      "videogame",
    ].includes(normalized)
  ) {
    return "non_book";
  }

  return "unknown";
}

function resolveCoverMediaKind(context?: CoverQualityContext): CoverMediaKind {
  const mediaSignal = normalizeCoverMediaSignal(context?.mediaType);
  const formatSignal = normalizeCoverMediaSignal(context?.format);

  if (mediaSignal === "non_book" || formatSignal === "non_book") return "non_book";
  if (mediaSignal === "book" || formatSignal === "book") return "book";
  return "unknown";
}

function detectCoverProvider(parsedUrl: URL): CoverQualityProvider {
  const host = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname.toLowerCase();

  if (host === "covers.openlibrary.org" && path.startsWith("/b/")) {
    return "openlibrary";
  }

  if (
    host === "books.googleusercontent.com" ||
    (host === "books.google.com" && path.startsWith("/books/content"))
  ) {
    return "googlebooks";
  }

  if (host === "tile.loc.gov" || host === "loc.gov" || host.endsWith(".loc.gov")) {
    return "loc";
  }

  if (
    host === "upload.wikimedia.org" ||
    host === "commons.wikimedia.org" ||
    host === "wikidata.org" ||
    host === "www.wikidata.org"
  ) {
    return "wikimedia";
  }

  if (host.endsWith("boardgamegeek.com") || host.endsWith("rpggeek.com") || host.endsWith("videogamegeek.com")) {
    if (host.endsWith("boardgamegeek.com")) return "boardgamegeek";
    if (host.endsWith("rpggeek.com")) return "rpggeek";
    if (host.endsWith("videogamegeek.com")) return "videogamegeek";
  }

  if (host === "m.media-amazon.com" || host === "images-na.ssl-images-amazon.com") {
    return "amazon";
  }

  return "unknown";
}

function parseCoverUrl(coverUrl: unknown): URL | null {
  const url = textOrNull(coverUrl);
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function detectCoverProviderFromUrl(coverUrl: unknown): LibraryCoverProvider {
  const parsedUrl = parseCoverUrl(coverUrl);
  return parsedUrl ? detectCoverProvider(parsedUrl) : "unknown";
}

const DISALLOWED_RETAIL_COVER_HOST_MARKERS = [
  "amazon.",
  "ssl-images-amazon.",
  "media-amazon.com",
  "ebay.",
  "ebayimg.com",
  "abebooks.",
  "thriftbooks.com",
  "alibris.com",
  "barnesandnoble.com",
  "powells.com",
] as const;

export function isDisallowedRetailCoverUrl(coverUrl: unknown): boolean {
  const parsedUrl = parseCoverUrl(coverUrl);
  if (!parsedUrl) return false;
  const host = parsedUrl.hostname.toLowerCase();
  return DISALLOWED_RETAIL_COVER_HOST_MARKERS.some((marker) => host.includes(marker));
}

export function classifyLibraryCoverIssueKind(input: {
  coverUrl?: unknown;
  coverQualityStatus?: unknown;
  coverQualityReason?: unknown;
}): LibraryCoverIssueKind {
  const status = safeString(input.coverQualityStatus).trim().toLowerCase();
  const reason = safeString(input.coverQualityReason).trim().toLowerCase();
  const coverUrl = textOrNull(input.coverUrl)?.trim() ?? "";

  if (!coverUrl || status === "missing" || reason === "missing_cover") {
    return "missing";
  }
  if (reason === "invalid_cover_url") return "invalid";
  if (reason === "low_confidence_cover_url") return "low_confidence";
  if (reason === "untrusted_cover_source") return "untrusted";
  if (reason === "provider_book_cover_for_non_book_media") return "non_book_mismatch";
  return "manual_review";
}

function isTrustedCoverSource(provider: CoverQualityProvider, parsedUrl: URL): boolean {
  const path = parsedUrl.pathname.toLowerCase();

  if (provider === "openlibrary") {
    return path.includes("/b/id/") || path.includes("/b/isbn/");
  }

  if (provider === "googlebooks") {
    return (
      parsedUrl.hostname.toLowerCase() === "books.googleusercontent.com" ||
      path.startsWith("/books/content")
    );
  }

  if (provider === "loc") {
    return parsedUrl.hostname.toLowerCase().endsWith(".loc.gov") || parsedUrl.hostname.toLowerCase() === "loc.gov";
  }

  if (provider === "boardgamegeek" || provider === "rpggeek" || provider === "videogamegeek") {
    return (
      parsedUrl.hostname.toLowerCase().endsWith("boardgamegeek.com") ||
      parsedUrl.hostname.toLowerCase().endsWith("rpggeek.com") ||
      parsedUrl.hostname.toLowerCase().endsWith("videogamegeek.com")
    );
  }

  if (provider === "wikimedia") {
    return (
      parsedUrl.hostname.toLowerCase() === "upload.wikimedia.org" ||
      parsedUrl.hostname.toLowerCase() === "commons.wikimedia.org"
    );
  }

  if (provider === "amazon") {
    return path.includes("/images/");
  }

  return false;
}

function hasLowConfidenceCoverPattern(normalizedUrl: string, parsedUrl: URL): boolean {
  const fullPath = `${parsedUrl.pathname}${parsedUrl.search}`.toLowerCase();
  const lowConfidencePatterns: RegExp[] = [
    /(?:^|[/._-])(no[-_ ]?(?:cover|image)|missing[-_ ]?(?:cover|image)|default[-_ ]?(?:cover|image)|placeholder)(?:$|[/._-])/i,
    /\b(first[-_ ]?page|inside[-_ ]?page|table[-_ ]?of[-_ ]?contents|spine|back[-_ ]?cover)\b/i,
    /\b(sample|preview|excerpt|reader|lookinside|flipbook)\b/i,
    /[?&](?:page|pg|leaf|sheet)=\d+/i,
    /[?&](?:view|content)=(?:toc|sample|preview|excerpt|inside|spine|back)/i,
    /\/b\/(?:id|isbn)\/\d+-s\.(?:jpe?g|png|webp)$/i,
  ];

  if (lowConfidencePatterns.some((pattern) => pattern.test(normalizedUrl) || pattern.test(fullPath))) {
    return true;
  }

  const sizeParams = ["w", "width", "h", "height", "sz", "size"];
  for (const key of sizeParams) {
    const value = Number(parsedUrl.searchParams.get(key));
    if (Number.isFinite(value) && value > 0 && value <= 120) {
      return true;
    }
  }

  const zoom = Number(parsedUrl.searchParams.get("zoom"));
  if (Number.isFinite(zoom) && zoom > 0 && zoom <= 1) {
    return true;
  }

  const amazonSizeMatch = fullPath.match(/_(?:sx|sy|sl)(\d{1,3})_/i);
  if (amazonSizeMatch) {
    const size = Number(amazonSizeMatch[1]);
    if (Number.isFinite(size) && size > 0 && size <= 120) {
      return true;
    }
  }

  return false;
}

export function evaluateCoverQuality(coverUrl: unknown, context?: CoverQualityContext): {
  status: CoverQualityStatus;
  needsReview: boolean;
  reason: string | null;
} {
  const url = textOrNull(coverUrl);
  if (!url) {
    return {
      status: "missing",
      needsReview: true,
      reason: "missing_cover",
    };
  }

  const normalized = url.trim().toLowerCase();
  if (!normalized) {
    return {
      status: "missing",
      needsReview: true,
      reason: "missing_cover",
    };
  }

  const parsedUrl = parseCoverUrl(url);

  if (!parsedUrl || (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:")) {
    return {
      status: "needs_review",
      needsReview: true,
      reason: "invalid_cover_url",
    };
  }

  if (hasLowConfidenceCoverPattern(normalized, parsedUrl)) {
    return {
      status: "needs_review",
      needsReview: true,
      reason: "low_confidence_cover_url",
    };
  }

  const provider = detectCoverProvider(parsedUrl);
  const trustedSource = isTrustedCoverSource(provider, parsedUrl);
  const mediaKind = resolveCoverMediaKind(context);
  const providerIsBookCentric =
    provider === "openlibrary" || provider === "googlebooks" || provider === "loc" || provider === "amazon";
  if (trustedSource) {
    if (provider === "wikimedia") {
      return {
        status: "needs_review",
        needsReview: true,
        reason: "untrusted_cover_source",
      };
    }
    if (mediaKind === "non_book" && providerIsBookCentric) {
      return {
        status: "needs_review",
        needsReview: true,
        reason: "provider_book_cover_for_non_book_media",
      };
    }
    return {
      status: "approved",
      needsReview: false,
      reason: null,
    };
  }

  return {
    status: "needs_review",
    needsReview: true,
    reason: "untrusted_cover_source",
  };
}

function applyCoverReviewGuardrailPolicy(params: {
  evaluated: {
    status: CoverQualityStatus;
    needsReview: boolean;
    reason: string | null;
  };
  coverUrl: unknown;
  guardrailEnabled: boolean;
}): {
  status: CoverQualityStatus;
  needsReview: boolean;
  reason: string | null;
} {
  if (params.guardrailEnabled) return params.evaluated;
  const url = textOrNull(params.coverUrl);
  if (!url) return params.evaluated;
  const highRiskReasons = new Set([
    "invalid_cover_url",
    "low_confidence_cover_url",
    "untrusted_cover_source",
    "provider_book_cover_for_non_book_media",
    "openlibrary_cover_requires_verification",
  ]);
  if (params.evaluated.needsReview && params.evaluated.reason && highRiskReasons.has(params.evaluated.reason)) {
    return params.evaluated;
  }
  return {
    status: "approved",
    needsReview: false,
    reason: "cover_guardrail_temporarily_disabled",
  };
}

function evaluateCoverQualityWithPolicy(params: {
  coverUrl: unknown;
  context?: CoverQualityContext;
  guardrailEnabled: boolean;
}): {
  status: CoverQualityStatus;
  needsReview: boolean;
  reason: string | null;
  coverProvider: LibraryCoverProvider;
  coverIssueKind: LibraryCoverIssueKind;
} {
  const evaluated = evaluateCoverQuality(params.coverUrl, params.context);
  const finalState = applyCoverReviewGuardrailPolicy({
    evaluated,
    coverUrl: params.coverUrl,
    guardrailEnabled: params.guardrailEnabled,
  });
  return {
    ...finalState,
    coverProvider: detectCoverProviderFromUrl(params.coverUrl),
    coverIssueKind: classifyLibraryCoverIssueKind({
      coverUrl: params.coverUrl,
      coverQualityStatus: finalState.status,
      coverQualityReason: finalState.reason,
    }),
  };
}

function readLibraryItemGoogleVolumeId(row: Record<string, unknown>): string | null {
  const identifiers =
    row.identifiers && typeof row.identifiers === "object" && !Array.isArray(row.identifiers)
      ? (row.identifiers as Record<string, unknown>)
      : null;
  return textOrNull(identifiers?.googleVolumeId) ?? textOrNull(row.googleVolumeId);
}

function rowNeedsCoverReviewQueue(row: Record<string, unknown>): boolean {
  const rawNeedsReview = row.needsCoverReview === true;
  const coverQualityStatus = safeString(row.coverQualityStatus).trim().toLowerCase();
  return rawNeedsReview || coverQualityStatus === "needs_review" || coverQualityStatus === "missing";
}

export type LibraryCoverReviewReconcileResult = {
  limit: number;
  scanned: number;
  approved: number;
  stillNeedsReview: number;
  missing: number;
};

export async function reconcileLibraryCoverReviews(input?: {
  limit?: number;
}): Promise<LibraryCoverReviewReconcileResult> {
  const limit = Math.max(1, Math.min(250, Math.trunc(input?.limit ?? 160) || 160));
  const providerConfig = await getLibraryExternalLookupProviderConfig();
  const guardrailEnabled = providerConfig.coverReviewGuardrailEnabled !== false;

  let coverReviewSnap;
  try {
    coverReviewSnap = await db.collection("libraryItems").where("needsCoverReview", "==", true).limit(Math.max(limit, 120)).get();
  } catch (error) {
    logger.warn("library cover reconcile where fallback engaged", {
      limit,
      message: error instanceof Error ? error.message : String(error),
    });
    try {
      coverReviewSnap = await db.collection("libraryItems").orderBy("updatedAt", "desc").limit(Math.max(limit * 2, 160)).get();
    } catch (orderError) {
      logger.warn("library cover reconcile limit fallback engaged", {
        limit,
        message: orderError instanceof Error ? orderError.message : String(orderError),
      });
      coverReviewSnap = await db.collection("libraryItems").limit(Math.max(limit * 3, 240)).get();
    }
  }

  const candidates = coverReviewSnap.docs
    .map((docSnap) => ({ id: docSnap.id, row: (docSnap.data() ?? {}) as Record<string, unknown> }))
    .filter((entry) => rowNeedsCoverReviewQueue(entry.row))
    .sort((left, right) => tsToMs(right.row.updatedAt) - tsToMs(left.row.updatedAt))
    .slice(0, limit);

  let approved = 0;
  let stillNeedsReview = 0;
  let missing = 0;

  for (const entry of candidates) {
    const assessment = evaluateCoverQualityWithPolicy({
      coverUrl: entry.row.coverUrl,
      context: {
        mediaType: entry.row.mediaType,
        format: entry.row.format,
        source: entry.row.source,
        googleVolumeId: readLibraryItemGoogleVolumeId(entry.row),
      },
      guardrailEnabled,
    });

    if (assessment.coverIssueKind === "missing") {
      missing += 1;
    }
    if (assessment.needsReview) {
      stillNeedsReview += 1;
    } else {
      approved += 1;
    }

    const currentStatus = safeString(entry.row.coverQualityStatus).trim().toLowerCase() || "needs_review";
    const currentNeedsReview = entry.row.needsCoverReview === true;
    const currentReason = textOrNull(entry.row.coverQualityReason);

    if (
      currentStatus === assessment.status &&
      currentNeedsReview === assessment.needsReview &&
      currentReason === assessment.reason
    ) {
      continue;
    }

    const validatedAt = nowTs();
    await db.collection("libraryItems").doc(entry.id).set(
      {
        coverQualityStatus: assessment.status,
        needsCoverReview: assessment.needsReview,
        coverQualityReason: assessment.reason,
        coverQualityValidatedAt: validatedAt,
        updatedAt: validatedAt,
      },
      { merge: true }
    );
  }

  return {
    limit,
    scanned: candidates.length,
    approved,
    stillNeedsReview,
    missing,
  };
}

async function fetchOpenLibrary(isbn: string): Promise<LookupResult | null> {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  const data = await fetchJsonWithProviderPolicy({ provider: "openlibrary", url });
  if (!data) return null;
  const rawEntry = data[`ISBN:${isbn}`];
  if (!asRecord(rawEntry)) return null;
  const entry = rawEntry;
  const cover = asRecord(entry.cover) ? (entry.cover as Record<string, unknown>) : {};
  const identifiers = asRecord(entry.identifiers) ? (entry.identifiers as Record<string, unknown>) : {};
  const publishers = asStringArray(asRecord(entry.publishers) ? entry.publishers : []);

  const authors =
    asUnknownArray(entry.authors)
      .map((author) => safeString(asRecord(author) ? (author as Record<string, unknown>).name : null))
      .filter((entry) => entry.length > 0);
  const subjects =
    asUnknownArray(entry.subjects)
      .map((subject) => safeString(asRecord(subject) ? (subject as Record<string, unknown>).name : null))
      .filter((entry) => entry.length > 0);
  const entryDescription =
    typeof entry.description === "string"
      ? entry.description
      : asRecord(entry.description)
      ? safeString((entry.description as Record<string, unknown>).value)
      : "";
  const entrySubtitle = textOrNull(entry.subtitle);
  const entryPublishedDate = textOrNull(entry.publish_date);
  const pageCount = typeof entry.number_of_pages === "number" ? entry.number_of_pages : null;
  const format = textOrNull(entry.physical_format);

  const coverUrl = normalizeProviderAssetUrl(cover.large) || normalizeProviderAssetUrl(cover.medium) || normalizeProviderAssetUrl(cover.small);
  const publisher = publishers[0] ?? null;
  const pageCountValue = pageCount;

  const publisherList = publishers;

  return {
    title: textOrNull(entry.title) || `ISBN ${isbn}`,
    subtitle: entrySubtitle,
    authors,
    description: entryDescription || null,
    publisher,
    publishedDate: entryPublishedDate,
    pageCount: pageCountValue,
    subjects,
    coverUrl: textOrNull(coverUrl),
    format: format,
    mediaType: "book",
    identifiers: {
      isbn10: firstString(identifiers.isbn_10),
      isbn13: firstString(identifiers.isbn_13),
      olid: firstString(identifiers.openlibrary),
      googleVolumeId: null,
    },
    source: "openlibrary",
    raw: {
      title: entry.title ?? null,
      subtitle: entry.subtitle ?? null,
      authors,
      publish_date: entry.publish_date ?? null,
      number_of_pages: entry.number_of_pages ?? null,
      publishers: publisherList,
      subjects,
      cover,
    },
  };
}

async function fetchGoogleBooks(isbn: string): Promise<LookupResult | null> {
  const url =
    "https://www.googleapis.com/books/v1/volumes" +
    `?q=isbn:${encodeURIComponent(isbn)}` +
    "&maxResults=1" +
    "&fields=items(id,volumeInfo(title,subtitle,authors,description,publisher,publishedDate,pageCount,printType,categories,imageLinks,industryIdentifiers))";
  const data = await fetchJsonWithProviderPolicy({ provider: "googlebooks", url });
  if (!data) return null;
  const items = asUnknownArray(data.items);
  const item = items[0];
  if (!asRecord(item)) return null;
  if (!asRecord(item.volumeInfo)) return null;
  const itemRecord = item as Record<string, unknown>;
  const info = itemRecord.volumeInfo as Record<string, unknown>;

  const imageLinks = asRecord(info.imageLinks) ? (info.imageLinks as Record<string, unknown>) : {};
  const industryIdentifiers = asUnknownArray(info.industryIdentifiers);

  const title = safeString(info.title) || `ISBN ${isbn}`;
  const subtitle = textOrNull(info.subtitle);
  const description = textOrNull(info.description);
  const publisher = textOrNull(info.publisher);
  const publishedDate = textOrNull(info.publishedDate);
  const pageCountValue = typeof info.pageCount === "number" ? info.pageCount : null;
  const format = textOrNull(info.printType) || null;

  const categories = asStringArray(info.categories);
  const publishers = asStringArray(info.authors);
  const coverUrl = selectBestImageLink({
    provider: "googlebooks",
    imageLinks,
    order: ["extraLarge", "large", "medium", "small", "smallThumbnail", "thumbnail"],
  });

  return {
    title,
    subtitle,
    authors: asStringArray(info.authors),
    description,
    publisher,
    publishedDate,
    pageCount: pageCountValue,
    subjects: categories,
    coverUrl,
    format,
    mediaType: "book",
    identifiers: {
      isbn10: getIndustryIdentifier(industryIdentifiers, "ISBN_10") ?? null,
      isbn13: getIndustryIdentifier(industryIdentifiers, "ISBN_13") ?? null,
      olid: null,
      googleVolumeId: safeString((item as Record<string, unknown>).id) || null,
    },
    source: "googlebooks",
    raw: {
      title: info.title ?? null,
      subtitle: info.subtitle ?? null,
      authors: publishers,
      publisher: info.publisher ?? null,
      publishedDate: info.publishedDate ?? null,
      pageCount: pageCountValue,
      categories: info.categories ?? null,
      imageLinks,
    },
  };
}

function mergeResults(primary: LookupResult | null, secondary: LookupResult | null): LookupResult | null {
  if (!primary && !secondary) return null;
  if (primary && !secondary) return primary;
  if (!primary && secondary) return secondary;

  const best = primary as LookupResult;
  const other = secondary as LookupResult;

  return {
    title: best.title || other.title,
    subtitle: best.subtitle ?? other.subtitle ?? null,
    authors: best.authors.length ? best.authors : other.authors,
    description: best.description ?? other.description ?? null,
    publisher: best.publisher ?? other.publisher ?? null,
    publishedDate: best.publishedDate ?? other.publishedDate ?? null,
    pageCount: best.pageCount ?? other.pageCount ?? null,
    subjects: (best.subjects && best.subjects.length ? best.subjects : other.subjects) ?? [],
    coverUrl: best.coverUrl ?? other.coverUrl ?? null,
    format: best.format ?? other.format ?? null,
    mediaType: best.mediaType ?? other.mediaType ?? null,
    identifiers: {
      isbn10: best.identifiers.isbn10 ?? other.identifiers.isbn10 ?? null,
      isbn13: best.identifiers.isbn13 ?? other.identifiers.isbn13 ?? null,
      olid: best.identifiers.olid ?? other.identifiers.olid ?? null,
      googleVolumeId: best.identifiers.googleVolumeId ?? other.identifiers.googleVolumeId ?? null,
    },
    source: best.source,
    raw: {
      primary: best.raw ?? null,
      secondary: other.raw ?? null,
    },
  };
}

async function lookupIsbnRemote(
  isbn: string,
  options: { includeRemoteWhenLocalFound?: boolean } = {}
): Promise<LookupResult | null> {
  const includeRemoteWhenLocalFound = options.includeRemoteWhenLocalFound === true;
  const localReference = lookupLocalIsbnReference(isbn);
  if (localReference && !includeRemoteWhenLocalFound) return localReference;

  const providerConfig = await getLibraryExternalLookupProviderConfig();
  const disabledProviders = new Set(providerConfig.disabledProviders);
  const [openLibrary, googleBooks] = await Promise.all([
    !disabledProviders.has("openlibrary")
      ? fetchOpenLibrary(isbn).catch((err) => {
          logger.warn("OpenLibrary lookup failed", { isbn, message: err?.message ?? String(err) });
          return null;
        })
      : Promise.resolve(null),
    !disabledProviders.has("googlebooks")
      ? fetchGoogleBooks(isbn).catch((err) => {
          logger.warn("Google Books lookup failed", { isbn, message: err?.message ?? String(err) });
          return null;
        })
      : Promise.resolve(null),
  ]);

  const mergedRemote = mergeResults(openLibrary, googleBooks);
  const merged = localReference
    ? mergeResults(mergedRemote, localReference)
    : mergedRemote;
  if (merged) return merged;

  return localReference;
}

async function lookupIsbn(
  isbn: string,
  options: { includeRemoteWhenLocalFound?: boolean; allowManualFallback?: boolean } = {}
): Promise<LookupResult> {
  const lookup = await lookupIsbnRemote(isbn, options);
  if (lookup) return lookup;
  if (options.allowManualFallback === false) {
    throw new Error("No metadata providers could resolve that ISBN.");
  }
  return manualLookupFallbackForIsbn(isbn);
}

function externalLookupItemToLookupResult(item: LibraryExternalLookupItem): LookupResult {
  return {
    title: item.title,
    subtitle: item.subtitle ?? null,
    authors: item.authors ?? [],
    description: item.description ?? null,
    publisher: item.publisher ?? null,
    publishedDate: item.publishedDate ?? null,
    pageCount: null,
    subjects: [],
    coverUrl: item.coverUrl ?? null,
    format: item.format ?? null,
    mediaType: item.mediaType ?? null,
    identifiers: {
      isbn10: item.identifiers.isbn10 ?? null,
      isbn13: item.identifiers.isbn13 ?? null,
      olid: item.identifiers.olid ?? null,
      googleVolumeId: item.identifiers.googleVolumeId ?? null,
    },
    source: item.source,
    raw: {
      sourceId: item.sourceId,
      sourceUrl: item.sourceUrl,
      publicLibraryUrl: item.publicLibraryUrl,
      sourceLabel: item.sourceLabel,
    },
  };
}

function readFirstAuthor(values: unknown): string | null {
  return normalizeUniqueStrings(maybeStringArray(values))[0] ?? null;
}

function scoreExternalLookupCandidate(input: {
  row: Record<string, unknown>;
  candidate: LibraryExternalLookupItem;
}): number {
  const rowTitle = normalizeLookupMatchToken(input.row.title);
  const candidateTitle = normalizeLookupMatchToken(input.candidate.title);
  const rowAuthor = normalizeLookupMatchToken(readFirstAuthor(input.row.authors));
  const candidateAuthor = normalizeLookupMatchToken(input.candidate.authors[0]);
  const rowIsbn = normalizeValidIsbn(normalizeIsbnFromRow(input.row))?.primary ?? null;
  const candidateIsbn = cleanIsbn(input.candidate.identifiers.isbn13 ?? input.candidate.identifiers.isbn10 ?? "") || null;
  let score = 0;
  if (rowIsbn && candidateIsbn && rowIsbn === candidateIsbn) score += 120;
  if (rowTitle && candidateTitle && rowTitle === candidateTitle) {
    score += 80;
  } else if (rowTitle && candidateTitle && (candidateTitle.includes(rowTitle) || rowTitle.includes(candidateTitle))) {
    score += 45;
  }
  if (rowAuthor && candidateAuthor && rowAuthor === candidateAuthor) score += 25;
  if (input.candidate.description) score += 8;
  if (input.candidate.coverUrl) score += 6;
  if (input.candidate.publisher) score += 4;
  const rowMediaType = normalizeLookupMatchToken(input.row.mediaType ?? input.row.format);
  const candidateMediaType = normalizeLookupMatchToken(input.candidate.mediaType ?? input.candidate.format);
  if (rowMediaType && candidateMediaType && rowMediaType === candidateMediaType) score += 18;
  return score;
}

async function lookupMetadataByTitle(row: Record<string, unknown>): Promise<LookupResult | null> {
  const title = maybeText(row.title);
  if (!title || titleLooksPlaceholder(title)) return null;
  const author = readFirstAuthor(row.authors);
  const q = [title, author].filter(Boolean).join(" ");
  if (!q.trim()) return null;
  const result = await lookupLibraryExternalSources({ q, limit: 8 });
  const ranked = [...result.items]
    .map((candidate) => ({
      candidate,
      score: scoreExternalLookupCandidate({ row, candidate }),
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score < 55) return null;
  return externalLookupItemToLookupResult(best.candidate);
}

function manualLookupFallbackForIsbn(isbn: string): LookupResult {
  return {
    title: `ISBN ${isbn}`,
    subtitle: null,
    authors: [],
    description: null,
    publisher: null,
    publishedDate: null,
    pageCount: null,
    subjects: [],
    coverUrl: null,
    format: null,
    mediaType: "book",
    identifiers: { isbn10: null, isbn13: null, olid: null, googleVolumeId: null },
    source: "manual",
  };
}

export async function resolveLibraryIsbn(params: {
  isbn: string;
  allowRemoteLookup?: boolean;
  includeRemoteWhenLocalFound?: boolean;
}): Promise<ResolvedLibraryIsbnResult> {
  const normalized = normalizeValidIsbn(params.isbn ?? "");
  if (!normalized) {
    throw new Error("Provide a valid ISBN-10 or ISBN-13.");
  }

  const allowRemoteLookup = params.allowRemoteLookup !== false;
  let lookup: LookupResult;
  if (!allowRemoteLookup) {
    lookup = lookupLocalIsbnReference(normalized.primary) ?? manualLookupFallbackForIsbn(normalized.primary);
  } else {
    lookup = await lookupIsbn(normalized.primary, {
      includeRemoteWhenLocalFound: params.includeRemoteWhenLocalFound === true,
      allowManualFallback: true,
    });
  }

  const isbn10 = cleanIsbn(lookup.identifiers.isbn10 ?? normalized.isbn10 ?? "") || null;
  const isbn13 = cleanIsbn(lookup.identifiers.isbn13 ?? normalized.isbn13 ?? "") || null;

  return {
    normalized: {
      primary: normalized.primary,
      isbn10,
      isbn13,
    },
    lookup: {
      title: lookup.title,
      subtitle: lookup.subtitle ?? null,
      authors: lookup.authors ?? [],
      description: lookup.description ?? null,
      publisher: lookup.publisher ?? null,
      publishedDate: lookup.publishedDate ?? null,
      pageCount: typeof lookup.pageCount === "number" ? lookup.pageCount : null,
      subjects: lookup.subjects ?? [],
      coverUrl: lookup.coverUrl ?? null,
      format: lookup.format ?? null,
      source: lookup.source,
      identifiers: {
        isbn10: lookup.identifiers.isbn10 ?? null,
        isbn13: lookup.identifiers.isbn13 ?? null,
        olid: lookup.identifiers.olid ?? null,
        googleVolumeId: lookup.identifiers.googleVolumeId ?? null,
      },
      raw: lookup.raw ?? null,
    },
    fallback: lookup.source === "manual",
    usedRemoteLookup: allowRemoteLookup,
  };
}

type ExternalLookupCacheEntry = {
  expiresAtMs: number;
  value: LibraryExternalLookupResult;
};

const externalLookupCache = new Map<string, ExternalLookupCacheEntry>();
const externalLookupInFlight = new Map<string, Promise<LibraryExternalLookupResult>>();
const envDisabledExternalLookupProviders = new Set<ProviderName>(
  safeString(process.env.LIBRARY_EXTERNAL_LOOKUP_DISABLED_PROVIDERS)
    .split(/[,\s]+/g)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is ProviderName => KNOWN_EXTERNAL_LOOKUP_PROVIDERS.includes(entry as ProviderName))
);
const envCoverReviewGuardrailEnabled =
  boolOrNull(process.env.LIBRARY_COVER_REVIEW_GUARDRAIL_ENABLED) ?? true;
type ExternalLookupProviderConfigCacheEntry = {
  expiresAtMs: number;
  value: LibraryExternalLookupProviderConfig;
};
let externalLookupProviderConfigCache: ExternalLookupProviderConfigCacheEntry | null = null;
let externalLookupProviderConfigInFlight: Promise<LibraryExternalLookupProviderConfig> | null = null;
const LIBRARY_DEFAULT_ROLLOUT_PHASE: LibraryRolloutPhase = "phase_3_admin_full";
type LibraryRolloutConfigCacheEntry = {
  expiresAtMs: number;
  value: LibraryRolloutConfig;
};
let libraryRolloutConfigCache: LibraryRolloutConfigCacheEntry | null = null;
let libraryRolloutConfigInFlight: Promise<LibraryRolloutConfig> | null = null;

function normalizeExternalLookupLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return LIBRARY_EXTERNAL_LOOKUP_DEFAULT_LIMIT;
  const rounded = Math.trunc(limit);
  return Math.max(1, Math.min(LIBRARY_EXTERNAL_LOOKUP_MAX_LIMIT, rounded));
}

function normalizeExternalLookupQuery(query: unknown): string {
  return safeString(query).trim().replace(/\s+/g, " ").slice(0, 240);
}

function externalLookupCacheKey(q: string, limit: number): string {
  return `${q.toLowerCase()}::${limit}`;
}

function normalizeLookupProviderName(value: unknown): ProviderName | null {
  const normalized = safeString(value).trim().toLowerCase();
  return KNOWN_EXTERNAL_LOOKUP_PROVIDERS.includes(normalized as ProviderName) ? (normalized as ProviderName) : null;
}

function normalizeLibraryRolloutPhase(value: unknown): LibraryRolloutPhase | null {
  const normalized = safeString(value).trim().toLowerCase();
  return LIBRARY_ROLLOUT_PHASES.includes(normalized as LibraryRolloutPhase)
    ? (normalized as LibraryRolloutPhase)
    : null;
}

function defaultExternalLookupProviderConfig(): LibraryExternalLookupProviderConfig {
  const disabledProviders = new Set<ProviderName>(envDisabledExternalLookupProviders);
  for (const provider of KNOWN_EXTERNAL_LOOKUP_PROVIDERS) {
    const definition = getProviderDefinition(provider);
    if (!definition.defaultEnabled || !isProviderAvailable(provider)) {
      disabledProviders.add(provider);
    }
  }
  const disabledProvidersList = Array.from(disabledProviders).sort();
  return {
    openlibraryEnabled: !disabledProviders.has("openlibrary"),
    googlebooksEnabled: !disabledProviders.has("googlebooks"),
    disabledProviders: disabledProvidersList,
    providers: KNOWN_EXTERNAL_LOOKUP_PROVIDERS.map((provider) =>
      buildProviderConfigState({ provider, disabledProviders })
    ),
    coverReviewGuardrailEnabled: envCoverReviewGuardrailEnabled,
    updatedAtMs: 0,
    updatedByUid: null,
    note: null,
  };
}

function toExternalLookupProviderConfig(row: Record<string, unknown> | null | undefined): LibraryExternalLookupProviderConfig {
  const disabled = new Set<ProviderName>(envDisabledExternalLookupProviders);
  const guardrailOverride = boolOrNull(row?.coverReviewGuardrailEnabled);
  const coverReviewGuardrailEnabled = guardrailOverride === null ? envCoverReviewGuardrailEnabled : guardrailOverride;
  if (row) {
    for (const rawProvider of asStringArray(row.disabledProviders)) {
      const provider = normalizeLookupProviderName(rawProvider);
      if (provider) disabled.add(provider);
    }
    if (boolOrNull(row.openlibraryEnabled) === false) disabled.add("openlibrary");
    if (boolOrNull(row.openlibraryEnabled) === true && !envDisabledExternalLookupProviders.has("openlibrary")) {
      disabled.delete("openlibrary");
    }
    if (boolOrNull(row.googlebooksEnabled) === false) disabled.add("googlebooks");
    if (boolOrNull(row.googlebooksEnabled) === true && !envDisabledExternalLookupProviders.has("googlebooks")) {
      disabled.delete("googlebooks");
    }
  }
  for (const provider of KNOWN_EXTERNAL_LOOKUP_PROVIDERS) {
    const definition = getProviderDefinition(provider);
    if (!definition.defaultEnabled || !isProviderAvailable(provider)) {
      disabled.add(provider);
    }
  }
  const disabledProviders = Array.from(disabled).sort();
  return {
    openlibraryEnabled: !disabled.has("openlibrary"),
    googlebooksEnabled: !disabled.has("googlebooks"),
    disabledProviders,
    providers: KNOWN_EXTERNAL_LOOKUP_PROVIDERS.map((provider) =>
      buildProviderConfigState({ provider, disabledProviders: disabled })
    ),
    coverReviewGuardrailEnabled,
    updatedAtMs: Math.max(0, tsToMs(row?.updatedAt), tsToMs(row?.createdAt)),
    updatedByUid: textOrNull(row?.updatedByUid),
    note: textOrNull(row?.note),
  };
}

function externalLookupProviderConfigDoc() {
  return db.collection(LIBRARY_SETTINGS_COLLECTION).doc(LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_DOC);
}

function libraryRolloutConfigDoc() {
  return db.collection(LIBRARY_SETTINGS_COLLECTION).doc(LIBRARY_ROLLOUT_CONFIG_DOC);
}

function clearExternalLookupResultCaches() {
  externalLookupCache.clear();
  externalLookupInFlight.clear();
}

export async function getLibraryExternalLookupProviderConfig(): Promise<LibraryExternalLookupProviderConfig> {
  const nowMs = Date.now();
  if (externalLookupProviderConfigCache && externalLookupProviderConfigCache.expiresAtMs > nowMs) {
    return externalLookupProviderConfigCache.value;
  }
  if (externalLookupProviderConfigInFlight) return externalLookupProviderConfigInFlight;

  externalLookupProviderConfigInFlight = (async () => {
    try {
      const snap = await externalLookupProviderConfigDoc().get();
      const row = snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
      const config = toExternalLookupProviderConfig(row);
      externalLookupProviderConfigCache = {
        expiresAtMs: Date.now() + LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_CACHE_TTL_MS,
        value: config,
      };
      return config;
    } catch (error) {
      logger.warn("Library external lookup provider config fallback to defaults", {
        message: error instanceof Error ? error.message : String(error),
      });
      const fallback = defaultExternalLookupProviderConfig();
      externalLookupProviderConfigCache = {
        expiresAtMs: Date.now() + LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_CACHE_TTL_MS,
        value: fallback,
      };
      return fallback;
    } finally {
      externalLookupProviderConfigInFlight = null;
    }
  })();

  return externalLookupProviderConfigInFlight;
}

export async function setLibraryExternalLookupProviderConfig(input: {
  openlibraryEnabled?: boolean;
  googlebooksEnabled?: boolean;
  disabledProviders?: ProviderName[];
  coverReviewGuardrailEnabled?: boolean;
  note?: string | null;
  updatedByUid?: string | null;
}): Promise<LibraryExternalLookupProviderConfig> {
  const current = await getLibraryExternalLookupProviderConfig();
  const hasOpenlibraryToggle = typeof input.openlibraryEnabled === "boolean";
  const hasGooglebooksToggle = typeof input.googlebooksEnabled === "boolean";
  const nextOpenlibraryEnabled = typeof input.openlibraryEnabled === "boolean"
    ? input.openlibraryEnabled
    : current.openlibraryEnabled;
  const nextGooglebooksEnabled = typeof input.googlebooksEnabled === "boolean"
    ? input.googlebooksEnabled
    : current.googlebooksEnabled;
  const nextCoverReviewGuardrailEnabled = typeof input.coverReviewGuardrailEnabled === "boolean"
    ? input.coverReviewGuardrailEnabled
    : current.coverReviewGuardrailEnabled;
  const nextNote = textOrNull(input.note) ?? current.note ?? null;
  const nextUpdatedByUid = textOrNull(input.updatedByUid) ?? null;

  const disabledProviders = new Set<ProviderName>(
    Array.isArray(input.disabledProviders) && input.disabledProviders.length > 0
      ? input.disabledProviders
      : current.disabledProviders
  );
  for (const provider of envDisabledExternalLookupProviders) {
    disabledProviders.add(provider);
  }
  for (const provider of KNOWN_EXTERNAL_LOOKUP_PROVIDERS) {
    const definition = getProviderDefinition(provider);
    if (!definition.defaultEnabled || !isProviderAvailable(provider)) {
      disabledProviders.add(provider);
    }
  }
  if (hasOpenlibraryToggle) {
    if (!nextOpenlibraryEnabled) disabledProviders.add("openlibrary");
    if (nextOpenlibraryEnabled && isProviderAvailable("openlibrary") && getProviderDefinition("openlibrary").defaultEnabled) {
      disabledProviders.delete("openlibrary");
    }
  }
  if (hasGooglebooksToggle) {
    if (!nextGooglebooksEnabled) disabledProviders.add("googlebooks");
    if (nextGooglebooksEnabled && isProviderAvailable("googlebooks") && getProviderDefinition("googlebooks").defaultEnabled) {
      disabledProviders.delete("googlebooks");
    }
  }
  const disabledProvidersList = Array.from(disabledProviders).sort();

  const now = nowTs();
  await externalLookupProviderConfigDoc().set(
    {
      openlibraryEnabled: !disabledProviders.has("openlibrary"),
      googlebooksEnabled: !disabledProviders.has("googlebooks"),
      disabledProviders: disabledProvidersList,
      coverReviewGuardrailEnabled: nextCoverReviewGuardrailEnabled,
      note: nextNote,
      updatedByUid: nextUpdatedByUid,
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );

  externalLookupProviderConfigCache = {
    expiresAtMs: Date.now() + LIBRARY_EXTERNAL_LOOKUP_PROVIDER_CONFIG_CACHE_TTL_MS,
        value: {
          openlibraryEnabled: !disabledProviders.has("openlibrary"),
          googlebooksEnabled: !disabledProviders.has("googlebooks"),
          disabledProviders: disabledProvidersList,
          providers: KNOWN_EXTERNAL_LOOKUP_PROVIDERS.map((provider) =>
            buildProviderConfigState({ provider, disabledProviders })
          ),
          coverReviewGuardrailEnabled: nextCoverReviewGuardrailEnabled,
          note: nextNote,
          updatedByUid: nextUpdatedByUid,
          updatedAtMs: Date.now(),
        },
  };
  externalLookupProviderConfigInFlight = null;
  clearExternalLookupResultCaches();
  return externalLookupProviderConfigCache.value;
}

function defaultLibraryRolloutConfig(): LibraryRolloutConfig {
  return {
    phase: LIBRARY_DEFAULT_ROLLOUT_PHASE,
    updatedAtMs: 0,
    updatedByUid: null,
    note: null,
  };
}

function toLibraryRolloutConfig(row: Record<string, unknown> | null | undefined): LibraryRolloutConfig {
  const phase = normalizeLibraryRolloutPhase(row?.phase) ?? LIBRARY_DEFAULT_ROLLOUT_PHASE;
  return {
    phase,
    updatedAtMs: Math.max(0, tsToMs(row?.updatedAt), tsToMs(row?.createdAt)),
    updatedByUid: textOrNull(row?.updatedByUid),
    note: textOrNull(row?.note),
  };
}

export async function getLibraryRolloutConfig(): Promise<LibraryRolloutConfig> {
  const nowMs = Date.now();
  if (libraryRolloutConfigCache && libraryRolloutConfigCache.expiresAtMs > nowMs) {
    return libraryRolloutConfigCache.value;
  }
  if (libraryRolloutConfigInFlight) return libraryRolloutConfigInFlight;

  libraryRolloutConfigInFlight = (async () => {
    try {
      const snap = await libraryRolloutConfigDoc().get();
      const row = snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null;
      const config = toLibraryRolloutConfig(row);
      libraryRolloutConfigCache = {
        expiresAtMs: Date.now() + LIBRARY_ROLLOUT_CONFIG_CACHE_TTL_MS,
        value: config,
      };
      return config;
    } catch (error) {
      logger.warn("Library rollout config fallback to defaults", {
        message: error instanceof Error ? error.message : String(error),
      });
      const fallback = defaultLibraryRolloutConfig();
      libraryRolloutConfigCache = {
        expiresAtMs: Date.now() + LIBRARY_ROLLOUT_CONFIG_CACHE_TTL_MS,
        value: fallback,
      };
      return fallback;
    } finally {
      libraryRolloutConfigInFlight = null;
    }
  })();

  return libraryRolloutConfigInFlight;
}

export async function setLibraryRolloutConfig(input: {
  phase: LibraryRolloutPhase;
  note?: string | null;
  updatedByUid?: string | null;
}): Promise<LibraryRolloutConfig> {
  const current = await getLibraryRolloutConfig();
  const nextPhase = normalizeLibraryRolloutPhase(input.phase) ?? current.phase;
  const hasNotePatch = Object.prototype.hasOwnProperty.call(input, "note");
  const nextNote = hasNotePatch ? textOrNull(input.note) : current.note ?? null;
  const nextUpdatedByUid = textOrNull(input.updatedByUid) ?? null;

  const now = nowTs();
  await libraryRolloutConfigDoc().set(
    {
      phase: nextPhase,
      note: nextNote,
      updatedByUid: nextUpdatedByUid,
      updatedAt: now,
      createdAt: now,
    },
    { merge: true }
  );

  libraryRolloutConfigCache = {
    expiresAtMs: Date.now() + LIBRARY_ROLLOUT_CONFIG_CACHE_TTL_MS,
    value: {
      phase: nextPhase,
      note: nextNote,
      updatedByUid: nextUpdatedByUid,
      updatedAtMs: Date.now(),
    },
  };
  libraryRolloutConfigInFlight = null;
  return libraryRolloutConfigCache.value;
}

function pruneExternalLookupCache(nowMs: number): void {
  for (const [key, entry] of externalLookupCache.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      externalLookupCache.delete(key);
    }
  }
  while (externalLookupCache.size > LIBRARY_EXTERNAL_LOOKUP_CACHE_MAX_ENTRIES) {
    const oldest = externalLookupCache.keys().next();
    if (oldest.done) break;
    externalLookupCache.delete(oldest.value);
  }
}

function readExternalLookupCache(key: string): LibraryExternalLookupResult | null {
  const nowMs = Date.now();
  pruneExternalLookupCache(nowMs);
  const cached = externalLookupCache.get(key);
  if (!cached) return null;
  if (cached.expiresAtMs <= nowMs) {
    externalLookupCache.delete(key);
    return null;
  }
  return {
    ...cached.value,
    cacheHit: true,
    providers: cached.value.providers.map((provider) => ({
      ...provider,
      cached: true,
    })),
  };
}

function writeExternalLookupCache(key: string, value: LibraryExternalLookupResult): void {
  const normalized: LibraryExternalLookupResult = {
    ...value,
    cacheHit: false,
    providers: value.providers.map((provider) => ({
      ...provider,
      cached: false,
    })),
  };
  externalLookupCache.set(key, {
    expiresAtMs: Date.now() + LIBRARY_EXTERNAL_LOOKUP_CACHE_TTL_MS,
    value: normalized,
  });
  pruneExternalLookupCache(Date.now());
}

function firstIsbnWithLength(value: unknown, length: 10 | 13): string | null {
  const candidates = asStringArray(value);
  for (const candidate of candidates) {
    const cleaned = cleanIsbn(candidate);
    if (cleaned.length === length) {
      if ((length === 10 && isValidIsbn10(cleaned)) || (length === 13 && isValidIsbn13(cleaned))) {
        return cleaned;
      }
    }
  }
  return null;
}

function normalizeLookupMatchToken(value: unknown): string {
  return safeString(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function inferLibraryMediaType(...values: Array<unknown>): string | null {
  const haystack = values.map((entry) => normalizeLookupMatchToken(entry)).filter(Boolean).join(" ");
  if (!haystack) return null;
  if (/(tabletop rpg|role playing game|roleplaying game|dungeons dragons|pathfinder)/.test(haystack)) {
    return "tabletop_rpg";
  }
  if (/(board game|card game|tabletop game)/.test(haystack)) {
    return "board_game";
  }
  if (/(video game|computer game|console game)/.test(haystack)) {
    return "video_game";
  }
  if (/(comic|graphic novel|manga)/.test(haystack)) {
    return "comic";
  }
  return "book";
}

function librarySourceLabel(provider: ProviderName): string {
  return getProviderDefinition(provider).label;
}

function maybeJoinSummaryParts(values: Array<unknown>): string | null {
  const text = values
    .map((entry) => normalizeSummarySourceText(entry))
    .filter((entry): entry is string => Boolean(entry))
    .join(" ")
    .trim();
  return text || null;
}

function chooseLargestImageUrl(value: unknown): string | null {
  const urls = asStringArray(value)
    .map((entry) => normalizeProviderAssetUrl(entry))
    .filter((entry): entry is string => Boolean(entry));
  return urls[urls.length - 1] ?? urls[0] ?? null;
}

function dedupeExternalLookupItems(
  items: LibraryExternalLookupItem[],
  limit: number
): LibraryExternalLookupItem[] {
  const deduped: LibraryExternalLookupItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const isbnKey = cleanIsbn(item.identifiers.isbn13 ?? item.identifiers.isbn10 ?? "");
    const titleKey = safeString(item.title).trim().toLowerCase();
    const authorKey = safeString(item.authors[0]).trim().toLowerCase();
    const key = isbnKey ? `isbn:${isbnKey}` : `${titleKey}::${authorKey}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

function interleaveExternalLookupItems(
  lists: LibraryExternalLookupItem[][],
  limit: number
): LibraryExternalLookupItem[] {
  const merged: LibraryExternalLookupItem[] = [];
  const max = Math.max(...lists.map((entry) => entry.length), 0);
  for (let i = 0; i < max; i += 1) {
    for (const list of lists) {
      if (list[i]) merged.push(list[i]);
    }
    if (merged.length >= limit * 4) break;
  }
  return dedupeExternalLookupItems(merged, limit);
}

async function fetchOpenLibrarySearch(query: string, limit: number): Promise<LibraryExternalLookupItem[] | null> {
  const providerLimit = Math.max(1, Math.min(20, limit * 2));
  const url =
    "https://openlibrary.org/search.json" +
    `?q=${encodeURIComponent(query)}` +
    `&limit=${providerLimit}` +
    "&fields=key,title,subtitle,author_name,first_publish_year,publisher,isbn,cover_i";
  const data = await fetchJsonWithProviderPolicy({ provider: "openlibrary", url });
  if (!data) return null;

  const docs = asUnknownArray(data.docs);
  const out: LibraryExternalLookupItem[] = [];
  for (const doc of docs) {
    if (!asRecord(doc)) continue;
    const row = doc as Record<string, unknown>;
    const title = textOrNull(row.title);
    if (!title) continue;
    const authorNames = asStringArray(row.author_name);
    const publisher = firstString(row.publisher);
    const year = typeof row.first_publish_year === "number" ? Math.trunc(row.first_publish_year) : null;
    const isbn10 = firstIsbnWithLength(row.isbn, 10);
    const isbn13 = firstIsbnWithLength(row.isbn, 13);
    const key = textOrNull(row.key);
    const coverId = typeof row.cover_i === "number" && Number.isFinite(row.cover_i) ? Math.trunc(row.cover_i) : null;

    out.push({
      title,
      subtitle: textOrNull(row.subtitle),
      authors: authorNames,
      description: null,
      publisher,
      publishedDate: year && year > 0 ? String(year) : null,
      coverUrl: coverId ? normalizeProviderAssetUrl(`https://covers.openlibrary.org/b/id/${coverId}-M.jpg`) : null,
      format: "book",
      mediaType: inferLibraryMediaType(title, row.subtitle),
      summary: null,
      source: "openlibrary",
      sourceLabel: librarySourceLabel("openlibrary"),
      sourceId: key,
      sourceUrl: key ? `https://openlibrary.org${key}` : null,
      publicLibraryUrl: key ? `https://openlibrary.org${key}` : null,
      identifiers: {
        isbn10,
        isbn13,
        olid: null,
        googleVolumeId: null,
      },
    });

    if (out.length >= providerLimit) break;
  }
  return out;
}

async function fetchGoogleBooksSearch(query: string, limit: number): Promise<LibraryExternalLookupItem[] | null> {
  const providerLimit = Math.max(1, Math.min(20, limit * 2));
  const url =
    "https://www.googleapis.com/books/v1/volumes" +
    `?q=${encodeURIComponent(query)}` +
    `&maxResults=${providerLimit}` +
    "&printType=books" +
    "&fields=items(id,volumeInfo(title,subtitle,authors,description,publisher,publishedDate,pageCount,printType,imageLinks,industryIdentifiers,infoLink))";
  const data = await fetchJsonWithProviderPolicy({ provider: "googlebooks", url });
  if (!data) return null;

  const items = asUnknownArray(data.items);
  const out: LibraryExternalLookupItem[] = [];
  for (const item of items) {
    if (!asRecord(item)) continue;
    const row = item as Record<string, unknown>;
    const info = asRecord(row.volumeInfo) ? (row.volumeInfo as Record<string, unknown>) : null;
    if (!info) continue;
    const title = textOrNull(info.title);
    if (!title) continue;

    const imageLinks = asRecord(info.imageLinks) ? (info.imageLinks as Record<string, unknown>) : {};
    const identifiers = asUnknownArray(info.industryIdentifiers);
    const isbn10 = cleanIsbn(getIndustryIdentifier(identifiers, "ISBN_10") ?? "") || null;
    const isbn13 = cleanIsbn(getIndustryIdentifier(identifiers, "ISBN_13") ?? "") || null;
    out.push({
      title,
      subtitle: textOrNull(info.subtitle),
      authors: asStringArray(info.authors),
      description: textOrNull(info.description),
      publisher: textOrNull(info.publisher),
      publishedDate: textOrNull(info.publishedDate),
      coverUrl: selectBestImageLink({
        provider: "googlebooks",
        imageLinks,
        order: ["extraLarge", "large", "medium", "small", "smallThumbnail", "thumbnail"],
      }),
      format: textOrNull(info.printType) || "book",
      mediaType: inferLibraryMediaType(info.categories, info.title, info.subtitle),
      summary: deriveLibraryItemSummary(info.description),
      source: "googlebooks",
      sourceLabel: librarySourceLabel("googlebooks"),
      sourceId: textOrNull(row.id),
      sourceUrl: textOrNull(info.infoLink),
      publicLibraryUrl: textOrNull(info.infoLink),
      identifiers: {
        isbn10,
        isbn13,
        olid: null,
        googleVolumeId: textOrNull(row.id),
      },
    });
    if (out.length >= providerLimit) break;
  }
  return out;
}

async function fetchLocSearch(query: string, limit: number): Promise<LibraryExternalLookupItem[] | null> {
  const providerLimit = Math.max(1, Math.min(20, limit * 2));
  const url =
    "https://www.loc.gov/books/" +
    `?fo=json&q=${encodeURIComponent(query)}` +
    `&sp=1&c=${providerLimit}`;
  const data = await fetchJsonWithProviderPolicy({ provider: "loc", url });
  if (!data) return null;

  const rows = asUnknownArray(data.results);
  const out: LibraryExternalLookupItem[] = [];
  for (const entry of rows) {
    if (!asRecord(entry)) continue;
    const row = entry as Record<string, unknown>;
    const title = textOrNull(row.title);
    if (!title) continue;
    const description = maybeJoinSummaryParts(asUnknownArray(row.description));
    const sourceUrl = normalizeProviderAssetUrl(row.url) || normalizeProviderAssetUrl(row.id);
    out.push({
      title,
      subtitle: null,
      authors: asStringArray(row.contributor),
      description,
      publisher: null,
      publishedDate: textOrNull(row.date),
      coverUrl: chooseLargestImageUrl(row.image_url),
      format: firstString(row.original_format) ?? "book",
      mediaType: inferLibraryMediaType(row.subject, row.original_format, title, description),
      summary: deriveLibraryItemSummary(description),
      source: "loc",
      sourceLabel: librarySourceLabel("loc"),
      sourceId: textOrNull(row.number_lccn) ?? textOrNull(row.id),
      sourceUrl,
      publicLibraryUrl: sourceUrl,
      identifiers: {
        isbn10: null,
        isbn13: null,
        olid: null,
        googleVolumeId: null,
      },
    });
    if (out.length >= providerLimit) break;
  }
  return out;
}

function wikimediaFileUrl(filename: string | null): string | null {
  if (!filename) return null;
  return normalizeProviderAssetUrl(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=640`);
}

function readWikidataClaims(entity: Record<string, unknown>, property: string): Record<string, unknown>[] {
  const claims = asRecord(entity.claims) ? (entity.claims as Record<string, unknown>) : {};
  return asUnknownArray(claims[property]).filter((entry): entry is Record<string, unknown> => asRecord(entry));
}

function readWikidataEntityIds(entity: Record<string, unknown>, property: string): string[] {
  return readWikidataClaims(entity, property)
    .map((claim) => {
      const mainsnak = asRecord(claim.mainsnak) ? (claim.mainsnak as Record<string, unknown>) : {};
      const datavalue = asRecord(mainsnak.datavalue) ? (mainsnak.datavalue as Record<string, unknown>) : {};
      const value = asRecord(datavalue.value) ? (datavalue.value as Record<string, unknown>) : {};
      return textOrNull(value.id);
    })
    .filter((entry): entry is string => Boolean(entry));
}

function readWikidataStringValue(entity: Record<string, unknown>, property: string): string | null {
  for (const claim of readWikidataClaims(entity, property)) {
    const mainsnak = asRecord(claim.mainsnak) ? (claim.mainsnak as Record<string, unknown>) : {};
    const datavalue = asRecord(mainsnak.datavalue) ? (mainsnak.datavalue as Record<string, unknown>) : {};
    const value = datavalue.value;
    if (typeof value === "string") return value;
    if (asRecord(value) && typeof value.text === "string") return safeString(value.text);
  }
  return null;
}

function readWikidataTimeValue(entity: Record<string, unknown>, property: string): string | null {
  for (const claim of readWikidataClaims(entity, property)) {
    const mainsnak = asRecord(claim.mainsnak) ? (claim.mainsnak as Record<string, unknown>) : {};
    const datavalue = asRecord(mainsnak.datavalue) ? (mainsnak.datavalue as Record<string, unknown>) : {};
    const value = asRecord(datavalue.value) ? (datavalue.value as Record<string, unknown>) : {};
    const time = textOrNull(value.time);
    if (!time) continue;
    return time.replace(/^\+/, "").slice(0, 10).replace(/-00/g, "");
  }
  return null;
}

async function fetchWikidataEntities(ids: string[]): Promise<Record<string, unknown> | null> {
  const normalizedIds = Array.from(new Set(ids.map((entry) => entry.trim()).filter(Boolean))).slice(0, 20);
  if (normalizedIds.length === 0) return {};
  const url =
    "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&languages=en&props=labels%7Cdescriptions%7Cclaims" +
    `&ids=${encodeURIComponent(normalizedIds.join("|"))}`;
  const data = await fetchJsonWithProviderPolicy({ provider: "wikidata", url });
  if (!data) return null;
  return asRecord(data.entities) ? (data.entities as Record<string, unknown>) : {};
}

function readWikidataLabel(entity: Record<string, unknown> | null | undefined): string | null {
  const labels = asRecord(entity?.labels) ? (entity?.labels as Record<string, unknown>) : {};
  const en = asRecord(labels.en) ? (labels.en as Record<string, unknown>) : {};
  return textOrNull(en.value);
}

function readWikidataDescription(entity: Record<string, unknown> | null | undefined): string | null {
  const descriptions = asRecord(entity?.descriptions) ? (entity?.descriptions as Record<string, unknown>) : {};
  const en = asRecord(descriptions.en) ? (descriptions.en as Record<string, unknown>) : {};
  return textOrNull(en.value);
}

async function fetchWikidataSearch(query: string, limit: number): Promise<LibraryExternalLookupItem[] | null> {
  const providerLimit = Math.max(1, Math.min(20, limit * 2));
  const url =
    "https://www.wikidata.org/w/api.php?action=wbsearchentities&language=en&format=json&type=item" +
    `&limit=${providerLimit}&search=${encodeURIComponent(query)}`;
  const data = await fetchJsonWithProviderPolicy({ provider: "wikidata", url });
  if (!data) return null;

  const matches = asUnknownArray(data.search).filter((entry): entry is Record<string, unknown> => asRecord(entry));
  const ids = matches
    .map((entry) => textOrNull(entry.id))
    .filter((entry): entry is string => Boolean(entry));
  const entities = await fetchWikidataEntities(ids);
  if (entities === null) return null;

  const authorIds = new Set<string>();
  const publisherIds = new Set<string>();
  for (const id of ids) {
    const entity = asRecord(entities[id]) ? (entities[id] as Record<string, unknown>) : null;
    if (!entity) continue;
    for (const authorId of [
      ...readWikidataEntityIds(entity, "P50"),
      ...readWikidataEntityIds(entity, "P57"),
      ...readWikidataEntityIds(entity, "P170"),
      ...readWikidataEntityIds(entity, "P178"),
    ]) {
      authorIds.add(authorId);
    }
    for (const publisherId of readWikidataEntityIds(entity, "P123")) {
      publisherIds.add(publisherId);
    }
  }
  const relatedEntities = await fetchWikidataEntities([...authorIds, ...publisherIds]);

  const out: LibraryExternalLookupItem[] = [];
  for (const match of matches) {
    const id = textOrNull(match.id);
    if (!id) continue;
    const entity = asRecord(entities[id]) ? (entities[id] as Record<string, unknown>) : null;
    const label = readWikidataLabel(entity) ?? textOrNull(match.label);
    if (!label) continue;
    const description = readWikidataDescription(entity) ?? textOrNull(match.description);
    const authors = Array.from(new Set([
      ...readWikidataEntityIds(entity ?? {}, "P50"),
      ...readWikidataEntityIds(entity ?? {}, "P57"),
      ...readWikidataEntityIds(entity ?? {}, "P170"),
      ...readWikidataEntityIds(entity ?? {}, "P178"),
    ]))
      .map((entityId) => readWikidataLabel(asRecord(relatedEntities?.[entityId]) ? (relatedEntities?.[entityId] as Record<string, unknown>) : null))
      .filter((entry): entry is string => Boolean(entry));
    const publisherId = readWikidataEntityIds(entity ?? {}, "P123")[0] ?? null;
    const publisher = publisherId
      ? readWikidataLabel(asRecord(relatedEntities?.[publisherId]) ? (relatedEntities?.[publisherId] as Record<string, unknown>) : null)
      : null;
    const sourceUrl = textOrNull(match.url)?.startsWith("//")
      ? `https:${textOrNull(match.url)}`
      : textOrNull(match.url) ?? (id ? `https://www.wikidata.org/wiki/${id}` : null);
    out.push({
      title: label,
      subtitle: null,
      authors,
      description,
      publisher,
      publishedDate: readWikidataTimeValue(entity ?? {}, "P577") ?? readWikidataTimeValue(entity ?? {}, "P571"),
      coverUrl: wikimediaFileUrl(readWikidataStringValue(entity ?? {}, "P18")),
      format: inferLibraryMediaType(description, label) === "comic" ? "comic" : null,
      mediaType: inferLibraryMediaType(description, label),
      summary: deriveLibraryItemSummary(description),
      source: "wikidata",
      sourceLabel: librarySourceLabel("wikidata"),
      sourceId: id,
      sourceUrl,
      publicLibraryUrl: sourceUrl,
      identifiers: {
        isbn10: cleanIsbn(readWikidataStringValue(entity ?? {}, "P957") ?? "") || null,
        isbn13: cleanIsbn(readWikidataStringValue(entity ?? {}, "P212") ?? "") || null,
        olid: null,
        googleVolumeId: null,
      },
    });
    if (out.length >= providerLimit) break;
  }
  return out;
}

async function fetchProviderSearchResults(provider: ProviderName, query: string, limit: number): Promise<LibraryExternalLookupItem[] | null> {
  if (provider === "openlibrary") return fetchOpenLibrarySearch(query, limit);
  if (provider === "googlebooks") return fetchGoogleBooksSearch(query, limit);
  if (provider === "loc") return fetchLocSearch(query, limit);
  if (provider === "wikidata") return fetchWikidataSearch(query, limit);
  return [];
}

export async function lookupLibraryExternalSources(input: {
  q: string;
  limit?: number;
}): Promise<LibraryExternalLookupResult> {
  const q = normalizeExternalLookupQuery(input.q);
  const limit = normalizeExternalLookupLimit(input.limit);
  const providerConfig = await getLibraryExternalLookupProviderConfig();
  const disabledProviders = new Set<ProviderName>(providerConfig.disabledProviders);
  const providerStates = providerConfig.providers.length > 0
    ? providerConfig.providers
    : KNOWN_EXTERNAL_LOOKUP_PROVIDERS.map((provider) => buildProviderConfigState({ provider, disabledProviders }));
  if (!q) {
    return {
      q: "",
      limit,
      items: [],
      cacheHit: false,
      degraded: false,
      policyLimited: providerStates.some((entry) => !entry.enabled),
      providers: providerStates.map((entry) => ({
        ...entry,
        ok: false,
        itemCount: 0,
        cached: false,
        disabled: !entry.enabled,
      })),
    };
  }

  const key =
    `${externalLookupCacheKey(q, limit)}::providers:` +
    providerStates.map((entry) => `${entry.provider}:${entry.enabled ? "1" : "0"}`).join(",");
  const cached = readExternalLookupCache(key);
  if (cached) return cached;

  const inFlight = externalLookupInFlight.get(key);
  if (inFlight) return inFlight;

  const run = (async (): Promise<LibraryExternalLookupResult> => {
    const providerResponses = await Promise.all(
      providerStates.map(async (state) => {
        if (!state.enabled) {
          return {
            state,
            items: [] as LibraryExternalLookupItem[],
            failed: false,
          };
        }
        try {
          const items = await fetchProviderSearchResults(state.provider, q, limit);
          return {
            state,
            items: Array.isArray(items) ? items : [],
            failed: items === null,
          };
        } catch (error: unknown) {
          logger.warn("Library external lookup provider failed", {
            provider: state.provider,
            q,
            limit,
            message: error instanceof Error ? error.message : String(error),
          });
          return {
            state,
            items: [] as LibraryExternalLookupItem[],
            failed: true,
          };
        }
      })
    );

    const result: LibraryExternalLookupResult = {
      q,
      limit,
      items: interleaveExternalLookupItems(
        providerResponses.map((entry) => entry.items),
        limit
      ),
      cacheHit: false,
      degraded: providerResponses.some((entry) => entry.state.enabled && entry.failed),
      policyLimited: providerResponses.some((entry) => !entry.state.enabled),
      providers: providerResponses.map((entry) => ({
        ...entry.state,
        ok: entry.state.enabled && !entry.failed,
        itemCount: entry.items.length,
        cached: false,
        disabled: !entry.state.enabled,
      })),
    };
    writeExternalLookupCache(key, result);
    return result;
  })();

  externalLookupInFlight.set(key, run);
  try {
    return await run;
  } finally {
    externalLookupInFlight.delete(key);
  }
}

export async function findExistingLibraryItemIdByIsbn(params: {
  isbn10: string | null;
  isbn13: string | null;
  includeSoftDeleted?: boolean;
  excludeItemId?: string | null;
}): Promise<string | null> {
  const includeSoftDeleted = params.includeSoftDeleted !== false;
  const excludeItemId = textOrNull(params.excludeItemId);
  const candidates = Array.from(
    new Set(
      [params.isbn10, params.isbn13]
        .map((value) => cleanIsbn(value ?? ""))
        .filter((value) => value.length > 0),
    ),
  );
  if (candidates.length === 0) return null;

  const queryFields = ["identifiers.isbn10", "identifiers.isbn13", "isbn10", "isbn13", "isbn", "isbn_normalized"];
  for (const isbn of candidates) {
    for (const field of queryFields) {
      const snap = await db.collection("libraryItems").where(field, "==", isbn).limit(25).get();
      for (const match of snap.docs) {
        if (excludeItemId && match.id === excludeItemId) continue;
        if (includeSoftDeleted) return match.id;
        const row = (match.data() ?? {}) as Record<string, unknown>;
        if (!isSoftDeletedRow(row)) {
          return match.id;
        }
      }
    }
  }
  return null;
}

async function upsertManualPassLibraryItem(input: {
  normalized: { primary: string; isbn10: string | null; isbn13: string | null };
  source: string;
}): Promise<string> {
  const targetItemId =
    (await findExistingLibraryItemIdByIsbn({
      isbn10: input.normalized.isbn10,
      isbn13: input.normalized.isbn13,
    })) ?? `isbn-${input.normalized.primary}`;
  const now = nowTs();
  const docRef = db.collection("libraryItems").doc(targetItemId);
  const existingSnap = await docRef.get();
  const existingRow = existingSnap.exists ? ((existingSnap.data() ?? {}) as Record<string, unknown>) : {};
  const title = maybeText(existingRow.title) ?? `ISBN ${input.normalized.primary}`;
  const authors = normalizeUniqueStrings(maybeStringArray(existingRow.authors));
  const subjects = normalizeUniqueStrings(maybeStringArray(existingRow.subjects));
  await docRef.set(
    {
      title,
      subtitle: maybeText(existingRow.subtitle),
      authors,
      summary: deriveLibraryItemSummary(existingRow.description) ?? maybeText(existingRow.summary),
      description: maybeText(existingRow.description),
      publisher: maybeText(existingRow.publisher),
      publishedDate: maybeText(existingRow.publishedDate),
      pageCount: normalizeNumberField(existingRow.pageCount),
      subjects,
      coverUrl: maybeText(existingRow.coverUrl),
      format: maybeText(existingRow.format),
      mediaType: maybeText(existingRow.mediaType) ?? "book",
      isbn: input.normalized.primary,
      isbn10: input.normalized.isbn10,
      isbn13: input.normalized.isbn13,
      isbn_normalized: input.normalized.primary,
      identifiers: {
        isbn10: input.normalized.isbn10,
        isbn13: input.normalized.isbn13,
        olid: maybeText(asRecord(existingRow.identifiers) ? (existingRow.identifiers as Record<string, unknown>).olid : null),
        googleVolumeId: maybeText(asRecord(existingRow.identifiers) ? (existingRow.identifiers as Record<string, unknown>).googleVolumeId : null),
      },
      source: "manual",
      metadataSource: input.source,
      searchTokens: buildSearchTokens([title, input.normalized.primary, input.normalized.isbn10, input.normalized.isbn13]),
      status: maybeText(existingRow.status) ?? "available",
      totalCopies: Math.max(1, normalizeNumberField(existingRow.totalCopies) ?? 1),
      availableCopies: Math.max(0, normalizeNumberField(existingRow.availableCopies) ?? 1),
      coverQualityStatus: maybeText(existingRow.coverQualityStatus) ?? "missing",
      needsCoverReview: existingRow.needsCoverReview === true || !maybeText(existingRow.coverUrl),
      coverQualityReason: maybeText(existingRow.coverQualityReason) ?? "missing_cover",
      coverQualityValidatedAt: existingRow.coverQualityValidatedAt ?? now,
      metadataEnrichmentPending: false,
      metadataEnrichmentStatus: "manual_finish_required",
      metadataEnrichmentReason: "manual_run",
      metadataEnrichmentLastAttemptAt: now,
      manualPassRequired: true,
      manualPassRequiredAt: now,
      catalogVisibility: "manual_only",
      updatedAt: now,
      ...(existingSnap.exists ? {} : { createdAt: now }),
    },
    { merge: true }
  );
  return targetItemId;
}

export async function importLibraryIsbnBatch(input: ImportRequest): Promise<ImportLibraryIsbnsResult> {
  const isbns = Array.isArray(input.isbns) ? input.isbns : [];
  const source = typeof input.source === "string" ? input.source : "csv";
  const cleaned = isbns.map((isbn) => cleanIsbn(String(isbn))).filter(Boolean);
  const deduped = Array.from(new Set(cleaned));
  if (deduped.length === 0) {
    throw new Error("Provide at least one ISBN");
  }

  const capped = deduped.slice(0, 200);
  const providerConfig = await getLibraryExternalLookupProviderConfig();
  const coverReviewGuardrailEnabled = providerConfig.coverReviewGuardrailEnabled !== false;
  const created: string[] = [];
  const updated: string[] = [];
  const manualPassRequired: ImportLibraryIsbnsResult["manualPassRequired"] = [];
  const rejected: ImportLibraryIsbnsResult["rejected"] = [];
  const errors: Array<{ isbn: string; message: string }> = [];

  for (const rawIsbn of capped) {
    try {
      const normalized = normalizeValidIsbn(rawIsbn);
      if (!normalized) {
        rejected.push({
          isbn: rawIsbn,
          reason: rawIsbn.length === 10 || rawIsbn.length === 13 ? "invalid_isbn" : "malformed_identifier",
          message:
            rawIsbn.length === 10 || rawIsbn.length === 13
              ? "ISBN check digit failed. No public item was created."
              : "Identifier was not a valid ISBN-10 or ISBN-13. No public item was created.",
        });
        continue;
      }
      const existingItemId = await findExistingLibraryItemIdByIsbn({
        isbn10: normalized.isbn10,
        isbn13: normalized.isbn13,
      });
      if (existingItemId) {
        const existingSnap = await db.collection("libraryItems").doc(existingItemId).get();
        if (existingSnap.exists) {
          const existingRow = (existingSnap.data() ?? {}) as Record<string, unknown>;
          const existingTitle = maybeText(existingRow.title);
          const existingAuthors = normalizeUniqueStrings(maybeStringArray(existingRow.authors));
          if (existingTitle && !titleLooksPlaceholder(existingTitle) && existingAuthors.length > 0 && !rowRequiresManualFinish(existingRow)) {
            await db.collection("libraryItems").doc(existingItemId).set(
              {
                metadataSource: source,
                updatedAt: nowTs(),
              },
              { merge: true }
            );
            updated.push(existingItemId);
            continue;
          }
        }
      }
      const itemId = `isbn-${normalized.primary}`;
      let lookup: LookupResult | null = null;
      try {
        lookup = await lookupIsbn(normalized.primary, {
          allowManualFallback: false,
        });
      } catch {
        lookup = null;
      }
      if (!lookup) {
        const manualItemId = await upsertManualPassLibraryItem({
          normalized,
          source,
        });
        manualPassRequired.push({
          isbn: normalized.primary,
          itemId: manualItemId,
          reason: "unresolved_isbn",
          message: "No provider could resolve this ISBN. The item was queued for manual pass and kept out of member browse.",
        });
        continue;
      }
      const resolvedIsbn10 = cleanIsbn(lookup.identifiers.isbn10 ?? normalized.isbn10 ?? "") || null;
      const resolvedIsbn13 = cleanIsbn(lookup.identifiers.isbn13 ?? normalized.isbn13 ?? "") || null;
      const duplicateDocId = await findExistingLibraryItemIdByIsbn({
        isbn10: resolvedIsbn10,
        isbn13: resolvedIsbn13,
      });
      const targetItemId = duplicateDocId || itemId;
      const searchTokens = buildSearchTokens([
        lookup.title,
        lookup.subtitle,
        ...(lookup.authors ?? []),
        ...(lookup.subjects ?? []),
      ]);
      const evaluatedCoverQuality = evaluateCoverQuality(lookup.coverUrl, {
        mediaType: "book",
        format: lookup.format,
        source: lookup.source,
        googleVolumeId: lookup.identifiers.googleVolumeId,
      });
      const coverQuality = applyCoverReviewGuardrailPolicy({
        evaluated: evaluatedCoverQuality,
        coverUrl: lookup.coverUrl,
        guardrailEnabled: coverReviewGuardrailEnabled,
      });
      const derivedSummary = deriveLibraryItemSummary(lookup.description);

      const docRef = db.collection("libraryItems").doc(targetItemId);
      const snap = await docRef.get();
      const now = nowTs();
      const baseDoc = {
        title: lookup.title,
        subtitle: lookup.subtitle ?? null,
        authors: lookup.authors ?? [],
        summary: derivedSummary,
        description: lookup.description ?? null,
        publisher: lookup.publisher ?? null,
        publishedDate: lookup.publishedDate ?? null,
        pageCount: lookup.pageCount ?? null,
        subjects: lookup.subjects ?? [],
        coverUrl: lookup.coverUrl ?? null,
        format: lookup.format ?? null,
        mediaType: "book",
        isbn: normalized.primary || null,
        isbn10: resolvedIsbn10,
        isbn13: resolvedIsbn13,
        isbn_normalized: normalized.primary || null,
        identifiers: {
          isbn10: resolvedIsbn10,
          isbn13: resolvedIsbn13,
          olid: lookup.identifiers.olid ?? null,
          googleVolumeId: lookup.identifiers.googleVolumeId ?? null,
        },
        source: lookup.source,
        searchTokens,
        metadataSource: source,
        catalogVisibility: "public",
        manualPassRequired: false,
        manualPassRequiredAt: null,
        updatedAt: now,
        metadataSnapshot: lookup.raw ?? null,
        coverQualityStatus: coverQuality.status,
        needsCoverReview: coverQuality.needsReview,
        coverQualityReason: coverQuality.reason,
        coverQualityValidatedAt: now,
        ...(buildMetadataQueuePatch({
          row: {
            title: lookup.title,
            subtitle: lookup.subtitle ?? null,
            authors: lookup.authors ?? [],
            summary: derivedSummary,
            description: lookup.description ?? null,
            publisher: lookup.publisher ?? null,
            publishedDate: lookup.publishedDate ?? null,
            pageCount: lookup.pageCount ?? null,
            subjects: lookup.subjects ?? [],
            coverUrl: lookup.coverUrl ?? null,
            format: lookup.format ?? null,
            mediaType: "book",
            isbn: normalized.primary || null,
            isbn10: resolvedIsbn10,
            isbn13: resolvedIsbn13,
            isbn_normalized: normalized.primary || null,
            source: lookup.source,
            coverQualityStatus: coverQuality.status,
          },
          reason: "recent_import",
          now,
        }) ?? {}),
      };

      if (!snap.exists) {
        await docRef.set({
          ...baseDoc,
          totalCopies: 1,
          availableCopies: 1,
          status: "available",
          createdAt: now,
        });
        created.push(targetItemId);
      } else {
        await docRef.set(baseDoc, { merge: true });
        updated.push(targetItemId);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : safeString(error);
      errors.push({ isbn: rawIsbn, message: message || "Import failed" });
    }
  }

  return {
    requested: capped.length,
    created: created.length,
    updated: updated.length,
    manualPassRequired,
    rejected,
    errors,
  };
}

type LibraryMetadataRefreshResult = {
  scanned: number;
  attempted: number;
  refreshed: number;
  skipped: number;
  errors: number;
  flaggedForReview: number;
};

function isSoftDeletedRow(row: Record<string, unknown>): boolean {
  if (row.deleted === true || row.isDeleted === true || row.softDeleted === true) return true;
  if (tsToMs(row.deletedAt) > 0 || tsToMs(row.softDeletedAt) > 0) return true;
  return false;
}

function normalizeIsbnFromRow(row: Record<string, unknown>): string {
  return cleanIsbn(
    safeString(row.isbn_normalized) ||
      safeString(row.isbn13) ||
      safeString(row.isbn10) ||
      safeString(row.isbn)
  );
}

function readValidIsbnFromRow(row: Record<string, unknown>): string | null {
  return normalizeValidIsbn(normalizeIsbnFromRow(row))?.primary ?? null;
}

function maybeText(value: unknown): string | null {
  const text = textOrNull(value);
  return text && text.trim().length > 0 ? text : null;
}

function maybeStringArray(value: unknown): string[] {
  return asStringArray(value).filter((entry) => entry.trim().length > 0);
}

function normalizeMetadataLockField(value: string): LibraryMetadataLockField | null {
  if ((LIBRARY_METADATA_LOCK_FIELDS as readonly string[]).includes(value)) {
    return value as LibraryMetadataLockField;
  }
  return null;
}

export function readLibraryMetadataLocks(row: Record<string, unknown>): LibraryMetadataLocks {
  const raw = asRecord(row.metadataLocks) ? (row.metadataLocks as Record<string, unknown>) : {};
  const locks: LibraryMetadataLocks = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = normalizeMetadataLockField(key);
    if (!normalizedKey) continue;
    if (value === true) {
      locks[normalizedKey] = true;
    }
  }
  return locks;
}

function isLegacyManualMetadataRow(row: Record<string, unknown>, locks: LibraryMetadataLocks): boolean {
  if (safeString(row.source).trim().toLowerCase() !== "manual") return false;
  return Object.keys(locks).length === 0;
}

function isMetadataFieldLocked(
  row: Record<string, unknown>,
  field: LibraryMetadataLockField,
  locks = readLibraryMetadataLocks(row)
): boolean {
  return isLegacyManualMetadataRow(row, locks) || locks[field] === true;
}

function normalizeUniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );
}

function titleLooksPlaceholder(value: string | null): boolean {
  if (!value) return false;
  return /^isbn\s+[0-9x-]+$/i.test(value.trim());
}

function hasApprovedLibraryCover(row: Record<string, unknown>): boolean {
  const coverUrl = maybeText(row.coverUrl);
  return Boolean(coverUrl) && safeString(row.coverQualityStatus).trim().toLowerCase() === "approved" && row.needsCoverReview !== true;
}

function rowRequiresManualFinish(row: Record<string, unknown>): boolean {
  return safeString(row.catalogVisibility).trim().toLowerCase() === "manual_only" || row.manualPassRequired === true;
}

function descriptionLooksPlaceholder(value: string | null): boolean {
  if (!value) return false;
  return value.trim().toLowerCase() === "reference copy from local monsoon fire isbn catalog.";
}

function isBookLikeLibraryRow(row: Record<string, unknown>): boolean {
  const mediaSignal = normalizeCoverMediaSignal(row.mediaType ?? row.format);
  return mediaSignal === "book" || mediaSignal === "unknown";
}

type ThinMetadataAssessment = {
  thin: boolean;
  reasons: string[];
};

export function assessLibraryThinMetadata(row: Record<string, unknown>): ThinMetadataAssessment {
  const isbn = normalizeIsbnFromRow(row);
  if (!isbn) return { thin: false, reasons: [] };
  if (!isBookLikeLibraryRow(row)) return { thin: false, reasons: [] };

  const reasons: string[] = [];
  const title = maybeText(row.title);
  const summary = deriveLibraryItemSummary(row.summary);
  const description = maybeText(row.description);
  const authors = normalizeUniqueStrings(maybeStringArray(row.authors));
  const subjects = normalizeUniqueStrings(maybeStringArray(row.subjects));
  const publisher = maybeText(row.publisher);
  const publishedDate = maybeText(row.publishedDate);
  const pageCount = Number(row.pageCount);
  const coverUrl = maybeText(row.coverUrl);
  const coverApproved = coverUrl && safeString(row.coverQualityStatus).trim().toLowerCase() === "approved";
  const source = safeString(row.source).trim().toLowerCase();

  if (!title || titleLooksPlaceholder(title)) reasons.push("title_placeholder");
  if (authors.length === 0) reasons.push("authors_missing");
  if (!summary) reasons.push("summary_missing");
  if (!description) {
    reasons.push("description_missing");
  } else if (
    descriptionLooksPlaceholder(description) ||
    description.length < LIBRARY_METADATA_DESCRIPTION_THIN_LENGTH
  ) {
    reasons.push("description_thin");
  }
  if (!publisher) reasons.push("publisher_missing");
  if (!publishedDate) reasons.push("published_date_missing");
  if (!Number.isFinite(pageCount) || pageCount <= 0) reasons.push("page_count_missing");
  if (subjects.length === 0) reasons.push("subjects_missing");
  if (!coverApproved) reasons.push("cover_unapproved");
  if (source === "local_reference") reasons.push("local_reference_metadata");

  return {
    thin: reasons.length > 0,
    reasons,
  };
}

export function assessLibraryMetadataGaps(row: Record<string, unknown>): {
  gap: boolean;
  reasons: LibraryMetadataGapReason[];
} {
  const reasons: LibraryMetadataGapReason[] = [];
  const title = maybeText(row.title);
  const anyIdentifier = normalizeIsbnFromRow(row);
  const validIsbn = readValidIsbnFromRow(row);
  const description = maybeText(row.description);
  const summary = deriveLibraryItemSummary(row.summary) ?? deriveLibraryItemSummary(description);
  const authors = normalizeUniqueStrings(maybeStringArray(row.authors));
  const thin = assessLibraryThinMetadata(row).thin || safeString(row.detailStatus).trim().toLowerCase() === "sparse";

  if (!title || titleLooksPlaceholder(title)) reasons.push("placeholder_title");
  if (anyIdentifier && !validIsbn) reasons.push("malformed_identifier");
  if (!hasApprovedLibraryCover(row)) reasons.push("missing_cover");
  if (!summary || !description || descriptionLooksPlaceholder(description) || description.length < LIBRARY_METADATA_DESCRIPTION_THIN_LENGTH) {
    reasons.push("sparse_synopsis");
  }
  if (authors.length === 0) reasons.push("missing_creator");
  if (thin) reasons.push("thin_metadata");
  if (rowRequiresManualFinish(row)) reasons.push("manual_finish_required");

  return {
    gap: reasons.length > 0,
    reasons: Array.from(new Set(reasons)),
  };
}

function normalizeStringField(value: unknown): string | null {
  return maybeText(value);
}

function normalizeNumberField(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function sameStringValue(left: unknown, right: unknown): boolean {
  return normalizeStringField(left) === normalizeStringField(right);
}

function sameNumberValue(left: unknown, right: unknown): boolean {
  return normalizeNumberField(left) === normalizeNumberField(right);
}

function sameStringArrayValue(left: unknown, right: unknown): boolean {
  const leftValues = normalizeUniqueStrings(maybeStringArray(left)).join("\u0000");
  const rightValues = normalizeUniqueStrings(maybeStringArray(right)).join("\u0000");
  return leftValues === rightValues;
}

function shouldUseIncomingTitle(current: string | null, incoming: string | null): boolean {
  if (!incoming) return false;
  if (!current) return true;
  if (current === incoming) return false;
  return titleLooksPlaceholder(current);
}

function shouldUseIncomingTextField(current: string | null, incoming: string | null): boolean {
  if (!incoming) return false;
  if (!current) return true;
  return false;
}

function shouldUseIncomingPlaceholderField(current: string | null, incoming: string | null): boolean {
  if (!incoming) return false;
  if (!current) return true;
  if (current === incoming) return false;
  return titleLooksPlaceholder(current) || descriptionLooksPlaceholder(current);
}

function shouldUseIncomingDescription(current: string | null, incoming: string | null): boolean {
  if (!incoming) return false;
  if (!current) return true;
  if (current === incoming) return false;
  if (descriptionLooksPlaceholder(current)) return true;
  if (current.length < LIBRARY_METADATA_DESCRIPTION_THIN_LENGTH) {
    return incoming.length >= current.length + LIBRARY_METADATA_DESCRIPTION_REPLACE_DELTA;
  }
  return false;
}

function shouldUseIncomingSubjects(current: string[], incoming: string[]): boolean {
  const currentValues = normalizeUniqueStrings(current);
  const incomingValues = normalizeUniqueStrings(incoming);
  if (incomingValues.length === 0) return false;
  if (currentValues.length === 0) return true;
  return incomingValues.length > currentValues.length;
}

function evaluateCoverStatusForCandidate(input: {
  coverUrl: unknown;
  mediaType: unknown;
  format: unknown;
  source: unknown;
  googleVolumeId: unknown;
  guardrailEnabled: boolean;
}): { status: CoverQualityStatus; needsReview: boolean; reason: string | null } {
  const evaluatedCoverQuality = evaluateCoverQuality(input.coverUrl, {
    mediaType: input.mediaType,
    format: input.format,
    source: input.source,
    googleVolumeId: maybeText(input.googleVolumeId),
  });
  return applyCoverReviewGuardrailPolicy({
    evaluated: evaluatedCoverQuality,
    coverUrl: input.coverUrl,
    guardrailEnabled: input.guardrailEnabled,
  });
}

function selectPreferredEnrichmentCoverUrl(input: {
  row: Record<string, unknown>;
  lookup: LookupResult;
  nextFormat: string | null;
  guardrailEnabled: boolean;
}): string | null {
  const currentCover = maybeText(input.row.coverUrl);
  const incomingCover = maybeText(input.lookup.coverUrl);
  if (!incomingCover) return currentCover;
  if (!currentCover) return incomingCover;

  const existingIdentifiers = asRecord(input.row.identifiers) ? (input.row.identifiers as Record<string, unknown>) : {};
  const currentStatus = evaluateCoverStatusForCandidate({
    coverUrl: currentCover,
    mediaType: input.row.mediaType,
    format: input.row.format,
    source: input.row.source,
    googleVolumeId: maybeText(existingIdentifiers.googleVolumeId),
    guardrailEnabled: input.guardrailEnabled,
  });
  const incomingStatus = evaluateCoverStatusForCandidate({
    coverUrl: incomingCover,
    mediaType: input.row.mediaType,
    format: input.nextFormat ?? input.row.format,
    source: input.lookup.source || input.row.source,
    googleVolumeId: input.lookup.identifiers.googleVolumeId ?? maybeText(existingIdentifiers.googleVolumeId),
    guardrailEnabled: input.guardrailEnabled,
  });

  if (incomingStatus.status === "approved" && currentStatus.status !== "approved") {
    return incomingCover;
  }

  if (currentCover.includes("openlibrary.org") && incomingCover.includes("googleusercontent.com")) {
    return incomingStatus.status === "approved" ? incomingCover : currentCover;
  }

  return preferredCoverUrl(currentCover, incomingCover);
}

function buildMetadataQueuePatch(input: {
  row: Record<string, unknown>;
  reason: LibraryMetadataEnrichmentReason;
  now: ReturnType<typeof nowTs>;
}): Record<string, unknown> | null {
  if (!canAutoEnrichLibraryRow(input.row)) return null;
  return {
    metadataEnrichmentPending: true,
    metadataEnrichmentReason: input.reason,
    metadataEnrichmentQueuedAt: input.now,
    metadataEnrichmentStatus: "pending",
  };
}

type MetadataLookupMergeResult = {
  patch: Record<string, unknown>;
  changed: boolean;
  thinAfterMerge: boolean;
};

function mergeLookupIntoLibraryRow(input: {
  row: Record<string, unknown>;
  lookup: LookupResult;
  now: ReturnType<typeof nowTs>;
  source: "scheduled" | "manual";
  mode: "refresh" | "enrichment";
  guardrailEnabled: boolean;
}): MetadataLookupMergeResult {
  const locks = readLibraryMetadataLocks(input.row);
  const row = input.row;
  const patch: Record<string, unknown> = {
    metadataRefreshedAt: input.now,
    metadataRefreshSource: input.lookup.source,
    metadataRefreshMode: input.source,
    metadataSnapshot: input.lookup.raw ?? null,
  };
  let changed = false;

  const existingIdentifiers = asRecord(row.identifiers) ? (row.identifiers as Record<string, unknown>) : {};
  const incomingIsbn10 = cleanIsbn(input.lookup.identifiers.isbn10 ?? "") || null;
  const incomingIsbn13 = cleanIsbn(input.lookup.identifiers.isbn13 ?? "") || null;
  const nextFormat =
    (!isMetadataFieldLocked(row, "format", locks) && shouldUseIncomingPlaceholderField(maybeText(row.format), maybeText(input.lookup.format)))
      || (!isMetadataFieldLocked(row, "format", locks) && !hasMeaningfulText(row.format))
      ? maybeText(input.lookup.format)
      : maybeText(row.format);

  const assignStringField = (field: LibraryMetadataLockField, nextValue: string | null) => {
    if (nextValue == null) return;
    if (sameStringValue(row[field], nextValue)) return;
    patch[field] = nextValue;
    changed = true;
  };

  if (!isMetadataFieldLocked(row, "title", locks)) {
    const currentTitle = maybeText(row.title);
    const nextTitle = maybeText(input.lookup.title);
    if (shouldUseIncomingTitle(currentTitle, nextTitle)) {
      assignStringField("title", nextTitle);
    }
  }
  if (!isMetadataFieldLocked(row, "subtitle", locks)) {
    const currentSubtitle = maybeText(row.subtitle);
    const nextSubtitle = maybeText(input.lookup.subtitle);
    if (shouldUseIncomingTextField(currentSubtitle, nextSubtitle)) {
      assignStringField("subtitle", nextSubtitle);
    }
  }
  if (!isMetadataFieldLocked(row, "authors", locks)) {
    const currentAuthors = normalizeUniqueStrings(maybeStringArray(row.authors));
    const nextAuthors = normalizeUniqueStrings(maybeStringArray(input.lookup.authors));
    if (currentAuthors.length === 0 && nextAuthors.length > 0 && !sameStringArrayValue(row.authors, nextAuthors)) {
      patch.authors = nextAuthors;
      changed = true;
    }
  }
  if (!isMetadataFieldLocked(row, "summary", locks)) {
    const currentSummary = deriveLibraryItemSummary(row.summary);
    const descriptionAfterMerge =
      maybeText(patch.description) ??
      maybeText(row.description) ??
      maybeText(input.lookup.description);
    const nextSummary = deriveLibraryItemSummary(descriptionAfterMerge);
    const shouldApplySummary =
      input.mode === "enrichment"
        ? shouldUseIncomingDescription(currentSummary, nextSummary)
        : !currentSummary;
    if (shouldApplySummary && !sameStringValue(row.summary, nextSummary)) {
      patch.summary = nextSummary;
      changed = true;
    }
  }
  if (!isMetadataFieldLocked(row, "description", locks)) {
    const currentDescription = maybeText(row.description);
    const nextDescription = maybeText(input.lookup.description);
    const shouldApplyDescription =
      input.mode === "enrichment"
        ? shouldUseIncomingDescription(currentDescription, nextDescription)
        : !currentDescription || descriptionLooksPlaceholder(currentDescription);
    if (shouldApplyDescription) {
      assignStringField("description", nextDescription);
    }
  }
  if (!isMetadataFieldLocked(row, "publisher", locks)) {
    const currentPublisher = maybeText(row.publisher);
    const nextPublisher = maybeText(input.lookup.publisher);
    if (shouldUseIncomingPlaceholderField(currentPublisher, nextPublisher) || shouldUseIncomingTextField(currentPublisher, nextPublisher)) {
      assignStringField("publisher", nextPublisher);
    }
  }
  if (!isMetadataFieldLocked(row, "publishedDate", locks)) {
    const currentPublishedDate = maybeText(row.publishedDate);
    const nextPublishedDate = maybeText(input.lookup.publishedDate);
    if (
      shouldUseIncomingPlaceholderField(currentPublishedDate, nextPublishedDate) ||
      shouldUseIncomingTextField(currentPublishedDate, nextPublishedDate)
    ) {
      assignStringField("publishedDate", nextPublishedDate);
    }
  }
  if (!isMetadataFieldLocked(row, "pageCount", locks)) {
    const nextPageCount = normalizeNumberField(input.lookup.pageCount);
    if (nextPageCount && !sameNumberValue(row.pageCount, nextPageCount) && !normalizeNumberField(row.pageCount)) {
      patch.pageCount = nextPageCount;
      changed = true;
    }
  }
  if (!isMetadataFieldLocked(row, "subjects", locks)) {
    const currentSubjects = normalizeUniqueStrings(maybeStringArray(row.subjects));
    const nextSubjects = normalizeUniqueStrings(maybeStringArray(input.lookup.subjects));
    const shouldApplySubjects =
      input.mode === "enrichment"
        ? shouldUseIncomingSubjects(currentSubjects, nextSubjects)
        : currentSubjects.length === 0 && nextSubjects.length > 0;
    if (shouldApplySubjects && !sameStringArrayValue(currentSubjects, nextSubjects)) {
      patch.subjects = nextSubjects;
      changed = true;
    }
  }
  if (!isMetadataFieldLocked(row, "format", locks)) {
    const currentFormat = maybeText(row.format);
    const incomingFormat = maybeText(input.lookup.format);
    if (shouldUseIncomingPlaceholderField(currentFormat, incomingFormat) || shouldUseIncomingTextField(currentFormat, incomingFormat)) {
      assignStringField("format", incomingFormat);
    }
  }
  const currentMediaType = maybeText(row.mediaType);
  const nextMediaType = maybeText(input.lookup.mediaType);
  if (
    nextMediaType &&
    (!currentMediaType ||
      ["other", "media"].includes(normalizeLookupMatchToken(currentMediaType)) ||
      titleLooksPlaceholder(maybeText(row.title)))
  ) {
    if (!sameStringValue(row.mediaType, nextMediaType)) {
      patch.mediaType = nextMediaType;
      changed = true;
    }
  }
  if (!isMetadataFieldLocked(row, "coverUrl", locks)) {
    const nextCover = selectPreferredEnrichmentCoverUrl({
      row,
      lookup: input.lookup,
      nextFormat,
      guardrailEnabled: input.guardrailEnabled,
    });
    if (!sameStringValue(row.coverUrl, nextCover)) {
      patch.coverUrl = nextCover;
      changed = true;
    }
  }

  if (!hasMeaningfulText(row.isbn)) patch.isbn = normalizeIsbnFromRow(row);
  if ((!hasMeaningfulText(row.isbn10) || !hasMeaningfulText(existingIdentifiers.isbn10)) && incomingIsbn10) {
    patch.isbn10 = incomingIsbn10;
  }
  if ((!hasMeaningfulText(row.isbn13) || !hasMeaningfulText(existingIdentifiers.isbn13)) && incomingIsbn13) {
    patch.isbn13 = incomingIsbn13;
  }
  if (!hasMeaningfulText(row.isbn_normalized)) patch.isbn_normalized = normalizeIsbnFromRow(row);

  const nextIdentifiers = {
    isbn10: incomingIsbn10 ?? maybeText(existingIdentifiers.isbn10),
    isbn13: incomingIsbn13 ?? maybeText(existingIdentifiers.isbn13),
    olid: maybeText(input.lookup.identifiers.olid) ?? maybeText(existingIdentifiers.olid),
    googleVolumeId:
      maybeText(input.lookup.identifiers.googleVolumeId) ?? maybeText(existingIdentifiers.googleVolumeId),
  };
  const currentIdentifiers = {
    isbn10: maybeText(existingIdentifiers.isbn10),
    isbn13: maybeText(existingIdentifiers.isbn13),
    olid: maybeText(existingIdentifiers.olid),
    googleVolumeId: maybeText(existingIdentifiers.googleVolumeId),
  };
  if (JSON.stringify(nextIdentifiers) !== JSON.stringify(currentIdentifiers)) {
    patch.identifiers = nextIdentifiers;
    changed = true;
  }

  const mergedRow = {
    ...row,
    ...patch,
  };
  const finalCover = maybeText(mergedRow.coverUrl);
  const coverQuality = applyCoverReviewGuardrailPolicy({
    evaluated: evaluateCoverQuality(finalCover, {
      mediaType: mergedRow.mediaType,
      format: mergedRow.format,
      source: input.lookup.source || mergedRow.source,
      googleVolumeId: nextIdentifiers.googleVolumeId,
    }),
    coverUrl: finalCover,
    guardrailEnabled: input.guardrailEnabled,
  });
  patch.coverQualityStatus = coverQuality.status;
  patch.needsCoverReview = coverQuality.needsReview;
  patch.coverQualityReason = coverQuality.reason;
  patch.coverQualityValidatedAt = input.now;

  const nextSearchTokens = buildSearchTokens([
    maybeText((patch.title ?? row.title) as unknown),
    maybeText((patch.subtitle ?? row.subtitle) as unknown),
    ...maybeStringArray((patch.authors ?? row.authors) as unknown),
    ...maybeStringArray((patch.subjects ?? row.subjects) as unknown),
  ]);
  if (nextSearchTokens.length > 0) {
    patch.searchTokens = nextSearchTokens;
  }

  const nextRow = {
    ...row,
    ...patch,
  };
  const thinAfterMerge = assessLibraryThinMetadata(nextRow).thin;

  if (input.mode === "enrichment") {
    patch.metadataEnrichmentPending = false;
    patch.metadataEnrichmentQueuedAt = null;
    patch.metadataEnrichmentLastAttemptAt = input.now;
    patch.metadataEnrichmentReason = thinAfterMerge ? assessLibraryThinMetadata(nextRow).reasons[0] ?? null : null;
    patch.metadataEnrichmentStatus = changed ? "enriched" : "skipped";
    if (changed) {
      patch.metadataEnrichedAt = input.now;
    }
  }

  if (rowRequiresManualFinish(row)) {
    const nextTitle = maybeText((patch.title ?? row.title) as unknown);
    const nextAuthors = normalizeUniqueStrings(maybeStringArray((patch.authors ?? row.authors) as unknown));
    const stillNeedsManualFinish = !nextTitle || titleLooksPlaceholder(nextTitle) || nextAuthors.length === 0;
    patch.catalogVisibility = stillNeedsManualFinish ? "manual_only" : "public";
    patch.manualPassRequired = stillNeedsManualFinish;
    patch.manualPassRequiredAt = stillNeedsManualFinish ? (row.manualPassRequiredAt ?? input.now) : null;
  }

  return {
    patch,
    changed,
    thinAfterMerge,
  };
}

export async function refreshLibraryMetadataBatch(input?: {
  maxItems?: number;
  staleMs?: number;
  source?: "scheduled" | "manual";
  requestId?: string;
}): Promise<LibraryMetadataRefreshResult> {
  const maxItems = Math.max(1, Math.min(250, input?.maxItems ?? LIBRARY_METADATA_REFRESH_LIMIT));
  const staleMs = Math.max(60_000, input?.staleMs ?? LIBRARY_METADATA_REFRESH_STALE_MS);
  const refreshSource = input?.source ?? "scheduled";
  const requestId = textOrNull(input?.requestId);
  const scanLimit = Math.max(maxItems * 6, 180);
  const nowMs = Date.now();
  const providerConfig = await getLibraryExternalLookupProviderConfig();
  const coverReviewGuardrailEnabled = providerConfig.coverReviewGuardrailEnabled !== false;

  let itemsSnap = await db.collection("libraryItems").orderBy("updatedAt", "asc").limit(scanLimit).get();
  if (itemsSnap.empty) {
    itemsSnap = await db.collection("libraryItems").limit(scanLimit).get();
  }

  const candidates: Array<{ id: string; row: Record<string, unknown> }> = [];
  let scanned = 0;
  for (const docSnap of itemsSnap.docs) {
    const row = (docSnap.data() ?? {}) as Record<string, unknown>;
    scanned += 1;
    if (isSoftDeletedRow(row)) continue;

    if (!canAutoEnrichLibraryRow(row)) continue;

    const lastRefreshMs = Math.max(
      tsToMs(row.metadataRefreshedAt),
      tsToMs(row.metadataSyncedAt),
      tsToMs(row.updatedAt),
      tsToMs(row.createdAt)
    );
    const missingCover = !hasMeaningfulText(row.coverUrl);
    const stale = lastRefreshMs <= 0 || nowMs - lastRefreshMs >= staleMs;
    if (!missingCover && !stale) continue;

    candidates.push({ id: docSnap.id, row });
    if (candidates.length >= maxItems) break;
  }

  let attempted = 0;
  let refreshed = 0;
  let skipped = 0;
  let errors = 0;
  let flaggedForReview = 0;

  for (const candidate of candidates) {
    attempted += 1;
    try {
      const lookup = await lookupLibraryMetadataForRow(candidate.row);
      if (!lookup) {
        skipped += 1;
        continue;
      }
      const merged = mergeLookupIntoLibraryRow({
        row: candidate.row,
        lookup,
        now: nowTs(),
        source: refreshSource,
        mode: "refresh",
        guardrailEnabled: coverReviewGuardrailEnabled,
      });
      if (merged.patch.needsCoverReview === true) {
        flaggedForReview += 1;
      }

      await db.collection("libraryItems").doc(candidate.id).set(merged.patch, { merge: true });
      refreshed += 1;
    } catch (error: unknown) {
      errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Library metadata refresh failed for item", {
        itemId: candidate.id,
        isbn: normalizeIsbnFromRow(candidate.row),
        requestId,
        source: refreshSource,
        message,
      });
    }
  }

  skipped = Math.max(0, scanned - attempted);
  return {
    scanned,
    attempted,
    refreshed,
    skipped,
    errors,
    flaggedForReview,
  };
}

function readRecentImportCandidate(row: Record<string, unknown>, nowMs: number): boolean {
  const updatedAtMs = Math.max(
    tsToMs(row.metadataEnrichmentQueuedAt),
    tsToMs(row.updatedAt),
    tsToMs(row.createdAt)
  );
  if (updatedAtMs <= 0 || nowMs - updatedAtMs > 7 * DAY_MS) return false;
  const metadataSource = safeString(row.metadataSource).trim().toLowerCase();
  const queuedReason = safeString(row.metadataEnrichmentReason).trim().toLowerCase();
  return queuedReason === "recent_import" || queuedReason === "recent_imports" || ["csv", "scanner", "api_v1"].includes(metadataSource);
}

function canLookupLibraryMetadataByTitle(row: Record<string, unknown>): boolean {
  const title = maybeText(row.title);
  if (!title || titleLooksPlaceholder(title)) return false;
  return true;
}

function canAutoEnrichLibraryRow(row: Record<string, unknown>): boolean {
  return Boolean(readValidIsbnFromRow(row)) || canLookupLibraryMetadataByTitle(row);
}

async function lookupLibraryMetadataForRow(row: Record<string, unknown>): Promise<LookupResult | null> {
  const validIsbn = readValidIsbnFromRow(row);
  if (validIsbn) {
    try {
      return await lookupIsbn(validIsbn, {
        includeRemoteWhenLocalFound: true,
        allowManualFallback: false,
      });
    } catch {
      // Fall through to title-based lookup when an ISBN exists but no provider resolves it.
    }
  }
  if (canLookupLibraryMetadataByTitle(row)) {
    return lookupMetadataByTitle(row);
  }
  return null;
}

function sortMetadataEnrichmentCandidates(
  left: { row: Record<string, unknown> },
  right: { row: Record<string, unknown> }
): number {
  const leftPending = left.row.metadataEnrichmentPending === true ? 1 : 0;
  const rightPending = right.row.metadataEnrichmentPending === true ? 1 : 0;
  if (leftPending !== rightPending) return rightPending - leftPending;

  const leftQueuedAt = Math.max(tsToMs(left.row.metadataEnrichmentQueuedAt), tsToMs(left.row.updatedAt), tsToMs(left.row.createdAt));
  const rightQueuedAt = Math.max(tsToMs(right.row.metadataEnrichmentQueuedAt), tsToMs(right.row.updatedAt), tsToMs(right.row.createdAt));
  if (leftPending && rightPending && leftQueuedAt !== rightQueuedAt) {
    return leftQueuedAt - rightQueuedAt;
  }
  return rightQueuedAt - leftQueuedAt;
}

async function loadMetadataEnrichmentCandidates(input: {
  scope: LibraryMetadataEnrichmentRunScope;
  maxItems: number;
  itemIds?: string[];
}): Promise<Array<{ id: string; row: Record<string, unknown> }>> {
  if (input.scope === "item_ids") {
    const ids = Array.from(new Set((input.itemIds ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0))).slice(0, 200);
    const docs = await Promise.all(ids.map((id) => db.collection("libraryItems").doc(id).get()));
    return docs
      .filter((docSnap) => docSnap.exists)
      .map((docSnap) => ({ id: docSnap.id, row: (docSnap.data() ?? {}) as Record<string, unknown> }))
      .filter((entry) => !isSoftDeletedRow(entry.row));
  }

  const scanLimit = Math.max(input.maxItems * 6, 240);
  if (input.scope === "pending") {
    try {
      const snap = await db.collection("libraryItems").where("metadataEnrichmentPending", "==", true).limit(scanLimit).get();
      return snap.docs
        .map((docSnap) => ({ id: docSnap.id, row: (docSnap.data() ?? {}) as Record<string, unknown> }))
        .filter((entry) => !isSoftDeletedRow(entry.row));
    } catch {
      // Fall through to the broader scan path below.
    }
  }

  let itemsSnap = await db.collection("libraryItems").orderBy("updatedAt", "desc").limit(scanLimit).get();
  if (itemsSnap.empty) {
    itemsSnap = await db.collection("libraryItems").limit(scanLimit).get();
  }

  const nowMs = Date.now();
  return itemsSnap.docs
    .map((docSnap) => ({ id: docSnap.id, row: (docSnap.data() ?? {}) as Record<string, unknown> }))
    .filter((entry) => {
      if (isSoftDeletedRow(entry.row)) return false;
      if (!canAutoEnrichLibraryRow(entry.row)) return false;
      if (input.scope === "thin_backfill") return assessLibraryMetadataGaps(entry.row).gap;
      if (input.scope === "recent_imports") return readRecentImportCandidate(entry.row, nowMs);
      return entry.row.metadataEnrichmentPending === true;
    });
}

export async function runLibraryMetadataEnrichmentBatch(input?: {
  maxItems?: number;
  scope?: LibraryMetadataEnrichmentRunScope;
  source?: "scheduled" | "manual";
  requestId?: string;
  itemIds?: string[];
}): Promise<LibraryMetadataEnrichmentRunResult> {
  const maxItems = Math.max(1, Math.min(250, input?.maxItems ?? LIBRARY_METADATA_ENRICHMENT_LIMIT));
  const scope = input?.scope ?? "pending";
  const source = input?.source ?? "scheduled";
  const requestId = textOrNull(input?.requestId);
  const providerConfig = await getLibraryExternalLookupProviderConfig();
  const queueNow = nowTs();
  const candidates = (await loadMetadataEnrichmentCandidates({
    scope,
    maxItems,
    itemIds: input?.itemIds,
  })).sort(sortMetadataEnrichmentCandidates);

  let queued = 0;
  for (const candidate of candidates) {
    if (candidate.row.metadataEnrichmentPending === true) continue;
    const reason: LibraryMetadataEnrichmentReason =
      scope === "thin_backfill"
        ? "thin_backfill"
        : scope === "recent_imports"
          ? "recent_imports"
          : scope === "item_ids"
            ? "manual_run"
            : "manual_run";
    const queuePatch = buildMetadataQueuePatch({
      row: candidate.row,
      reason,
      now: queueNow,
    });
    if (!queuePatch) continue;
    await db.collection("libraryItems").doc(candidate.id).set(queuePatch, { merge: true });
    candidate.row = {
      ...candidate.row,
      ...queuePatch,
    };
    queued += 1;
  }

  const toProcess = candidates.slice(0, maxItems);
  let attempted = 0;
  let enriched = 0;
  let skipped = 0;
  let errors = 0;

  for (const candidate of toProcess) {
    attempted += 1;
    try {
      const lookup = await lookupLibraryMetadataForRow(candidate.row);
      if (!lookup) {
        skipped += 1;
        await db.collection("libraryItems").doc(candidate.id).set(
          {
            metadataEnrichmentPending: false,
            metadataEnrichmentQueuedAt: null,
            metadataEnrichmentLastAttemptAt: nowTs(),
            metadataEnrichmentStatus: "manual_finish_required",
            metadataEnrichmentReason: rowRequiresManualFinish(candidate.row) ? "manual_run" : candidate.row.metadataEnrichmentReason ?? null,
          },
          { merge: true }
        );
        continue;
      }
      const merged = mergeLookupIntoLibraryRow({
        row: candidate.row,
        lookup,
        now: nowTs(),
        source,
        mode: "enrichment",
        guardrailEnabled: providerConfig.coverReviewGuardrailEnabled !== false,
      });
      await db.collection("libraryItems").doc(candidate.id).set(merged.patch, { merge: true });
      if (merged.changed) {
        enriched += 1;
      } else {
        skipped += 1;
      }
    } catch (error: unknown) {
      errors += 1;
      await db.collection("libraryItems").doc(candidate.id).set(
        {
          metadataEnrichmentPending: false,
          metadataEnrichmentQueuedAt: null,
          metadataEnrichmentLastAttemptAt: nowTs(),
          metadataEnrichmentStatus: "error",
        },
        { merge: true }
      );
      logger.warn("Library metadata enrichment failed for item", {
        itemId: candidate.id,
        isbn: normalizeIsbnFromRow(candidate.row),
        requestId,
        scope,
        source,
        message: toErrorMessage(error),
      });
    }
  }

  return {
    queued,
    attempted,
    enriched,
    skipped,
    errors,
    stillPending: Math.max(0, candidates.length - toProcess.length),
  };
}

export async function getLibraryMetadataEnrichmentSummary(input?: {
  sampleLimit?: number;
}): Promise<LibraryMetadataEnrichmentSummary> {
  const sampleLimit = Math.max(120, Math.min(1200, input?.sampleLimit ?? 400));
  let itemsSnap = await db.collection("libraryItems").orderBy("updatedAt", "desc").limit(sampleLimit).get();
  if (itemsSnap.empty) {
    itemsSnap = await db.collection("libraryItems").limit(sampleLimit).get();
  }
  const rows = itemsSnap.docs
    .map((docSnap) => (docSnap.data() ?? {}) as Record<string, unknown>)
    .filter((row) => !isSoftDeletedRow(row));

  let auditSnap;
  try {
    auditSnap = await db.collection(LIBRARY_RUN_AUDIT_COLLECTION).orderBy("createdAt", "desc").limit(40).get();
  } catch {
    auditSnap = await db.collection(LIBRARY_RUN_AUDIT_COLLECTION).limit(40).get();
  }

  const latestRun = auditSnap.docs
    .map((docSnap) => (docSnap.data() ?? {}) as Record<string, unknown>)
    .find((row) => safeString(row.job).trim() === "library.metadata.enrichment");
  const result = asRecord(latestRun?.result) ? (latestRun?.result as Record<string, unknown>) : {};
  const readResultNumber = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  };

  return {
    pendingCount: rows.filter((row) => row.metadataEnrichmentPending === true).length,
    thinBacklogCount: rows.filter((row) => assessLibraryMetadataGaps(row).gap).length,
    lastRunAtMs: latestRun ? tsToMs(latestRun.createdAt) : 0,
    lastRunStatus: latestRun ? safeString(latestRun.status).trim() : "",
    lastRunSource: latestRun ? safeString(latestRun.source).trim() : "",
    lastRunQueued: readResultNumber(result.queued),
    lastRunAttempted: readResultNumber(result.attempted),
    lastRunEnriched: readResultNumber(result.enriched),
    lastRunSkipped: readResultNumber(result.skipped),
    lastRunErrors: readResultNumber(result.errors),
    lastRunStillPending: readResultNumber(result.stillPending),
  };
}

export async function listLibraryMetadataGapRows(input?: {
  limit?: number;
  sampleLimit?: number;
}): Promise<LibraryMetadataGapRow[]> {
  const limit = Math.max(1, Math.min(200, input?.limit ?? 80));
  // Staff needs a representative gap queue, not just the most recently touched slice.
  const sampleLimit = Math.max(limit, Math.min(2400, input?.sampleLimit ?? Math.max(limit * 8, 1200)));
  let itemsSnap = await db.collection("libraryItems").orderBy("updatedAt", "desc").limit(sampleLimit).get();
  if (itemsSnap.empty) {
    itemsSnap = await db.collection("libraryItems").limit(sampleLimit).get();
  }

  return itemsSnap.docs
    .map((docSnap) => ({ id: docSnap.id, row: (docSnap.data() ?? {}) as Record<string, unknown> }))
    .filter((entry) => !isSoftDeletedRow(entry.row))
    .map((entry) => {
      const assessment = assessLibraryMetadataGaps(entry.row);
      return {
        itemId: entry.id,
        title: maybeText(entry.row.title) ?? entry.id,
        source: maybeText(entry.row.source),
        mediaType: maybeText(entry.row.mediaType) ?? maybeText(entry.row.format),
        coverQualityStatus: maybeText(entry.row.coverQualityStatus),
        coverQualityReason: maybeText(entry.row.coverQualityReason),
        detailStatus: maybeText(entry.row.detailStatus),
        gapReasons: assessment.reasons,
        updatedAtMs: Math.max(tsToMs(entry.row.updatedAt), tsToMs(entry.row.createdAt)),
        isbn: normalizeIsbnFromRow(entry.row) || null,
      };
    })
    .filter((entry) => entry.gapReasons.length > 0)
    .sort((left, right) => {
      const leftManual = left.gapReasons.includes("manual_finish_required") ? 1 : 0;
      const rightManual = right.gapReasons.includes("manual_finish_required") ? 1 : 0;
      if (leftManual !== rightManual) return rightManual - leftManual;
      if (left.updatedAtMs !== right.updatedAtMs) return right.updatedAtMs - left.updatedAtMs;
      return left.title.localeCompare(right.title);
    })
    .slice(0, limit);
}

type OverdueReminderStage = "library.borrow_due_7d" | "library.borrow_due_1d" | "library.borrow_overdue_3d";

type LibraryOverdueSyncResult = {
  scanned: number;
  transitionedToOverdue: number;
  remindersCreated: number;
  skipped: number;
  errors: number;
};

function normalizeLoanStatus(value: unknown): string {
  return safeString(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function reminderStagesForLoan(dueAtMs: number, nowMs: number): OverdueReminderStage[] {
  if (dueAtMs <= 0) return [];
  const deltaMs = dueAtMs - nowMs;
  const overdueMs = nowMs - dueAtMs;
  const stages: OverdueReminderStage[] = [];

  if (deltaMs > 6 * DAY_MS && deltaMs <= 8 * DAY_MS) {
    stages.push("library.borrow_due_7d");
  }
  if (deltaMs >= 0 && deltaMs <= 36 * 60 * 60 * 1000) {
    stages.push("library.borrow_due_1d");
  }
  if (overdueMs >= 3 * DAY_MS) {
    stages.push("library.borrow_overdue_3d");
  }

  return stages;
}

export async function syncLibraryLoanOverduesBatch(input?: {
  maxItems?: number;
  source?: "scheduled" | "manual";
  requestId?: string;
}): Promise<LibraryOverdueSyncResult> {
  const maxItems = Math.max(10, Math.min(1000, input?.maxItems ?? LIBRARY_OVERDUE_SYNC_LIMIT));
  const source = input?.source ?? "scheduled";
  const requestId = textOrNull(input?.requestId);
  const nowMs = Date.now();
  let scanned = 0;
  let transitionedToOverdue = 0;
  let remindersCreated = 0;
  let errors = 0;

  let loanSnap;
  try {
    loanSnap = await db.collection("libraryLoans").orderBy("dueAt", "asc").limit(maxItems).get();
  } catch {
    loanSnap = await db.collection("libraryLoans").limit(maxItems).get();
  }

  for (const docSnap of loanSnap.docs) {
    scanned += 1;
    const row = (docSnap.data() ?? {}) as Record<string, unknown>;
    const loanId = docSnap.id;
    const dueAtMs = tsToMs(row.dueAt);
    const status = normalizeLoanStatus(row.status);
    if (dueAtMs <= 0) continue;
    if (status === "returned" || status === "lost" || status === "cancelled") continue;
    if (status !== "checked_out" && status !== "return_requested" && status !== "overdue") continue;

    try {
      const loanRef = db.collection("libraryLoans").doc(loanId);
      if (dueAtMs < nowMs && status !== "overdue") {
        const now = nowTs();
        await loanRef.set(
          {
            status: "overdue",
            overdueAt: now,
            overdueSource: source,
            updatedAt: now,
          },
          { merge: true }
        );
        transitionedToOverdue += 1;

        const itemId = safeString(row.itemId).trim();
        if (itemId) {
          const itemRef = db.collection("libraryItems").doc(itemId);
          const itemSnap = await itemRef.get();
          if (itemSnap.exists) {
            const itemRow = (itemSnap.data() ?? {}) as Record<string, unknown>;
            const itemStatus = normalizeLoanStatus(itemRow.status);
            if (!isSoftDeletedRow(itemRow) && itemStatus !== "lost" && itemStatus !== "archived") {
              await itemRef.set(
                {
                  status: "overdue",
                  current_lending_status: "overdue",
                  updatedAt: now,
                },
                { merge: true }
              );
            }
          }
        }
      }

      const stages = reminderStagesForLoan(dueAtMs, nowMs);
      for (const stage of stages) {
        const reminderId = `${loanId}__${stage}`;
        const reminderRef = db.collection("libraryReminderEvents").doc(reminderId);
        const reminderSnap = await reminderRef.get();
        if (reminderSnap.exists) continue;
        await reminderRef.set(
          {
            loanId,
            itemId: textOrNull(row.itemId),
            borrowerUid: textOrNull(row.borrowerUid),
            borrowerEmail: textOrNull(row.borrowerEmail),
            stage,
            dueAt: row.dueAt ?? null,
            emittedAt: nowTs(),
            source,
          },
          { merge: false }
        );
        remindersCreated += 1;
      }
    } catch (error: unknown) {
      errors += 1;
      logger.warn("Library overdue sync failed for loan", {
        loanId,
        source,
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    scanned,
    transitionedToOverdue,
    remindersCreated,
    skipped: Math.max(0, loanSnap.size - scanned),
    errors,
  };
}

export const importLibraryIsbns = onRequest(
  { region: REGION, timeoutSeconds: 120 },
  async (req, res) => {
    const requestId = getRequestId(req);
    setRequestIdHeader(res, requestId);
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      jsonError(res, requestId, 405, "INVALID_ARGUMENT", "Use POST");
      return;
    }

    const authCtx = await requireAuthContext(req);
    if (!authCtx.ok) {
      jsonError(res, requestId, 401, "UNAUTHENTICATED", authCtx.message);
      return;
    }
    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      jsonError(res, requestId, 401, "UNAUTHENTICATED", auth.message);
      return;
    }

    const admin = await requireAdmin(req);
    const isStaff = authCtx.ctx.mode === "firebase" && isStaffFromDecoded(authCtx.ctx.decoded);
    if (!admin.ok && !isStaff) {
      jsonError(res, requestId, 403, "FORBIDDEN", "Forbidden");
      return;
    }

    const parsed = parseBody(importSchema, req.body);
    if (!parsed.ok) {
      jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "importLibraryIsbns",
      max: 3,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      jsonError(res, requestId, 429, "RATE_LIMITED", "Too many requests");
      return;
    }

    const body = parsed.data as ImportRequest;
    const startedAt = Date.now();
    await emitRunAudit({
      requestId,
      job: "library.items.import_isbns",
      trigger: "manual",
      source: "manual",
      status: "started",
      actorUid: auth.uid,
      input: {
        isbnCount: body.isbns.length,
        source: textOrNull(body.source) ?? "csv",
      },
    });

    let result: ImportLibraryIsbnsResult;
    try {
      result = await importLibraryIsbnBatch({
        isbns: body.isbns,
        source: body.source,
      });
    } catch (error: unknown) {
      const message = toErrorMessage(error) || "Import failed";
      await emitRunAudit({
        requestId,
        job: "library.items.import_isbns",
        trigger: "manual",
        source: "manual",
        status: "error",
        actorUid: auth.uid,
        input: {
          isbnCount: body.isbns.length,
          source: textOrNull(body.source) ?? "csv",
        },
        code: "IMPORT_FAILED",
        message,
      });
      jsonError(res, requestId, 400, "INVALID_ARGUMENT", message);
      return;
    }

    await emitRunAudit({
      requestId,
      job: "library.items.import_isbns",
      trigger: "manual",
      source: "manual",
      status: "success",
      actorUid: auth.uid,
      input: {
        isbnCount: body.isbns.length,
        source: textOrNull(body.source) ?? "csv",
      },
      result: {
        requested: result.requested,
        created: result.created,
        updated: result.updated,
        manualPassRequired: result.manualPassRequired.length,
        rejected: result.rejected.length,
        errors: result.errors.length,
        durationMs: Date.now() - startedAt,
      },
    });

    jsonOk(res, requestId, {
      requested: result.requested,
      created: result.created,
      updated: result.updated,
      manualPassRequired: result.manualPassRequired,
      rejected: result.rejected,
      errors: result.errors,
    });
  }
);

export const refreshLibraryIsbnMetadata = onSchedule(
  {
    region: REGION,
    schedule: LIBRARY_SYNC_SCHEDULE,
    timeZone: "America/Phoenix",
  },
  async () => {
    const requestId = makeRequestId("sched");
    const startedAt = Date.now();
    await emitRunAudit({
      requestId,
      job: "library.metadata.refresh",
      trigger: "scheduled",
      source: "scheduled",
      status: "started",
      actorUid: "system:scheduler",
      input: {
        maxItems: LIBRARY_METADATA_REFRESH_LIMIT,
        staleMs: LIBRARY_METADATA_REFRESH_STALE_MS,
      },
    });
    try {
      const result = await refreshLibraryMetadataBatch({
        maxItems: LIBRARY_METADATA_REFRESH_LIMIT,
        staleMs: LIBRARY_METADATA_REFRESH_STALE_MS,
        source: "scheduled",
        requestId,
      });
      const durationMs = Date.now() - startedAt;
      logger.info("Library metadata refresh run completed", {
        requestId,
        schedule: LIBRARY_SYNC_SCHEDULE,
        durationMs,
        ...result,
      });
      await emitRunAudit({
        requestId,
        job: "library.metadata.refresh",
        trigger: "scheduled",
        source: "scheduled",
        status: "success",
        actorUid: "system:scheduler",
        result: {
          durationMs,
          ...result,
        },
      });
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      logger.error("Library metadata refresh run failed", {
        requestId,
        schedule: LIBRARY_SYNC_SCHEDULE,
        message,
      });
      await emitRunAudit({
        requestId,
        job: "library.metadata.refresh",
        trigger: "scheduled",
        source: "scheduled",
        status: "error",
        actorUid: "system:scheduler",
        code: "SCHEDULED_RUN_FAILED",
        message,
      });
      throw error;
    }
  }
);

export const enrichLibraryIsbnMetadata = onSchedule(
  {
    region: REGION,
    schedule: LIBRARY_METADATA_ENRICHMENT_SCHEDULE,
    timeZone: "America/Phoenix",
  },
  async () => {
    const requestId = makeRequestId("sched");
    const startedAt = Date.now();
    await emitRunAudit({
      requestId,
      job: "library.metadata.enrichment",
      trigger: "scheduled",
      source: "scheduled",
      status: "started",
      actorUid: "system:scheduler",
      input: {
        maxItems: LIBRARY_METADATA_ENRICHMENT_LIMIT,
        scope: "pending",
      },
    });
    try {
      const pendingResult = await runLibraryMetadataEnrichmentBatch({
        maxItems: LIBRARY_METADATA_ENRICHMENT_LIMIT,
        scope: "pending",
        source: "scheduled",
        requestId,
      });
      const thinBackfillResult = await runLibraryMetadataEnrichmentBatch({
        maxItems: Math.max(1, Math.floor(LIBRARY_METADATA_ENRICHMENT_LIMIT / 2)),
        scope: "thin_backfill",
        source: "scheduled",
        requestId,
      });
      const result = {
        queued: pendingResult.queued + thinBackfillResult.queued,
        attempted: pendingResult.attempted + thinBackfillResult.attempted,
        enriched: pendingResult.enriched + thinBackfillResult.enriched,
        skipped: pendingResult.skipped + thinBackfillResult.skipped,
        errors: pendingResult.errors + thinBackfillResult.errors,
        stillPending: pendingResult.stillPending + thinBackfillResult.stillPending,
        pending: pendingResult,
        thinBackfill: thinBackfillResult,
      };
      const durationMs = Date.now() - startedAt;
      logger.info("Library metadata enrichment run completed", {
        requestId,
        schedule: LIBRARY_METADATA_ENRICHMENT_SCHEDULE,
        durationMs,
        ...result,
      });
      await emitRunAudit({
        requestId,
        job: "library.metadata.enrichment",
        trigger: "scheduled",
        source: "scheduled",
        status: "success",
        actorUid: "system:scheduler",
        result: {
          durationMs,
          ...result,
        },
      });
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      logger.error("Library metadata enrichment run failed", {
        requestId,
        schedule: LIBRARY_METADATA_ENRICHMENT_SCHEDULE,
        message,
      });
      await emitRunAudit({
        requestId,
        job: "library.metadata.enrichment",
        trigger: "scheduled",
        source: "scheduled",
        status: "error",
        actorUid: "system:scheduler",
        code: "SCHEDULED_RUN_FAILED",
        message,
      });
      throw error;
    }
  }
);

export const syncLibraryLoanOverdues = onSchedule(
  {
    region: REGION,
    schedule: LIBRARY_OVERDUE_SYNC_SCHEDULE,
    timeZone: "America/Phoenix",
  },
  async () => {
    const requestId = makeRequestId("sched");
    const startedAt = Date.now();
    await emitRunAudit({
      requestId,
      job: "library.loans.overdue_sync",
      trigger: "scheduled",
      source: "scheduled",
      status: "started",
      actorUid: "system:scheduler",
      input: {
        maxItems: LIBRARY_OVERDUE_SYNC_LIMIT,
      },
    });
    try {
      const result = await syncLibraryLoanOverduesBatch({
        maxItems: LIBRARY_OVERDUE_SYNC_LIMIT,
        source: "scheduled",
        requestId,
      });
      const durationMs = Date.now() - startedAt;
      logger.info("Library overdue sync run completed", {
        requestId,
        schedule: LIBRARY_OVERDUE_SYNC_SCHEDULE,
        durationMs,
        ...result,
      });
      await emitRunAudit({
        requestId,
        job: "library.loans.overdue_sync",
        trigger: "scheduled",
        source: "scheduled",
        status: "success",
        actorUid: "system:scheduler",
        result: {
          durationMs,
          ...result,
        },
      });
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      logger.error("Library overdue sync run failed", {
        requestId,
        schedule: LIBRARY_OVERDUE_SYNC_SCHEDULE,
        message,
      });
      await emitRunAudit({
        requestId,
        job: "library.loans.overdue_sync",
        trigger: "scheduled",
        source: "scheduled",
        status: "error",
        actorUid: "system:scheduler",
        code: "SCHEDULED_RUN_FAILED",
        message,
      });
      throw error;
    }
  }
);

export const runLibraryOverdueSyncNow = onRequest(
  { region: REGION, timeoutSeconds: 240 },
  async (req, res) => {
    const requestId = getRequestId(req);
    setRequestIdHeader(res, requestId);
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      jsonError(res, requestId, 405, "INVALID_ARGUMENT", "Use POST");
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      jsonError(res, requestId, 401, "UNAUTHENTICATED", auth.message);
      return;
    }

    const admin = await requireAdmin(req);
    if (!admin.ok) {
      jsonError(res, requestId, 403, "FORBIDDEN", "Forbidden");
      return;
    }

    const parsed = parseBody(overdueSyncSchema, req.body);
    if (!parsed.ok) {
      jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "runLibraryOverdueSyncNow",
      max: 3,
      windowMs: 10 * 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      jsonError(res, requestId, 429, "RATE_LIMITED", "Too many overdue sync requests");
      return;
    }

    const startedAt = Date.now();
    const limit = parsed.data.limit ?? LIBRARY_OVERDUE_SYNC_LIMIT;
    await emitRunAudit({
      requestId,
      job: "library.loans.overdue_sync",
      trigger: "manual",
      source: "manual",
      status: "started",
      actorUid: auth.uid,
      input: {
        maxItems: limit,
      },
    });
    try {
      const result = await syncLibraryLoanOverduesBatch({
        maxItems: limit,
        source: "manual",
        requestId,
      });
      const durationMs = Date.now() - startedAt;
      await emitRunAudit({
        requestId,
        job: "library.loans.overdue_sync",
        trigger: "manual",
        source: "manual",
        status: "success",
        actorUid: auth.uid,
        result: {
          durationMs,
          ...result,
        },
      });
      jsonOk(res, requestId, {
        durationMs,
        ...result,
      });
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      await emitRunAudit({
        requestId,
        job: "library.loans.overdue_sync",
        trigger: "manual",
        source: "manual",
        status: "error",
        actorUid: auth.uid,
        input: {
          maxItems: limit,
        },
        code: "MANUAL_RUN_FAILED",
        message,
      });
      jsonError(res, requestId, 500, "INTERNAL", "Overdue sync failed", {
        message,
      });
    }
  }
);

export const runLibraryMetadataRefreshNow = onRequest(
  { region: REGION, timeoutSeconds: 240 },
  async (req, res) => {
    const requestId = getRequestId(req);
    setRequestIdHeader(res, requestId);
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      jsonError(res, requestId, 405, "INVALID_ARGUMENT", "Use POST");
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      jsonError(res, requestId, 401, "UNAUTHENTICATED", auth.message);
      return;
    }

    const admin = await requireAdmin(req);
    if (!admin.ok) {
      jsonError(res, requestId, 403, "FORBIDDEN", "Forbidden");
      return;
    }

    const parsed = parseBody(refreshMetadataSchema, req.body);
    if (!parsed.ok) {
      jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "runLibraryMetadataRefreshNow",
      max: 2,
      windowMs: 10 * 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      jsonError(res, requestId, 429, "RATE_LIMITED", "Too many refresh requests");
      return;
    }

    const startedAt = Date.now();
    const limit = parsed.data.limit ?? LIBRARY_METADATA_REFRESH_LIMIT;
    const staleMs = parsed.data.staleMs ?? LIBRARY_METADATA_REFRESH_STALE_MS;
    await emitRunAudit({
      requestId,
      job: "library.metadata.refresh",
      trigger: "manual",
      source: "manual",
      status: "started",
      actorUid: auth.uid,
      input: {
        maxItems: limit,
        staleMs,
      },
    });
    try {
      const result = await refreshLibraryMetadataBatch({
        maxItems: limit,
        staleMs,
        source: "manual",
        requestId,
      });
      const durationMs = Date.now() - startedAt;
      await emitRunAudit({
        requestId,
        job: "library.metadata.refresh",
        trigger: "manual",
        source: "manual",
        status: "success",
        actorUid: auth.uid,
        result: {
          durationMs,
          ...result,
        },
      });
      jsonOk(res, requestId, {
        durationMs,
        ...result,
      });
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      await emitRunAudit({
        requestId,
        job: "library.metadata.refresh",
        trigger: "manual",
        source: "manual",
        status: "error",
        actorUid: auth.uid,
        input: {
          maxItems: limit,
          staleMs,
        },
        code: "MANUAL_RUN_FAILED",
        message,
      });
      jsonError(res, requestId, 500, "INTERNAL", "Metadata refresh failed", {
        message,
      });
    }
  }
);
