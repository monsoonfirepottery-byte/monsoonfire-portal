import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { z } from "zod";
import {
  applyCors,
  db,
  requireAdmin,
  requireAuthUid,
  nowTs,
  enforceRateLimit,
  parseBody,
  safeString,
} from "./shared";

const REGION = "us-central1";

type ImportRequest = {
  isbns: string[];
  source?: string;
};

type LookupSource = "openlibrary" | "googlebooks" | "manual";

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

const importSchema = z.object({
  isbns: z.array(z.string().min(1)).min(1).max(200),
  source: z.string().optional(),
});

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

function getIndustryIdentifier(info: unknown, targetType: "ISBN_10" | "ISBN_13"): string | null {
  if (!Array.isArray(info)) return null;
  const found = info.find((entry): entry is Record<string, unknown> => asRecord(entry) && safeString(entry.type) === targetType);
  return textOrNull(found?.identifier);
}

async function fetchOpenLibrary(isbn: string): Promise<LookupResult | null> {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = (await resp.json()) as Record<string, unknown>;
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
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = (await resp.json()) as Record<string, unknown>;
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

async function lookupIsbn(isbn: string): Promise<LookupResult> {
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

  const merged = mergeResults(openLibrary, googleBooks);
  if (merged) return merged;

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

export const importLibraryIsbns = onRequest(
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

    const parsed = parseBody(importSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
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
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const body = parsed.data as ImportRequest;
    const isbns = Array.isArray(body.isbns) ? body.isbns : [];
    const source = typeof body.source === "string" ? body.source : "csv";
    const cleaned = isbns.map((isbn) => cleanIsbn(String(isbn))).filter(Boolean);
    const deduped = Array.from(new Set(cleaned));

    if (deduped.length === 0) {
      res.status(400).json({ ok: false, message: "Provide at least one ISBN" });
      return;
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
        const searchTokens = buildSearchTokens([
          lookup.title,
          lookup.subtitle,
          ...(lookup.authors ?? []),
          ...(lookup.subjects ?? []),
        ]);

        const docRef = db.collection("libraryItems").doc(itemId);
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
          identifiers: {
            isbn10: lookup.identifiers.isbn10 ?? normalized.isbn10 ?? null,
            isbn13: lookup.identifiers.isbn13 ?? normalized.isbn13 ?? null,
            olid: lookup.identifiers.olid ?? null,
            googleVolumeId: lookup.identifiers.googleVolumeId ?? null,
          },
          source: lookup.source,
          searchTokens,
          metadataSource: source,
          updatedAt: now,
          metadataSnapshot: lookup.raw ?? null,
        };

        if (!snap.exists) {
          await docRef.set({
            ...baseDoc,
            totalCopies: 1,
            availableCopies: 1,
            status: "available",
            createdAt: now,
          });
          created.push(itemId);
        } else {
          await docRef.set(baseDoc, { merge: true });
          updated.push(itemId);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : safeString(error);
        errors.push({ isbn: rawIsbn, message: message || "Import failed" });
      }
    }

    res.status(200).json({
      ok: true,
      requested: capped.length,
      created: created.length,
      updated: updated.length,
      errors,
    });
  }
);

