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
const LIBRARY_OVERDUE_SYNC_SCHEDULE = safeString(process.env.LIBRARY_OVERDUE_SYNC_SCHEDULE).trim() || "every 3 hours";
const LIBRARY_OVERDUE_SYNC_LIMIT = Math.max(10, Math.min(1000, Number(process.env.LIBRARY_OVERDUE_SYNC_LIMIT ?? 320) || 320));
const DAY_MS = 24 * 60 * 60 * 1000;
const LIBRARY_RUN_AUDIT_COLLECTION = "libraryRunAudit";

type ProviderName = "openlibrary" | "googlebooks";

type ImportRequest = {
  isbns: string[];
  source?: string;
};

export type ImportLibraryIsbnsResult = {
  requested: number;
  created: number;
  updated: number;
  errors: Array<{ isbn: string; message: string }>;
};

type LookupSource = "local_reference" | "openlibrary" | "googlebooks" | "manual";

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
  source: ProviderName;
  sourceId: string | null;
  sourceUrl: string | null;
  identifiers: {
    isbn10: string | null;
    isbn13: string | null;
    olid: string | null;
    googleVolumeId: string | null;
  };
};

type LibraryExternalLookupProviderStatus = {
  provider: ProviderName;
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
  job: "library.items.import_isbns" | "library.metadata.refresh" | "library.loans.overdue_sync";
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

async function emitRunAudit(params: RunAuditParams): Promise<void> {
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

function isbn10To13(isbn10: string): string | null {
  if (isbn10.length !== 10) return null;
  const base = `978${isbn10.slice(0, 9)}`;
  const check = computeIsbn13Check(base);
  return check ? `${base}${check}` : null;
}

function isbn13To10(isbn13: string): string | null {
  if (isbn13.length !== 13) return null;
  if (!isbn13.startsWith("978")) return null;
  const base = isbn13.slice(3, 12);
  const check = computeIsbn10Check(base);
  return check ? `${base}${check}` : null;
}

function normalizeIsbn(raw: string) {
  const cleaned = cleanIsbn(raw);
  let isbn10: string | null = null;
  let isbn13: string | null = null;

  if (cleaned.length === 10) {
    isbn10 = cleaned;
    isbn13 = isbn10To13(cleaned);
  } else if (cleaned.length === 13) {
    isbn13 = cleaned;
    isbn10 = isbn13To10(cleaned);
  }

  const primary = isbn13 || isbn10 || cleaned;
  return { primary, isbn10, isbn13 };
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

async function fetchJsonWithProviderPolicy(params: {
  provider: ProviderName;
  url: string;
}): Promise<Record<string, unknown> | null> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "MonsoonFire-Portal/1.0 (+https://portal.monsoonfire.com; contact support@monsoonfire.com)",
  };

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
      const parsed = (await response.json()) as unknown;
      return asRecord(parsed) ? parsed : null;
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

function tsToMs(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (asRecord(value)) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") {
      const output = (toMillis as () => unknown)();
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

function preferredCoverUrl(existing: unknown, incoming: unknown): string | null {
  const current = textOrNull(existing);
  const next = textOrNull(incoming);
  if (!next) return current;
  if (!current) return next;
  if (current.includes("openlibrary.org") && next.includes("googleusercontent.com")) return next;
  return current;
}

type CoverQualityStatus = "approved" | "needs_review" | "missing";

type CoverQualityProvider = ProviderName | "amazon" | "unknown";
type CoverMediaKind = "book" | "non_book" | "unknown";
type CoverQualityContext = {
  mediaType?: unknown;
  format?: unknown;
  source?: unknown;
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

  if (host === "m.media-amazon.com" || host === "images-na.ssl-images-amazon.com") {
    return "amazon";
  }

  return "unknown";
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

function evaluateCoverQuality(coverUrl: unknown, context?: CoverQualityContext): {
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

  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }

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
    provider === "openlibrary" || provider === "googlebooks" || provider === "amazon";
  if (trustedSource) {
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

  const coverUrl = textOrNull(cover.large) || textOrNull(cover.medium) || textOrNull(cover.small);
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
  const coverUrl = textOrNull(imageLinks.thumbnail) || textOrNull(imageLinks.smallThumbnail) || textOrNull(imageLinks.small);

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

async function lookupIsbn(
  isbn: string,
  options: { includeRemoteWhenLocalFound?: boolean } = {}
): Promise<LookupResult> {
  const includeRemoteWhenLocalFound = options.includeRemoteWhenLocalFound === true;
  const localReference = lookupLocalIsbnReference(isbn);
  if (localReference && !includeRemoteWhenLocalFound) return localReference;

  const [openLibrary, googleBooks] = await Promise.all([
    fetchOpenLibrary(isbn).catch((err) => {
      logger.warn("OpenLibrary lookup failed", { isbn, message: err?.message ?? String(err) });
      return null;
    }),
    fetchGoogleBooks(isbn).catch((err) => {
      logger.warn("Google Books lookup failed", { isbn, message: err?.message ?? String(err) });
      return null;
    }),
  ]);

  const mergedRemote = mergeResults(openLibrary, googleBooks);
  const merged = localReference
    ? mergeResults(mergedRemote, localReference)
    : mergedRemote;
  if (merged) return merged;

  if (localReference) return localReference;

  return manualLookupFallbackForIsbn(isbn);
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
    identifiers: { isbn10: null, isbn13: null, olid: null, googleVolumeId: null },
    source: "manual",
  };
}

export async function resolveLibraryIsbn(params: {
  isbn: string;
  allowRemoteLookup?: boolean;
  includeRemoteWhenLocalFound?: boolean;
}): Promise<ResolvedLibraryIsbnResult> {
  const cleaned = cleanIsbn(params.isbn ?? "");
  if (cleaned.length !== 10 && cleaned.length !== 13) {
    throw new Error("Provide a valid ISBN-10 or ISBN-13.");
  }

  const normalized = normalizeIsbn(cleaned);
  const allowRemoteLookup = params.allowRemoteLookup !== false;
  let lookup: LookupResult;
  if (!allowRemoteLookup) {
    lookup = lookupLocalIsbnReference(normalized.primary) ?? manualLookupFallbackForIsbn(normalized.primary);
  } else {
    lookup = await lookupIsbn(normalized.primary, {
      includeRemoteWhenLocalFound: params.includeRemoteWhenLocalFound === true,
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
const KNOWN_EXTERNAL_LOOKUP_PROVIDERS: ProviderName[] = ["openlibrary", "googlebooks"];
const envDisabledExternalLookupProviders = new Set<ProviderName>(
  safeString(process.env.LIBRARY_EXTERNAL_LOOKUP_DISABLED_PROVIDERS)
    .split(/[,\s]+/g)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is ProviderName => KNOWN_EXTERNAL_LOOKUP_PROVIDERS.includes(entry as ProviderName))
);
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
  const disabledProviders = Array.from(envDisabledExternalLookupProviders).sort();
  return {
    openlibraryEnabled: !envDisabledExternalLookupProviders.has("openlibrary"),
    googlebooksEnabled: !envDisabledExternalLookupProviders.has("googlebooks"),
    disabledProviders,
    updatedAtMs: 0,
    updatedByUid: null,
    note: null,
  };
}

function toExternalLookupProviderConfig(row: Record<string, unknown> | null | undefined): LibraryExternalLookupProviderConfig {
  const disabled = new Set<ProviderName>(envDisabledExternalLookupProviders);
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
  const disabledProviders = Array.from(disabled).sort();
  return {
    openlibraryEnabled: !disabled.has("openlibrary"),
    googlebooksEnabled: !disabled.has("googlebooks"),
    disabledProviders,
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
  note?: string | null;
  updatedByUid?: string | null;
}): Promise<LibraryExternalLookupProviderConfig> {
  const current = await getLibraryExternalLookupProviderConfig();
  const nextOpenlibraryEnabled = typeof input.openlibraryEnabled === "boolean"
    ? input.openlibraryEnabled
    : current.openlibraryEnabled;
  const nextGooglebooksEnabled = typeof input.googlebooksEnabled === "boolean"
    ? input.googlebooksEnabled
    : current.googlebooksEnabled;
  const nextNote = textOrNull(input.note) ?? current.note ?? null;
  const nextUpdatedByUid = textOrNull(input.updatedByUid) ?? null;

  const disabledProviders = new Set<ProviderName>(envDisabledExternalLookupProviders);
  if (!nextOpenlibraryEnabled) disabledProviders.add("openlibrary");
  if (!nextGooglebooksEnabled) disabledProviders.add("googlebooks");
  const disabledProvidersList = Array.from(disabledProviders).sort();

  const now = nowTs();
  await externalLookupProviderConfigDoc().set(
    {
      openlibraryEnabled: nextOpenlibraryEnabled,
      googlebooksEnabled: nextGooglebooksEnabled,
      disabledProviders: disabledProvidersList,
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
      openlibraryEnabled: nextOpenlibraryEnabled,
      googlebooksEnabled: nextGooglebooksEnabled,
      disabledProviders: disabledProvidersList,
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
    if (cleaned.length === length) return cleaned;
  }
  return null;
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
  a: LibraryExternalLookupItem[],
  b: LibraryExternalLookupItem[],
  limit: number
): LibraryExternalLookupItem[] {
  const merged: LibraryExternalLookupItem[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    if (a[i]) merged.push(a[i]);
    if (b[i]) merged.push(b[i]);
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
      coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : null,
      format: "book",
      source: "openlibrary",
      sourceId: key,
      sourceUrl: key ? `https://openlibrary.org${key}` : null,
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
      coverUrl:
        textOrNull(imageLinks.thumbnail) ||
        textOrNull(imageLinks.smallThumbnail) ||
        textOrNull(imageLinks.small),
      format: textOrNull(info.printType) || "book",
      source: "googlebooks",
      sourceId: textOrNull(row.id),
      sourceUrl: textOrNull(info.infoLink),
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

export async function lookupLibraryExternalSources(input: {
  q: string;
  limit?: number;
}): Promise<LibraryExternalLookupResult> {
  const q = normalizeExternalLookupQuery(input.q);
  const limit = normalizeExternalLookupLimit(input.limit);
  const providerConfig = await getLibraryExternalLookupProviderConfig();
  const disabledProviders = new Set<ProviderName>(providerConfig.disabledProviders);
  const openLibraryEnabled = !disabledProviders.has("openlibrary");
  const googleBooksEnabled = !disabledProviders.has("googlebooks");
  if (!q) {
    return {
      q: "",
      limit,
      items: [],
      cacheHit: false,
      degraded: false,
      policyLimited: disabledProviders.size > 0,
      providers: [],
    };
  }

  const key = `${externalLookupCacheKey(q, limit)}::providers:${Array.from(disabledProviders).sort().join(",")}`;
  const cached = readExternalLookupCache(key);
  if (cached) return cached;

  const inFlight = externalLookupInFlight.get(key);
  if (inFlight) return inFlight;

  const run = (async (): Promise<LibraryExternalLookupResult> => {
    const [openLibraryItems, googleBooksItems] = await Promise.all([
      openLibraryEnabled
        ? fetchOpenLibrarySearch(q, limit).catch((error) => {
            logger.warn("Library external lookup OpenLibrary failed", {
              q,
              limit,
              message: error instanceof Error ? error.message : String(error),
            });
            return null;
          })
        : Promise.resolve([] as LibraryExternalLookupItem[]),
      googleBooksEnabled
        ? fetchGoogleBooksSearch(q, limit).catch((error) => {
            logger.warn("Library external lookup Google Books failed", {
              q,
              limit,
              message: error instanceof Error ? error.message : String(error),
            });
            return null;
          })
        : Promise.resolve([] as LibraryExternalLookupItem[]),
    ]);

    const openLibraryFailed = openLibraryEnabled && openLibraryItems === null;
    const googleBooksFailed = googleBooksEnabled && googleBooksItems === null;
    const openItems = Array.isArray(openLibraryItems) ? openLibraryItems : [];
    const googleItems = Array.isArray(googleBooksItems) ? googleBooksItems : [];
    const result: LibraryExternalLookupResult = {
      q,
      limit,
      items: interleaveExternalLookupItems(openItems, googleItems, limit),
      cacheHit: false,
      degraded: openLibraryFailed || googleBooksFailed,
      policyLimited: disabledProviders.size > 0,
      providers: [
        {
          provider: "openlibrary",
          ok: openLibraryEnabled && !openLibraryFailed,
          itemCount: openItems.length,
          cached: false,
          disabled: !openLibraryEnabled,
        },
        {
          provider: "googlebooks",
          ok: googleBooksEnabled && !googleBooksFailed,
          itemCount: googleItems.length,
          cached: false,
          disabled: !googleBooksEnabled,
        },
      ],
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

export async function importLibraryIsbnBatch(input: ImportRequest): Promise<ImportLibraryIsbnsResult> {
  const isbns = Array.isArray(input.isbns) ? input.isbns : [];
  const source = typeof input.source === "string" ? input.source : "csv";
  const cleaned = isbns.map((isbn) => cleanIsbn(String(isbn))).filter(Boolean);
  const deduped = Array.from(new Set(cleaned));
  if (deduped.length === 0) {
    throw new Error("Provide at least one ISBN");
  }

  const capped = deduped.slice(0, 200);
  const created: string[] = [];
  const updated: string[] = [];
  const errors: Array<{ isbn: string; message: string }> = [];

  for (const rawIsbn of capped) {
    try {
      const normalized = normalizeIsbn(rawIsbn);
      const itemId = `isbn-${normalized.primary}`;
      const lookup = await lookupIsbn(normalized.primary);
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
      const coverQuality = evaluateCoverQuality(lookup.coverUrl, {
        mediaType: "book",
        format: lookup.format,
        source: lookup.source,
      });

      const docRef = db.collection("libraryItems").doc(targetItemId);
      const snap = await docRef.get();
      const now = nowTs();
      const baseDoc = {
        title: lookup.title,
        subtitle: lookup.subtitle ?? null,
        authors: lookup.authors ?? [],
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
        updatedAt: now,
        metadataSnapshot: lookup.raw ?? null,
        coverQualityStatus: coverQuality.status,
        needsCoverReview: coverQuality.needsReview,
        coverQualityReason: coverQuality.reason,
        coverQualityValidatedAt: now,
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

function maybeText(value: unknown): string | null {
  const text = textOrNull(value);
  return text && text.trim().length > 0 ? text : null;
}

function maybeStringArray(value: unknown): string[] {
  return asStringArray(value).filter((entry) => entry.trim().length > 0);
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

  let itemsSnap = await db.collection("libraryItems").orderBy("updatedAt", "asc").limit(scanLimit).get();
  if (itemsSnap.empty) {
    itemsSnap = await db.collection("libraryItems").limit(scanLimit).get();
  }

  const candidates: Array<{ id: string; row: Record<string, unknown>; isbn: string }> = [];
  let scanned = 0;
  for (const docSnap of itemsSnap.docs) {
    const row = (docSnap.data() ?? {}) as Record<string, unknown>;
    scanned += 1;
    if (isSoftDeletedRow(row)) continue;

    const isbn = normalizeIsbnFromRow(row);
    if (!isbn) continue;

    const lastRefreshMs = Math.max(
      tsToMs(row.metadataRefreshedAt),
      tsToMs(row.metadataSyncedAt),
      tsToMs(row.updatedAt),
      tsToMs(row.createdAt)
    );
    const missingCover = !hasMeaningfulText(row.coverUrl);
    const stale = lastRefreshMs <= 0 || nowMs - lastRefreshMs >= staleMs;
    if (!missingCover && !stale) continue;

    candidates.push({ id: docSnap.id, row, isbn });
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
      const lookup = await lookupIsbn(candidate.isbn, { includeRemoteWhenLocalFound: true });
      const now = nowTs();
      const row = candidate.row;
      const manualLocked = safeString(row.source).toLowerCase() === "manual";
      const patch: Record<string, unknown> = {
        metadataRefreshedAt: now,
        metadataRefreshSource: lookup.source,
        metadataRefreshMode: refreshSource,
      };

      const incomingIsbn10 = cleanIsbn(lookup.identifiers.isbn10 ?? "") || null;
      const incomingIsbn13 = cleanIsbn(lookup.identifiers.isbn13 ?? "") || null;
      const nextCover = preferredCoverUrl(row.coverUrl, lookup.coverUrl);

      if (!manualLocked || !hasMeaningfulText(row.title)) {
        const nextTitle = maybeText(lookup.title);
        if (nextTitle) patch.title = nextTitle;
      }
      if (!manualLocked || !hasMeaningfulText(row.subtitle)) {
        const nextSubtitle = maybeText(lookup.subtitle);
        if (nextSubtitle) patch.subtitle = nextSubtitle;
      }
      if (!manualLocked || maybeStringArray(row.authors).length === 0) {
        const nextAuthors = maybeStringArray(lookup.authors);
        if (nextAuthors.length > 0) patch.authors = nextAuthors;
      }
      if (!manualLocked || !hasMeaningfulText(row.description)) {
        const nextDescription = maybeText(lookup.description);
        if (nextDescription) patch.description = nextDescription;
      }
      if (!manualLocked || !hasMeaningfulText(row.publisher)) {
        const nextPublisher = maybeText(lookup.publisher);
        if (nextPublisher) patch.publisher = nextPublisher;
      }
      if (!manualLocked || !hasMeaningfulText(row.publishedDate)) {
        const nextPublishedDate = maybeText(lookup.publishedDate);
        if (nextPublishedDate) patch.publishedDate = nextPublishedDate;
      }
      if (!manualLocked || !Number.isFinite(Number(row.pageCount))) {
        const nextPageCount = typeof lookup.pageCount === "number" && lookup.pageCount > 0 ? Math.round(lookup.pageCount) : null;
        if (nextPageCount) patch.pageCount = nextPageCount;
      }
      if (!manualLocked || maybeStringArray(row.subjects).length === 0) {
        const nextSubjects = maybeStringArray(lookup.subjects);
        if (nextSubjects.length > 0) patch.subjects = nextSubjects;
      }
      if (!manualLocked || !hasMeaningfulText(row.format)) {
        const nextFormat = maybeText(lookup.format);
        if (nextFormat) patch.format = nextFormat;
      }
      if (nextCover) {
        patch.coverUrl = nextCover;
      }
      const coverQuality = evaluateCoverQuality(nextCover ?? row.coverUrl, {
        mediaType: row.mediaType,
        format: patch.format ?? row.format ?? lookup.format,
        source: lookup.source || row.source,
      });
      patch.coverQualityStatus = coverQuality.status;
      patch.needsCoverReview = coverQuality.needsReview;
      patch.coverQualityReason = coverQuality.reason;
      patch.coverQualityValidatedAt = now;
      if (coverQuality.needsReview) {
        flaggedForReview += 1;
      }

      if (!hasMeaningfulText(row.isbn) && candidate.isbn) patch.isbn = candidate.isbn;
      if ((!hasMeaningfulText(row.isbn10) || !hasMeaningfulText((row.identifiers as Record<string, unknown> | null)?.isbn10)) && incomingIsbn10) {
        patch.isbn10 = incomingIsbn10;
      }
      if ((!hasMeaningfulText(row.isbn13) || !hasMeaningfulText((row.identifiers as Record<string, unknown> | null)?.isbn13)) && incomingIsbn13) {
        patch.isbn13 = incomingIsbn13;
      }
      if (!hasMeaningfulText(row.isbn_normalized) && candidate.isbn) patch.isbn_normalized = candidate.isbn;

      const existingIdentifiers = asRecord(row.identifiers) ? (row.identifiers as Record<string, unknown>) : {};
      patch.identifiers = {
        isbn10: incomingIsbn10 ?? maybeText(existingIdentifiers.isbn10),
        isbn13: incomingIsbn13 ?? maybeText(existingIdentifiers.isbn13),
        olid: maybeText(lookup.identifiers.olid) ?? maybeText(existingIdentifiers.olid),
        googleVolumeId:
          maybeText(lookup.identifiers.googleVolumeId) ?? maybeText(existingIdentifiers.googleVolumeId),
      };

      const nextSearchTokens = buildSearchTokens([
        maybeText((patch.title ?? row.title) as unknown),
        maybeText((patch.subtitle ?? row.subtitle) as unknown),
        ...maybeStringArray((patch.authors ?? row.authors) as unknown),
        ...maybeStringArray((patch.subjects ?? row.subjects) as unknown),
      ]);
      if (nextSearchTokens.length > 0) {
        patch.searchTokens = nextSearchTokens;
      }
      patch.metadataSnapshot = lookup.raw ?? null;

      await db.collection("libraryItems").doc(candidate.id).set(patch, { merge: true });
      refreshed += 1;
    } catch (error: unknown) {
      errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Library metadata refresh failed for item", {
        itemId: candidate.id,
        isbn: candidate.isbn,
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
        errors: result.errors.length,
        durationMs: Date.now() - startedAt,
      },
    });

    jsonOk(res, requestId, {
      requested: result.requested,
      created: result.created,
      updated: result.updated,
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
