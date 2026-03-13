import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";

import {
  Timestamp,
  applyCors,
  db,
  enforceRateLimit,
  nowTs,
  parseBody,
  requireAdmin,
  requireAuthUid,
  safeString,
} from "./shared";
import {
  evaluateCommunityContentRisk,
  getCommunitySafetyConfig,
  type CommunityRiskResult,
} from "./communitySafety";

const REGION = "us-central1";
const COMMUNITY_BLOGS_COLLECTION = "communityBlogs";
const COMMUNITY_BLOG_SLUGS_COLLECTION = "communityBlogSlugs";
const COMMUNITY_BLOG_SOURCES_COLLECTION = "communityBlogSources";
const COMMUNITY_BLOG_EXTERNAL_ITEMS_COLLECTION = "communityBlogExternalItems";
const COMMUNITY_BLOG_AI_RATE_LIMIT_KEY = "community_blog_ai_assist";
const COMMUNITY_BLOG_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const COMMUNITY_BLOG_IMAGE_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const COMMUNITY_BLOG_WEBSITE_BASE_URL = "https://monsoonfire.com";
const COMMUNITY_BLOG_EXTERNAL_FETCH_USER_AGENT = "Monsoon Fire Blog Feed Bot/1.0 (+https://monsoonfire.com/blog/)";
const COMMUNITY_BLOG_DISTRIBUTION_CHANNELS = ["facebook_page", "instagram_business"] as const;

export type CommunityBlogStatus = "draft" | "staged" | "published" | "archived" | "deleted";
export type CommunityBlogTonePreset = "studio_notes" | "encouraging" | "announcement" | "spotlight";
export type CommunityBlogAiMode =
  | "topic_ideas"
  | "outline"
  | "title_excerpt"
  | "tone_rewrite"
  | "social_copy"
  | "cta_angle";
export type CommunityBlogMarketingFocus = "studio-services" | "kiln-firing" | "memberships" | "contact";
export type CommunityBlogDistributionChannel = (typeof COMMUNITY_BLOG_DISTRIBUTION_CHANNELS)[number];
export type CommunityBlogDistributionState = "idle" | "published" | "failed" | "unavailable";
export type CommunityBlogSourceStatus = "enabled" | "disabled";
export type CommunityBlogExternalItemStatus = "available" | "featured" | "hidden" | "archived";

type CommunityBlogImage = {
  id: string;
  url: string;
  path: string;
  alt: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  uploadedAtMs: number;
  uploadedByUid: string;
};

type CommunityBlogAuditFields = {
  createdAtMs: number;
  updatedAtMs: number;
  stagedAtMs: number | null;
  publishedAtMs: number | null;
  archivedAtMs: number | null;
  deletedAtMs: number | null;
  createdByUid: string;
  updatedByUid: string;
  authorUid: string;
  authorName: string | null;
  lastStatusChangedByUid: string | null;
  lastPublishOverrideReason: string | null;
  deletedReason: string | null;
};

type CommunityBlogSafetySnapshot = CommunityRiskResult & {
  scannedAtMs: number;
  scannedByUid: string;
  overrideReason: string | null;
};

export type CommunityBlogDistributionRecord = {
  channel: CommunityBlogDistributionChannel;
  status: CommunityBlogDistributionState;
  message: string | null;
  remoteId: string | null;
  permalinkUrl: string | null;
  publishedAtMs: number | null;
  lastAttemptAtMs: number | null;
};

export type CommunityBlogRecord = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  bodyHtml: string;
  featuredImage: CommunityBlogImage | null;
  inlineImages: CommunityBlogImage[];
  tags: string[];
  tonePreset: CommunityBlogTonePreset;
  marketingFocus: CommunityBlogMarketingFocus;
  status: CommunityBlogStatus;
  readingMinutes: number;
  distributions: Partial<Record<CommunityBlogDistributionChannel, CommunityBlogDistributionRecord>>;
  safety: CommunityBlogSafetySnapshot | null;
} & CommunityBlogAuditFields;

export type CommunityBlogPublicPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyHtml: string;
  featuredImage: CommunityBlogImage | null;
  inlineImages: CommunityBlogImage[];
  tags: string[];
  tonePreset: CommunityBlogTonePreset;
  marketingFocus: CommunityBlogMarketingFocus;
  publishedAtMs: number;
  updatedAtMs: number;
  readingMinutes: number;
  authorName: string | null;
  canonicalUrl: string;
};

type CommunityBlogAiSuggestion = {
  id: string;
  title: string;
  excerpt: string | null;
  bodyMarkdown: string | null;
  note: string | null;
};

type CommunityBlogAiResponse = {
  available: boolean;
  mode: CommunityBlogAiMode;
  suggestions: CommunityBlogAiSuggestion[];
  message: string;
  model: { provider: string; version: string } | null;
};

export type CommunityBlogChannelAvailability = {
  channel: CommunityBlogDistributionChannel;
  available: boolean;
  reason: string | null;
};

export type CommunityBlogSourceRecord = {
  id: string;
  title: string;
  feedUrl: string;
  siteUrl: string | null;
  summary: string | null;
  status: CommunityBlogSourceStatus;
  createdAtMs: number;
  updatedAtMs: number;
  createdByUid: string;
  updatedByUid: string;
  lastFetchedAtMs: number | null;
  lastError: string | null;
};

export type CommunityBlogExternalItemRecord = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string | null;
  title: string;
  excerpt: string;
  canonicalUrl: string;
  imageUrl: string | null;
  imageAlt: string | null;
  publishedAtMs: number;
  updatedAtMs: number;
  importedAtMs: number;
  status: CommunityBlogExternalItemStatus;
  authorName: string | null;
  tags: string[];
  studioNote: string | null;
};

export type CommunityBlogPublicExperience = {
  generatedAtMs: number;
  posts: CommunityBlogPublicPost[];
  externalHighlights: CommunityBlogExternalItemRecord[];
};

const communityBlogStatusSchema = z.enum(["draft", "staged", "published", "archived", "deleted"]);
const communityBlogTonePresetSchema = z.enum(["studio_notes", "encouraging", "announcement", "spotlight"]);
const communityBlogMarketingFocusSchema = z.enum(["studio-services", "kiln-firing", "memberships", "contact"]);
const communityBlogDistributionChannelSchema = z.enum(COMMUNITY_BLOG_DISTRIBUTION_CHANNELS);
const communityBlogImageSchema = z.object({
  id: z.string().trim().min(2).max(120),
  url: z.string().trim().url().max(3000),
  path: z.string().trim().min(3).max(400),
  alt: z.string().trim().min(1).max(180),
  caption: z.string().trim().max(280).nullable().optional(),
  width: z.number().int().min(1).max(12000).nullable().optional(),
  height: z.number().int().min(1).max(12000).nullable().optional(),
  uploadedAtMs: z.number().int().min(0).optional(),
  uploadedByUid: z.string().trim().max(200).optional(),
});

const publicGetBySlugSchema = z.object({
  slug: z.string().trim().min(1).max(160),
});

const staffGetSchema = z.object({
  postId: z.string().trim().min(1).max(120),
});

const staffListSchema = z.object({
  includeDeleted: z.boolean().optional(),
  statuses: z.array(communityBlogStatusSchema).max(5).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const staffUpsertSchema = z.object({
  postId: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().min(3).max(140),
  slug: z.string().trim().min(1).max(160).optional().nullable(),
  excerpt: z.string().trim().max(280).optional().nullable(),
  bodyMarkdown: z.string().trim().max(20_000).optional().nullable(),
  featuredImage: communityBlogImageSchema.nullable().optional(),
  inlineImages: z.array(communityBlogImageSchema).max(24).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
  tonePreset: communityBlogTonePresetSchema.optional(),
  marketingFocus: communityBlogMarketingFocusSchema.optional(),
});

const staffSetStatusSchema = z.object({
  postId: z.string().trim().min(1).max(120),
  status: z.enum(["draft", "staged", "published", "archived"]),
  overrideReason: z.string().trim().max(280).optional().nullable(),
});

const staffDeleteSchema = z.object({
  postId: z.string().trim().min(1).max(120),
  reason: z.string().trim().max(280).optional().nullable(),
});

const staffPrepareImageUploadSchema = z.object({
  postId: z.string().trim().min(1).max(120).optional().nullable(),
  fileName: z.string().trim().min(1).max(180),
  contentType: z.string().trim().max(120).optional().nullable(),
});

const communityBlogAiModeSchema = z.enum(["topic_ideas", "outline", "title_excerpt", "tone_rewrite", "social_copy", "cta_angle"]);
const staffAiAssistSchema = z.object({
  mode: communityBlogAiModeSchema,
  title: z.string().trim().max(140).optional().nullable(),
  excerpt: z.string().trim().max(280).optional().nullable(),
  bodyMarkdown: z.string().trim().max(20_000).optional().nullable(),
  selectedText: z.string().trim().max(8_000).optional().nullable(),
  tonePreset: communityBlogTonePresetSchema.optional().nullable(),
  marketingFocus: communityBlogMarketingFocusSchema.optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
  count: z.number().int().min(1).max(6).optional(),
});

const staffSourceListSchema = z.object({
  includeDisabled: z.boolean().optional(),
  limit: z.number().int().min(1).max(60).optional(),
});

const staffSourceUpsertSchema = z.object({
  sourceId: z.string().trim().min(1).max(120).optional().nullable(),
  title: z.string().trim().min(2).max(160),
  feedUrl: z.string().trim().url().max(2000),
  siteUrl: z.string().trim().url().max(2000).optional().nullable(),
  summary: z.string().trim().max(280).optional().nullable(),
  status: z.enum(["enabled", "disabled"]).optional(),
});

const staffSourceRefreshSchema = z.object({
  sourceId: z.string().trim().min(1).max(120).optional().nullable(),
});

const staffExternalHighlightSchema = z.object({
  itemId: z.string().trim().min(1).max(160),
  status: z.enum(["available", "featured", "hidden", "archived"]),
  studioNote: z.string().trim().max(280).optional().nullable(),
});

const staffDistributionPublishSchema = z.object({
  postId: z.string().trim().min(1).max(120),
  channels: z.array(communityBlogDistributionChannelSchema).min(1).max(2),
  captionOverride: z.string().trim().max(2_200).optional().nullable(),
});

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }
  if (value && typeof value === "object") {
    const maybe = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toMillis === "function") {
      return maybe.toMillis();
    }
    if (typeof maybe.seconds === "number") {
      const nanos = typeof maybe.nanoseconds === "number" ? maybe.nanoseconds : 0;
      return Math.floor(maybe.seconds * 1000 + nanos / 1_000_000);
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  return 0;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(raw: string): string {
  return escapeHtml(raw);
}

function normalizeWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function sanitizeFileNameToken(value: string): string {
  const next = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return next || "upload";
}

export function normalizeCommunityBlogSlug(input: string): string {
  const folded = input
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return folded.slice(0, 80) || "studio-note";
}

function normalizeTag(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeTags(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of input) {
    const next = normalizeTag(value);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    tags.push(next);
  }
  return tags.slice(0, 8);
}

function normalizeMarketingFocus(value: string | null | undefined): CommunityBlogMarketingFocus {
  if (value === "kiln-firing" || value === "memberships" || value === "contact") return value;
  return "studio-services";
}

function emptyDistributionRecord(channel: CommunityBlogDistributionChannel): CommunityBlogDistributionRecord {
  return {
    channel,
    status: "idle",
    message: null,
    remoteId: null,
    permalinkUrl: null,
    publishedAtMs: null,
    lastAttemptAtMs: null,
  };
}

function normalizeDistributionRecord(
  channel: CommunityBlogDistributionChannel,
  value: unknown
): CommunityBlogDistributionRecord {
  if (!value || typeof value !== "object") return emptyDistributionRecord(channel);
  const raw = value as Record<string, unknown>;
  const status =
    raw.status === "published" || raw.status === "failed" || raw.status === "unavailable" ? raw.status : "idle";
  return {
    channel,
    status,
    message: normalizeWhitespace(safeString(raw.message).trim()) || null,
    remoteId: normalizeWhitespace(safeString(raw.remoteId).trim()) || null,
    permalinkUrl: sanitizeHref(safeString(raw.permalinkUrl).trim()) || null,
    publishedAtMs: toMillis(raw.publishedAtMs ?? raw.publishedAt) || null,
    lastAttemptAtMs: toMillis(raw.lastAttemptAtMs ?? raw.lastAttemptAt) || null,
  };
}

function normalizeDistributionMap(
  value: unknown
): Partial<Record<CommunityBlogDistributionChannel, CommunityBlogDistributionRecord>> {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const entries = COMMUNITY_BLOG_DISTRIBUTION_CHANNELS.map((channel) => {
    const normalized = normalizeDistributionRecord(channel, raw[channel]);
    return normalized.status === "idle" &&
      !normalized.message &&
      !normalized.remoteId &&
      !normalized.permalinkUrl &&
      !normalized.publishedAtMs &&
      !normalized.lastAttemptAtMs
      ? null
      : [channel, normalized] as const;
  }).filter((entry): entry is readonly [CommunityBlogDistributionChannel, CommunityBlogDistributionRecord] => Boolean(entry));
  return Object.fromEntries(entries);
}

function serializeDistributionMap(
  value: Partial<Record<CommunityBlogDistributionChannel, CommunityBlogDistributionRecord>>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([channel, entry]) => [
      channel,
      {
        channel,
        status: entry?.status ?? "idle",
        message: entry?.message ?? null,
        remoteId: entry?.remoteId ?? null,
        permalinkUrl: entry?.permalinkUrl ?? null,
        publishedAt: entry?.publishedAtMs ? Timestamp.fromMillis(entry.publishedAtMs) : null,
        lastAttemptAt: entry?.lastAttemptAtMs ? Timestamp.fromMillis(entry.lastAttemptAtMs) : null,
      },
    ])
  );
}

export function buildCommunityBlogCanonicalUrl(slug: string): string {
  return `${COMMUNITY_BLOG_WEBSITE_BASE_URL}/blog/${normalizeCommunityBlogSlug(slug)}/`;
}

function normalizeSourceStatus(value: unknown): CommunityBlogSourceStatus {
  return value === "disabled" ? "disabled" : "enabled";
}

function normalizeExternalItemStatus(value: unknown): CommunityBlogExternalItemStatus {
  if (value === "featured" || value === "hidden" || value === "archived") return value;
  return "available";
}

function sanitizeAbsoluteUrl(raw: string | null | undefined): string | null {
  return sanitizeHref(safeString(raw).trim());
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripHtml(raw: string): string {
  return normalizeWhitespace(decodeXmlEntities(raw).replace(/<[^>]+>/g, " "));
}

function truncateText(raw: string, limit: number): string {
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function hashString(raw: string): string {
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function makeExternalItemId(sourceId: string, canonicalUrl: string): string {
  return `${sanitizeFileNameToken(sourceId)}-${hashString(canonicalUrl)}`;
}

function firstXmlTagValue(block: string, tagNames: string[]): string {
  for (const tagName of tagNames) {
    const match = block.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
    if (match?.[1]) return decodeXmlEntities(match[1]).trim();
  }
  return "";
}

function firstXmlAttrValue(block: string, tagName: string, attrName: string): string {
  const match = block.match(new RegExp(`<${tagName}[^>]*\\s${attrName}=["']([^"']+)["'][^>]*>`, "i"));
  return match?.[1] ? decodeXmlEntities(match[1]).trim() : "";
}

function parseFeedDate(raw: string): number {
  const millis = Date.parse(raw);
  return Number.isFinite(millis) ? millis : 0;
}

function estimateReadingMinutes(text: string): number {
  const words = normalizeWhitespace(text).split(" ").filter(Boolean).length;
  if (!words) return 1;
  return Math.max(1, Math.round(words / 190));
}

function sanitizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

type InlineMatch = {
  type: "code" | "link" | "bold" | "italic";
  index: number;
  match: RegExpExecArray;
};

function nextInlineMatch(input: string, fromIndex: number): InlineMatch | null {
  const patterns: Array<{ type: InlineMatch["type"]; regex: RegExp; priority: number }> = [
    { type: "code", regex: /`([^`]+)`/g, priority: 0 },
    { type: "link", regex: /\[([^\]]+)\]\(([^)\s]+)\)/g, priority: 1 },
    { type: "bold", regex: /\*\*([^*]+)\*\*/g, priority: 2 },
    { type: "italic", regex: /\*([^*]+)\*/g, priority: 3 },
  ];

  let winner: InlineMatch | null = null;
  let winnerPriority = Number.POSITIVE_INFINITY;
  for (const entry of patterns) {
    entry.regex.lastIndex = fromIndex;
    const match = entry.regex.exec(input);
    if (!match || typeof match.index !== "number") continue;
    if (
      !winner ||
      match.index < winner.index ||
      (match.index === winner.index && entry.priority < winnerPriority)
    ) {
      winner = { type: entry.type, index: match.index, match };
      winnerPriority = entry.priority;
    }
  }
  return winner;
}

function renderInlineMarkdown(input: string): string {
  if (!input) return "";
  let cursor = 0;
  let html = "";

  while (cursor < input.length) {
    const next = nextInlineMatch(input, cursor);
    if (!next) {
      html += escapeHtml(input.slice(cursor));
      break;
    }

    if (next.index > cursor) {
      html += escapeHtml(input.slice(cursor, next.index));
    }

    const [matched, first, second] = next.match;
    if (next.type === "code") {
      html += `<code>${escapeHtml(first ?? "")}</code>`;
    } else if (next.type === "link") {
      const href = sanitizeHref(second ?? "");
      if (href) {
        html += `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer">${renderInlineMarkdown(
          first ?? ""
        )}</a>`;
      } else {
        html += escapeHtml(matched);
      }
    } else if (next.type === "bold") {
      html += `<strong>${renderInlineMarkdown(first ?? "")}</strong>`;
    } else {
      html += `<em>${renderInlineMarkdown(first ?? "")}</em>`;
    }
    cursor = next.index + matched.length;
  }

  return html;
}

function renderImageBlock(altRaw: string, urlRaw: string): string | null {
  const url = sanitizeHref(urlRaw);
  if (!url) return null;
  const alt = normalizeWhitespace(altRaw) || "Blog image";
  return [
    `<figure class="community-blog-body-figure">`,
    `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}" loading="lazy" />`,
    `<figcaption>${escapeHtml(alt)}</figcaption>`,
    `</figure>`,
  ].join("");
}

export function renderCommunityBlogMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const html: string[] = [];
  let paragraphLines: string[] = [];
  let quoteLines: string[] = [];
  let unorderedItems: string[] = [];
  let orderedItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    html.push(`<p>${renderInlineMarkdown(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    html.push(`<blockquote><p>${quoteLines.map((line) => renderInlineMarkdown(line)).join("<br />")}</p></blockquote>`);
    quoteLines = [];
  };

  const flushUnordered = () => {
    if (!unorderedItems.length) return;
    html.push(`<ul>${unorderedItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    unorderedItems = [];
  };

  const flushOrdered = () => {
    if (!orderedItems.length) return;
    html.push(`<ol>${orderedItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`);
    orderedItems = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushUnordered();
    flushOrdered();
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushAll();
      continue;
    }

    const imageMatch = trimmed.match(/^!\[(.*)\]\(([^)\s]+)\)$/);
    if (imageMatch) {
      flushAll();
      const imageHtml = renderImageBlock(imageMatch[1] ?? "", imageMatch[2] ?? "");
      if (imageHtml) html.push(imageHtml);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushAll();
      const level = Math.min(3, headingMatch[1]?.length ?? 1);
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2] ?? "")}</h${level}>`);
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s+(.+)$/);
    if (quoteMatch) {
      flushParagraph();
      flushUnordered();
      flushOrdered();
      quoteLines.push(quoteMatch[1] ?? "");
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      flushQuote();
      flushOrdered();
      unorderedItems.push(unorderedMatch[1] ?? "");
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      flushQuote();
      flushUnordered();
      orderedItems.push(orderedMatch[1] ?? "");
      continue;
    }

    flushQuote();
    flushUnordered();
    flushOrdered();
    paragraphLines.push(trimmed);
  }

  flushAll();
  return html.join("\n");
}

function plainTextFromMarkdown(markdown: string): string {
  return normalizeWhitespace(
    markdown
      .replace(/\r\n/g, "\n")
      .replace(/!\[[^\]]*]\(([^)\s]+)\)/g, " ")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1")
      .replace(/[*_`>#-]/g, " ")
  );
}

function normalizeExcerpt(input: string | null | undefined, bodyMarkdown: string): string {
  const explicit = normalizeWhitespace(input ?? "");
  if (explicit) return explicit.slice(0, 280);
  const derived = plainTextFromMarkdown(bodyMarkdown);
  return derived.slice(0, 180) || "Studio note";
}

function normalizeCommunityBlogImage(
  value: z.infer<typeof communityBlogImageSchema>,
  actorUid: string
): CommunityBlogImage {
  const uploadedAtMs =
    typeof value.uploadedAtMs === "number" && Number.isFinite(value.uploadedAtMs)
      ? Math.max(0, Math.trunc(value.uploadedAtMs))
      : Date.now();
  return {
    id: value.id.trim(),
    url: value.url.trim(),
    path: value.path.trim(),
    alt: normalizeWhitespace(value.alt),
    caption: normalizeWhitespace(value.caption ?? "") || null,
    width: typeof value.width === "number" && Number.isFinite(value.width) ? Math.trunc(value.width) : null,
    height: typeof value.height === "number" && Number.isFinite(value.height) ? Math.trunc(value.height) : null,
    uploadedAtMs,
    uploadedByUid: safeString(value.uploadedByUid).trim() || actorUid,
  };
}

function normalizeTonePreset(value: string | null | undefined): CommunityBlogTonePreset {
  if (value === "encouraging" || value === "announcement" || value === "spotlight") return value;
  return "studio_notes";
}

function makeCommunityBlogRecord(params: {
  id: string;
  slug: string;
  input: z.infer<typeof staffUpsertSchema>;
  actorUid: string;
  actorName: string | null;
  existing: CommunityBlogRecord | null;
}): CommunityBlogRecord {
  const bodyMarkdown = safeString(params.input.bodyMarkdown).trim();
  const bodyHtml = renderCommunityBlogMarkdown(bodyMarkdown);
  const title = normalizeWhitespace(params.input.title).slice(0, 140);
  const excerpt = normalizeExcerpt(params.input.excerpt, bodyMarkdown);
  const tags = normalizeTags(params.input.tags);
  const tonePreset = normalizeTonePreset(params.input.tonePreset);
  const featuredImage = params.input.featuredImage
    ? normalizeCommunityBlogImage(params.input.featuredImage, params.actorUid)
    : null;
  const inlineImages = Array.isArray(params.input.inlineImages)
    ? params.input.inlineImages.map((image) => normalizeCommunityBlogImage(image, params.actorUid))
    : [];

  const now = Date.now();
  const existingAudit = params.existing;
  return {
    id: params.id,
    slug: params.slug,
    title,
    excerpt,
    bodyMarkdown,
    bodyHtml,
    featuredImage,
    inlineImages,
    tags,
    tonePreset,
    marketingFocus: normalizeMarketingFocus(params.input.marketingFocus ?? existingAudit?.marketingFocus),
    status: existingAudit?.status ?? "draft",
    readingMinutes: estimateReadingMinutes(plainTextFromMarkdown(bodyMarkdown)),
    distributions: existingAudit?.distributions ?? {},
    safety: existingAudit?.safety ?? null,
    createdAtMs: existingAudit?.createdAtMs ?? now,
    updatedAtMs: now,
    stagedAtMs: existingAudit?.stagedAtMs ?? null,
    publishedAtMs: existingAudit?.publishedAtMs ?? null,
    archivedAtMs: existingAudit?.archivedAtMs ?? null,
    deletedAtMs: existingAudit?.deletedAtMs ?? null,
    createdByUid: existingAudit?.createdByUid ?? params.actorUid,
    updatedByUid: params.actorUid,
    authorUid: existingAudit?.authorUid ?? params.actorUid,
    authorName: existingAudit?.authorName ?? params.actorName,
    lastStatusChangedByUid: existingAudit?.lastStatusChangedByUid ?? null,
    lastPublishOverrideReason: existingAudit?.lastPublishOverrideReason ?? null,
    deletedReason: existingAudit?.deletedReason ?? null,
  };
}

function blogRecordToFirestore(record: CommunityBlogRecord): Record<string, unknown> {
  return {
    slug: record.slug,
    title: record.title,
    excerpt: record.excerpt,
    bodyMarkdown: record.bodyMarkdown,
    bodyHtml: record.bodyHtml,
    featuredImage: record.featuredImage ?? null,
    inlineImages: record.inlineImages,
    tags: record.tags,
    tonePreset: record.tonePreset,
    marketingFocus: record.marketingFocus,
    status: record.status,
    readingMinutes: record.readingMinutes,
    distributions: serializeDistributionMap(record.distributions),
    safety: record.safety ?? null,
    createdAt: Timestamp.fromMillis(record.createdAtMs),
    updatedAt: Timestamp.fromMillis(record.updatedAtMs),
    stagedAt: record.stagedAtMs ? Timestamp.fromMillis(record.stagedAtMs) : null,
    publishedAt: record.publishedAtMs ? Timestamp.fromMillis(record.publishedAtMs) : null,
    archivedAt: record.archivedAtMs ? Timestamp.fromMillis(record.archivedAtMs) : null,
    deletedAt: record.deletedAtMs ? Timestamp.fromMillis(record.deletedAtMs) : null,
    createdByUid: record.createdByUid,
    updatedByUid: record.updatedByUid,
    authorUid: record.authorUid,
    authorName: record.authorName,
    lastStatusChangedByUid: record.lastStatusChangedByUid,
    lastPublishOverrideReason: record.lastPublishOverrideReason,
    deletedReason: record.deletedReason,
  };
}

function parseSafetySnapshot(value: unknown): CommunityBlogSafetySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const score = typeof raw.score === "number" && Number.isFinite(raw.score) ? Math.trunc(raw.score) : 0;
  const severity = raw.severity === "high" || raw.severity === "medium" ? raw.severity : "low";
  const flagged = raw.flagged === true;
  const triggers = Array.isArray(raw.triggers)
    ? raw.triggers.filter((entry): entry is CommunityRiskResult["triggers"][number] => Boolean(entry && typeof entry === "object"))
    : [];
  return {
    score,
    severity,
    flagged,
    triggers,
    inspectedUrlCount:
      typeof raw.inspectedUrlCount === "number" && Number.isFinite(raw.inspectedUrlCount)
        ? Math.max(0, Math.trunc(raw.inspectedUrlCount))
        : 0,
    scannedAtMs:
      typeof raw.scannedAtMs === "number" && Number.isFinite(raw.scannedAtMs)
        ? Math.max(0, Math.trunc(raw.scannedAtMs))
        : 0,
    scannedByUid: safeString(raw.scannedByUid).trim(),
    overrideReason: safeString(raw.overrideReason).trim() || null,
  };
}

function parseCommunityBlogImage(value: unknown): CommunityBlogImage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = safeString(raw.id).trim();
  const url = safeString(raw.url).trim();
  const path = safeString(raw.path).trim();
  const alt = normalizeWhitespace(safeString(raw.alt).trim());
  if (!id || !url || !path || !alt) return null;
  return {
    id,
    url,
    path,
    alt,
    caption: normalizeWhitespace(safeString(raw.caption).trim()) || null,
    width: typeof raw.width === "number" && Number.isFinite(raw.width) ? Math.trunc(raw.width) : null,
    height: typeof raw.height === "number" && Number.isFinite(raw.height) ? Math.trunc(raw.height) : null,
    uploadedAtMs: toMillis(raw.uploadedAtMs),
    uploadedByUid: safeString(raw.uploadedByUid).trim() || "",
  };
}

function parseCommunityBlogRecord(id: string, value: Record<string, unknown> | undefined): CommunityBlogRecord | null {
  if (!value) return null;
  const slug = safeString(value.slug).trim();
  const title = safeString(value.title).trim();
  if (!slug || !title) return null;
  return {
    id,
    slug,
    title,
    excerpt: safeString(value.excerpt).trim(),
    bodyMarkdown: safeString(value.bodyMarkdown),
    bodyHtml: safeString(value.bodyHtml),
    featuredImage: parseCommunityBlogImage(value.featuredImage),
    inlineImages: Array.isArray(value.inlineImages)
      ? value.inlineImages.map((entry) => parseCommunityBlogImage(entry)).filter((entry): entry is CommunityBlogImage => Boolean(entry))
      : [],
    tags: Array.isArray(value.tags)
      ? value.tags.map((entry) => safeString(entry).trim()).filter(Boolean)
      : [],
    tonePreset: normalizeTonePreset(safeString(value.tonePreset).trim()),
    marketingFocus: normalizeMarketingFocus(safeString(value.marketingFocus).trim()),
    status:
      value.status === "staged" || value.status === "published" || value.status === "archived" || value.status === "deleted"
        ? value.status
        : "draft",
    readingMinutes:
      typeof value.readingMinutes === "number" && Number.isFinite(value.readingMinutes)
        ? Math.max(1, Math.trunc(value.readingMinutes))
        : estimateReadingMinutes(plainTextFromMarkdown(safeString(value.bodyMarkdown))),
    distributions: normalizeDistributionMap(value.distributions),
    safety: parseSafetySnapshot(value.safety),
    createdAtMs: toMillis(value.createdAt),
    updatedAtMs: toMillis(value.updatedAt),
    stagedAtMs: toMillis(value.stagedAt) || null,
    publishedAtMs: toMillis(value.publishedAt) || null,
    archivedAtMs: toMillis(value.archivedAt) || null,
    deletedAtMs: toMillis(value.deletedAt) || null,
    createdByUid: safeString(value.createdByUid).trim(),
    updatedByUid: safeString(value.updatedByUid).trim(),
    authorUid: safeString(value.authorUid).trim(),
    authorName: safeString(value.authorName).trim() || null,
    lastStatusChangedByUid: safeString(value.lastStatusChangedByUid).trim() || null,
    lastPublishOverrideReason: safeString(value.lastPublishOverrideReason).trim() || null,
    deletedReason: safeString(value.deletedReason).trim() || null,
  };
}

function toPublicCommunityBlog(record: CommunityBlogRecord): CommunityBlogPublicPost {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    excerpt: record.excerpt,
    bodyHtml: record.bodyHtml,
    featuredImage: record.featuredImage,
    inlineImages: record.inlineImages,
    tags: record.tags,
    tonePreset: record.tonePreset,
    marketingFocus: record.marketingFocus,
    publishedAtMs: record.publishedAtMs ?? record.updatedAtMs,
    updatedAtMs: record.updatedAtMs,
    readingMinutes: record.readingMinutes,
    authorName: record.authorName,
    canonicalUrl: buildCommunityBlogCanonicalUrl(record.slug),
  };
}

function sortPostsNewestFirst<T extends { publishedAtMs?: number | null; updatedAtMs: number; createdAtMs?: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aKey = a.publishedAtMs ?? a.updatedAtMs ?? a.createdAtMs ?? 0;
    const bKey = b.publishedAtMs ?? b.updatedAtMs ?? b.createdAtMs ?? 0;
    return bKey - aKey;
  });
}

function parseCommunityBlogSourceRecord(
  id: string,
  value: Record<string, unknown> | undefined
): CommunityBlogSourceRecord | null {
  if (!value) return null;
  const title = normalizeWhitespace(safeString(value.title).trim());
  const feedUrl = sanitizeAbsoluteUrl(safeString(value.feedUrl).trim());
  if (!title || !feedUrl) return null;
  return {
    id,
    title,
    feedUrl,
    siteUrl: sanitizeAbsoluteUrl(safeString(value.siteUrl).trim()) || null,
    summary: normalizeWhitespace(safeString(value.summary).trim()) || null,
    status: normalizeSourceStatus(value.status),
    createdAtMs: toMillis(value.createdAt),
    updatedAtMs: toMillis(value.updatedAt),
    createdByUid: safeString(value.createdByUid).trim(),
    updatedByUid: safeString(value.updatedByUid).trim(),
    lastFetchedAtMs: toMillis(value.lastFetchedAt) || null,
    lastError: normalizeWhitespace(safeString(value.lastError).trim()) || null,
  };
}

function sourceRecordToFirestore(record: CommunityBlogSourceRecord): Record<string, unknown> {
  return {
    title: record.title,
    feedUrl: record.feedUrl,
    siteUrl: record.siteUrl ?? null,
    summary: record.summary ?? null,
    status: record.status,
    createdAt: Timestamp.fromMillis(record.createdAtMs),
    updatedAt: Timestamp.fromMillis(record.updatedAtMs),
    createdByUid: record.createdByUid,
    updatedByUid: record.updatedByUid,
    lastFetchedAt: record.lastFetchedAtMs ? Timestamp.fromMillis(record.lastFetchedAtMs) : null,
    lastError: record.lastError ?? null,
  };
}

function parseCommunityBlogExternalItemRecord(
  id: string,
  value: Record<string, unknown> | undefined
): CommunityBlogExternalItemRecord | null {
  if (!value) return null;
  const title = normalizeWhitespace(safeString(value.title).trim());
  const canonicalUrl = sanitizeAbsoluteUrl(safeString(value.canonicalUrl).trim());
  const sourceId = safeString(value.sourceId).trim();
  if (!title || !canonicalUrl || !sourceId) return null;
  return {
    id,
    sourceId,
    sourceTitle: normalizeWhitespace(safeString(value.sourceTitle).trim()) || "External source",
    sourceUrl: sanitizeAbsoluteUrl(safeString(value.sourceUrl).trim()) || null,
    title,
    excerpt: normalizeWhitespace(safeString(value.excerpt).trim()),
    canonicalUrl,
    imageUrl: sanitizeAbsoluteUrl(safeString(value.imageUrl).trim()) || null,
    imageAlt: normalizeWhitespace(safeString(value.imageAlt).trim()) || null,
    publishedAtMs: toMillis(value.publishedAt),
    updatedAtMs: toMillis(value.updatedAt),
    importedAtMs: toMillis(value.importedAt) || toMillis(value.updatedAt),
    status: normalizeExternalItemStatus(value.status),
    authorName: normalizeWhitespace(safeString(value.authorName).trim()) || null,
    tags: Array.isArray(value.tags)
      ? value.tags.map((entry) => safeString(entry).trim()).filter(Boolean)
      : [],
    studioNote: normalizeWhitespace(safeString(value.studioNote).trim()) || null,
  };
}

function externalItemRecordToFirestore(record: CommunityBlogExternalItemRecord): Record<string, unknown> {
  return {
    sourceId: record.sourceId,
    sourceTitle: record.sourceTitle,
    sourceUrl: record.sourceUrl ?? null,
    title: record.title,
    excerpt: record.excerpt,
    canonicalUrl: record.canonicalUrl,
    imageUrl: record.imageUrl ?? null,
    imageAlt: record.imageAlt ?? null,
    publishedAt: record.publishedAtMs ? Timestamp.fromMillis(record.publishedAtMs) : null,
    updatedAt: Timestamp.fromMillis(record.updatedAtMs),
    importedAt: Timestamp.fromMillis(record.importedAtMs),
    status: record.status,
    authorName: record.authorName ?? null,
    tags: record.tags,
    studioNote: record.studioNote ?? null,
  };
}

function extractFeedItems(xml: string, source: CommunityBlogSourceRecord): CommunityBlogExternalItemRecord[] {
  const rssMatches = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const atomMatches = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  const blocks = rssMatches.length ? rssMatches : atomMatches;
  const now = Date.now();
  const items = blocks
    .map((block): CommunityBlogExternalItemRecord | null => {
      const title = stripHtml(firstXmlTagValue(block, ["title"]));
      const link =
        sanitizeAbsoluteUrl(firstXmlTagValue(block, ["link"])) ||
        sanitizeAbsoluteUrl(firstXmlAttrValue(block, "link", "href")) ||
        sanitizeAbsoluteUrl(firstXmlAttrValue(block, "media:content", "url")) ||
        null;
      if (!title || !link) return null;
      const rawExcerpt = firstXmlTagValue(block, ["description", "summary", "content:encoded", "content"]);
      const excerpt = truncateText(stripHtml(rawExcerpt), 220) || "External studio note";
      const publishedAtMs =
        parseFeedDate(firstXmlTagValue(block, ["pubDate", "published", "updated", "dc:date"])) || now;
      const imageUrl =
        sanitizeAbsoluteUrl(firstXmlAttrValue(block, "media:content", "url")) ||
        sanitizeAbsoluteUrl(firstXmlAttrValue(block, "media:thumbnail", "url")) ||
        sanitizeAbsoluteUrl(firstXmlAttrValue(block, "enclosure", "url")) ||
        null;
      const authorName = stripHtml(firstXmlTagValue(block, ["author", "dc:creator", "name"])) || null;
      const tags = normalizeTags(
        [...block.matchAll(/<(?:category|dc:subject)(?:\s[^>]*)?>([\s\S]*?)<\/(?:category|dc:subject)>/gi)].map((match) =>
          stripHtml(match[1] ?? "")
        )
      );
      return {
        id: makeExternalItemId(source.id, link),
        sourceId: source.id,
        sourceTitle: source.title,
        sourceUrl: source.siteUrl ?? null,
        title,
        excerpt,
        canonicalUrl: link,
        imageUrl,
        imageAlt: imageUrl ? `${title} from ${source.title}` : null,
        publishedAtMs,
        updatedAtMs: now,
        importedAtMs: now,
        status: "available",
        authorName,
        tags,
        studioNote: null,
      };
    })
    .filter((entry): entry is CommunityBlogExternalItemRecord => Boolean(entry));
  return sortPostsNewestFirst(items).slice(0, 24);
}

async function getCommunityBlogSourceById(sourceId: string): Promise<CommunityBlogSourceRecord | null> {
  const snap = await db.collection(COMMUNITY_BLOG_SOURCES_COLLECTION).doc(sourceId).get();
  if (!snap.exists) return null;
  return parseCommunityBlogSourceRecord(snap.id, snap.data() as Record<string, unknown> | undefined);
}

async function getCommunityBlogExternalItemById(itemId: string): Promise<CommunityBlogExternalItemRecord | null> {
  const snap = await db.collection(COMMUNITY_BLOG_EXTERNAL_ITEMS_COLLECTION).doc(itemId).get();
  if (!snap.exists) return null;
  return parseCommunityBlogExternalItemRecord(snap.id, snap.data() as Record<string, unknown> | undefined);
}

async function listCommunityBlogSourceRecords(limitCount = 30): Promise<CommunityBlogSourceRecord[]> {
  const snap = await db.collection(COMMUNITY_BLOG_SOURCES_COLLECTION).limit(limitCount).get();
  return snap.docs
    .map((doc) => parseCommunityBlogSourceRecord(doc.id, doc.data() as Record<string, unknown> | undefined))
    .filter((entry): entry is CommunityBlogSourceRecord => Boolean(entry))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

async function listCommunityBlogExternalItemRecords(limitCount = 80): Promise<CommunityBlogExternalItemRecord[]> {
  const snap = await db.collection(COMMUNITY_BLOG_EXTERNAL_ITEMS_COLLECTION).limit(limitCount).get();
  return sortPostsNewestFirst(
    snap.docs
      .map((doc) => parseCommunityBlogExternalItemRecord(doc.id, doc.data() as Record<string, unknown> | undefined))
      .filter((entry): entry is CommunityBlogExternalItemRecord => Boolean(entry))
  );
}

export async function buildCommunityBlogPublicExperience(): Promise<CommunityBlogPublicExperience> {
  const [rows, externalItems] = await Promise.all([
    listCommunityBlogRecords(120),
    listCommunityBlogExternalItemRecords(120),
  ]);
  const posts = sortPostsNewestFirst(
    rows.filter((row) => row.status === "published" && !row.deletedAtMs).map((row) => toPublicCommunityBlog(row))
  );
  const externalHighlights = sortPostsNewestFirst(
    externalItems.filter((item) => item.status === "featured")
  ).slice(0, 12);
  return {
    generatedAtMs: Date.now(),
    posts,
    externalHighlights,
  };
}

function marketingFocusMeta(focus: CommunityBlogMarketingFocus): { label: string; url: string; cta: string; blurb: string } {
  switch (focus) {
    case "kiln-firing":
      return {
        label: "Kiln firing",
        url: `${COMMUNITY_BLOG_WEBSITE_BASE_URL}/kiln-firing/`,
        cta: "Book firing support",
        blurb: "Need dependable firing help for your next load?",
      };
    case "memberships":
      return {
        label: "Memberships",
        url: `${COMMUNITY_BLOG_WEBSITE_BASE_URL}/memberships/`,
        cta: "See memberships",
        blurb: "Looking for steady studio access and a reliable rhythm?",
      };
    case "contact":
      return {
        label: "Contact",
        url: `${COMMUNITY_BLOG_WEBSITE_BASE_URL}/contact/`,
        cta: "Talk with the studio",
        blurb: "Want to explore a fit, ask a question, or discuss an opportunity?",
      };
    default:
      return {
        label: "Studio services",
        url: `${COMMUNITY_BLOG_WEBSITE_BASE_URL}/services/`,
        cta: "Explore studio services",
        blurb: "See how Monsoon Fire supports production potters and focused makers.",
      };
  }
}

export function buildCommunityBlogMarketingUrl(post: Pick<CommunityBlogRecord, "slug" | "marketingFocus">): string {
  const base = marketingFocusMeta(post.marketingFocus).url;
  const url = new URL(base);
  url.searchParams.set("utm_source", "blog");
  url.searchParams.set("utm_medium", "article_cta");
  url.searchParams.set("utm_campaign", `blog_${normalizeCommunityBlogSlug(post.slug)}`);
  return url.toString();
}

export function buildCommunityBlogDistributionCaption(
  post: Pick<CommunityBlogRecord, "title" | "excerpt" | "slug" | "tags" | "marketingFocus">
): string {
  const summary = normalizeWhitespace(post.excerpt) || post.title;
  const cta = marketingFocusMeta(post.marketingFocus);
  const hashtags = normalizeTags(post.tags).slice(0, 4).map((tag) => `#${tag.replace(/-/g, "")}`);
  return [
    post.title,
    summary,
    `${cta.blurb} ${cta.cta}: ${buildCommunityBlogMarketingUrl(post)}`,
    buildCommunityBlogCanonicalUrl(post.slug),
    hashtags.join(" "),
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function getDistributionConfig() {
  const facebookPageId = safeString(process.env.COMMUNITY_BLOG_FACEBOOK_PAGE_ID).trim();
  const facebookAccessToken = safeString(process.env.COMMUNITY_BLOG_FACEBOOK_ACCESS_TOKEN).trim();
  const instagramBusinessId = safeString(process.env.COMMUNITY_BLOG_INSTAGRAM_BUSINESS_ID).trim();
  const instagramAccessToken = safeString(process.env.COMMUNITY_BLOG_INSTAGRAM_ACCESS_TOKEN || facebookAccessToken).trim();
  return {
    facebookPageId,
    facebookAccessToken,
    instagramBusinessId,
    instagramAccessToken,
  };
}

export function getCommunityBlogDistributionAvailability(
  post?: Pick<CommunityBlogRecord, "featuredImage" | "inlineImages">
): CommunityBlogChannelAvailability[] {
  const config = getDistributionConfig();
  const instagramImageUrl = post?.featuredImage?.url || post?.inlineImages?.[0]?.url || "";
  return [
    {
      channel: "facebook_page",
      available: Boolean(config.facebookPageId && config.facebookAccessToken),
      reason:
        config.facebookPageId && config.facebookAccessToken
          ? null
          : "Set COMMUNITY_BLOG_FACEBOOK_PAGE_ID and COMMUNITY_BLOG_FACEBOOK_ACCESS_TOKEN to enable Facebook publishing.",
    },
    {
      channel: "instagram_business",
      available: Boolean(config.instagramBusinessId && config.instagramAccessToken && instagramImageUrl),
      reason:
        !config.instagramBusinessId || !config.instagramAccessToken
          ? "Set COMMUNITY_BLOG_INSTAGRAM_BUSINESS_ID and COMMUNITY_BLOG_INSTAGRAM_ACCESS_TOKEN to enable Instagram publishing."
          : instagramImageUrl
            ? null
            : "Instagram publishing needs a featured or inline image on the post.",
    },
  ];
}

async function publishCommunityBlogToFacebook(params: {
  post: CommunityBlogRecord;
  caption: string;
}): Promise<CommunityBlogDistributionRecord> {
  const { facebookPageId, facebookAccessToken } = getDistributionConfig();
  const lastAttemptAtMs = Date.now();
  if (!facebookPageId || !facebookAccessToken) {
    return {
      ...emptyDistributionRecord("facebook_page"),
      status: "unavailable",
      message: "Facebook publishing is not configured.",
      lastAttemptAtMs,
    };
  }

  const response = await fetch(`https://graph.facebook.com/v22.0/${facebookPageId}/feed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: params.caption,
      link: buildCommunityBlogCanonicalUrl(params.post.slug),
      access_token: facebookAccessToken,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ...emptyDistributionRecord("facebook_page"),
      status: "failed",
      message: normalizeWhitespace(safeString(payload?.error?.message).trim()) || `Facebook HTTP ${response.status}`,
      lastAttemptAtMs,
    };
  }
  return {
    channel: "facebook_page",
    status: "published",
    message: "Published to Facebook.",
    remoteId: normalizeWhitespace(safeString(payload.id).trim()) || null,
    permalinkUrl: buildCommunityBlogCanonicalUrl(params.post.slug),
    publishedAtMs: lastAttemptAtMs,
    lastAttemptAtMs,
  };
}

async function publishCommunityBlogToInstagram(params: {
  post: CommunityBlogRecord;
  caption: string;
}): Promise<CommunityBlogDistributionRecord> {
  const { instagramBusinessId, instagramAccessToken } = getDistributionConfig();
  const imageUrl = params.post.featuredImage?.url || params.post.inlineImages[0]?.url || "";
  const lastAttemptAtMs = Date.now();
  if (!instagramBusinessId || !instagramAccessToken) {
    return {
      ...emptyDistributionRecord("instagram_business"),
      status: "unavailable",
      message: "Instagram publishing is not configured.",
      lastAttemptAtMs,
    };
  }
  if (!imageUrl) {
    return {
      ...emptyDistributionRecord("instagram_business"),
      status: "unavailable",
      message: "Instagram publishing needs an image.",
      lastAttemptAtMs,
    };
  }

  const createResp = await fetch(`https://graph.facebook.com/v22.0/${instagramBusinessId}/media`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      caption: params.caption,
      access_token: instagramAccessToken,
    }),
  });
  const creationPayload = await createResp.json().catch(() => ({}));
  if (!createResp.ok) {
    return {
      ...emptyDistributionRecord("instagram_business"),
      status: "failed",
      message:
        normalizeWhitespace(safeString(creationPayload?.error?.message).trim()) || `Instagram media HTTP ${createResp.status}`,
      lastAttemptAtMs,
    };
  }
  const creationId = normalizeWhitespace(safeString(creationPayload.id).trim());
  if (!creationId) {
    return {
      ...emptyDistributionRecord("instagram_business"),
      status: "failed",
      message: "Instagram did not return a creation id.",
      lastAttemptAtMs,
    };
  }

  const publishResp = await fetch(`https://graph.facebook.com/v22.0/${instagramBusinessId}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      creation_id: creationId,
      access_token: instagramAccessToken,
    }),
  });
  const publishPayload = await publishResp.json().catch(() => ({}));
  if (!publishResp.ok) {
    return {
      ...emptyDistributionRecord("instagram_business"),
      status: "failed",
      message:
        normalizeWhitespace(safeString(publishPayload?.error?.message).trim()) || `Instagram publish HTTP ${publishResp.status}`,
      lastAttemptAtMs,
    };
  }

  return {
    channel: "instagram_business",
    status: "published",
    message: "Published to Instagram.",
    remoteId: normalizeWhitespace(safeString(publishPayload.id).trim()) || creationId,
    permalinkUrl: buildCommunityBlogCanonicalUrl(params.post.slug),
    publishedAtMs: lastAttemptAtMs,
    lastAttemptAtMs,
  };
}

async function publishCommunityBlogToChannels(params: {
  post: CommunityBlogRecord;
  channels: CommunityBlogDistributionChannel[];
  captionOverride?: string | null;
}): Promise<Partial<Record<CommunityBlogDistributionChannel, CommunityBlogDistributionRecord>>> {
  const caption = normalizeWhitespace(params.captionOverride ?? "") || buildCommunityBlogDistributionCaption(params.post);
  const next = { ...params.post.distributions };
  for (const channel of params.channels) {
    const result =
      channel === "facebook_page"
        ? await publishCommunityBlogToFacebook({ post: params.post, caption })
        : await publishCommunityBlogToInstagram({ post: params.post, caption });
    next[channel] = result;
  }
  return next;
}

async function refreshCommunityBlogSourceFeed(source: CommunityBlogSourceRecord): Promise<CommunityBlogExternalItemRecord[]> {
  const response = await fetch(source.feedUrl, {
    headers: {
      "user-agent": COMMUNITY_BLOG_EXTERNAL_FETCH_USER_AGENT,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`Feed fetch failed with HTTP ${response.status}`);
  }
  const xml = await response.text();
  return extractFeedItems(xml, source);
}

async function getCommunityBlogById(postId: string): Promise<CommunityBlogRecord | null> {
  const snap = await db.collection(COMMUNITY_BLOGS_COLLECTION).doc(postId).get();
  if (!snap.exists) return null;
  return parseCommunityBlogRecord(snap.id, snap.data() as Record<string, unknown> | undefined);
}

async function reserveSlugForPost(params: {
  postId: string;
  slug: string;
  actorUid: string;
  previousSlug: string | null;
}) {
  await db.runTransaction(async (tx) => {
    const nextSlugRef = db.collection(COMMUNITY_BLOG_SLUGS_COLLECTION).doc(params.slug);
    const nextSlugSnap = await tx.get(nextSlugRef);
    const nextSlugData = nextSlugSnap.data() as Record<string, unknown> | undefined;
    const existingPostId = safeString(nextSlugData?.postId).trim();
    if (nextSlugSnap.exists && existingPostId && existingPostId !== params.postId) {
      throw new Error("That blog slug is already in use.");
    }

    tx.set(
      nextSlugRef,
      {
        postId: params.postId,
        slug: params.slug,
        updatedAt: nowTs(),
        updatedByUid: params.actorUid,
      },
      { merge: true }
    );

    if (params.previousSlug && params.previousSlug !== params.slug) {
      const previousRef = db.collection(COMMUNITY_BLOG_SLUGS_COLLECTION).doc(params.previousSlug);
      tx.delete(previousRef);
    }
  });
}

async function listCommunityBlogRecords(limitCount = 120): Promise<CommunityBlogRecord[]> {
  const snap = await db.collection(COMMUNITY_BLOGS_COLLECTION).limit(limitCount).get();
  return snap.docs
    .map((doc) => parseCommunityBlogRecord(doc.id, doc.data() as Record<string, unknown> | undefined))
    .filter((entry): entry is CommunityBlogRecord => Boolean(entry));
}

export async function computeCommunityBlogSafety(params: {
  actorUid: string;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  overrideReason?: string | null;
}): Promise<CommunityBlogSafetySnapshot> {
  const config = await getCommunitySafetyConfig();
  const risk = evaluateCommunityContentRisk(
    {
      textFields: [
        { field: "title", text: params.title },
        { field: "excerpt", text: params.excerpt },
        { field: "bodyMarkdown", text: params.bodyMarkdown },
      ],
    },
    config
  );
  return {
    ...risk,
    scannedAtMs: Date.now(),
    scannedByUid: params.actorUid,
    overrideReason: normalizeWhitespace(params.overrideReason ?? "") || null,
  };
}

export function prepareCommunityBlogStatusChange(params: {
  record: CommunityBlogRecord;
  nextStatus: Exclude<CommunityBlogStatus, "deleted">;
  safety: CommunityBlogSafetySnapshot | null;
  publishKillSwitch: boolean;
  actorUid: string;
  overrideReason?: string | null;
}): CommunityBlogRecord {
  const { record, nextStatus } = params;
  const now = Date.now();
  if (nextStatus === "published") {
    if (params.publishKillSwitch) {
      throw new Error("Publishing is temporarily disabled by the community safety kill switch.");
    }
    if (!record.title.trim() || !record.bodyMarkdown.trim()) {
      throw new Error("Published posts need a title and body.");
    }
    if (params.safety?.severity === "high" && !normalizeWhitespace(params.overrideReason ?? "")) {
      throw new Error("High-risk draft scans require an override reason before publish.");
    }
  }

  return {
    ...record,
    status: nextStatus,
    updatedAtMs: now,
    updatedByUid: params.actorUid,
    lastStatusChangedByUid: params.actorUid,
    safety: params.safety ?? record.safety,
    stagedAtMs: nextStatus === "staged" ? now : record.stagedAtMs,
    publishedAtMs: nextStatus === "published" ? now : nextStatus === "draft" ? null : record.publishedAtMs,
    archivedAtMs: nextStatus === "archived" ? now : nextStatus === "draft" ? null : record.archivedAtMs,
    deletedAtMs: nextStatus === "draft" ? null : record.deletedAtMs,
    lastPublishOverrideReason:
      nextStatus === "published" ? normalizeWhitespace(params.overrideReason ?? "") || null : record.lastPublishOverrideReason,
    deletedReason: nextStatus === "draft" ? null : record.deletedReason,
  };
}

function tonePresetLabel(value: CommunityBlogTonePreset): string {
  switch (value) {
    case "encouraging":
      return "encouraging community voice";
    case "announcement":
      return "announcement";
    case "spotlight":
      return "member or process spotlight";
    default:
      return "practical studio note";
  }
}

function buildAiPrompt(params: z.infer<typeof staffAiAssistSchema>): string {
  const count = params.count ?? 3;
  const tonePreset = normalizeTonePreset(params.tonePreset ?? undefined);
  const marketingFocus = normalizeMarketingFocus(params.marketingFocus ?? undefined);
  const selectedText = safeString(params.selectedText).trim();
  const bodyMarkdown = safeString(params.bodyMarkdown).trim();
  const title = safeString(params.title).trim();
  const excerpt = safeString(params.excerpt).trim();
  const tags = normalizeTags(params.tags ?? []);
  const focusText =
    params.mode === "tone_rewrite"
      ? selectedText || bodyMarkdown
      : bodyMarkdown;

  const taskByMode: Record<CommunityBlogAiMode, string> = {
    topic_ideas: `Generate ${count} short community blog topic ideas.`,
    outline: `Generate ${count} concise outlines for a short community blog post.`,
    title_excerpt: `Generate ${count} title and excerpt options for this short community blog post.`,
    tone_rewrite: `Generate ${count} tone rewrite options for the provided draft text.`,
    social_copy: `Generate ${count} short social caption options for this published studio note.`,
    cta_angle: `Generate ${count} short service-focused CTA angle options tied to this post.`,
  };

  const bodyHintByMode: Record<CommunityBlogAiMode, string> = {
    topic_ideas: "For each suggestion, include a title, excerpt, and a compact markdown draft skeleton.",
    outline: "For each suggestion, include a title, excerpt, and a markdown outline with headings and bullets.",
    title_excerpt: "For each suggestion, include a title and excerpt. You may include bodyMarkdown if it materially improves the option.",
    tone_rewrite: "For each suggestion, include rewritten bodyMarkdown and a short note describing the tone shift.",
    social_copy: "For each suggestion, include a short title label, optional excerpt, and bodyMarkdown with a ready-to-post caption.",
    cta_angle: "For each suggestion, include a short title, excerpt, and optional bodyMarkdown with CTA/supporting copy.",
  };

  return [
    "You are helping Monsoon Fire staff write short portal-and-website community blog posts for ceramic artists.",
    "Keep language human, warm, practical, and compact.",
    `Preferred tone preset: ${tonePresetLabel(tonePreset)}.`,
    `Marketing focus: ${marketingFocus}.`,
    taskByMode[params.mode],
    bodyHintByMode[params.mode],
    "Do not mention AI, policies, or moderation in the draft unless explicitly present in the source material.",
    "Return JSON only with this exact shape:",
    '{ "suggestions": [{ "title": "string", "excerpt": "string|null", "bodyMarkdown": "string|null", "note": "string|null" }] }',
    "",
    `Current title: ${title || "(none yet)"}`,
    `Current excerpt: ${excerpt || "(none yet)"}`,
    `Current tags: ${tags.join(", ") || "(none yet)"}`,
    `Current draft:`,
    focusText || "(empty draft)",
  ].join("\n");
}

function parseAiSuggestions(rawText: string, mode: CommunityBlogAiMode): CommunityBlogAiResponse {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      available: true,
      mode,
      suggestions: [],
      message: "AI returned an empty response.",
      model: null,
    };
  }

  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const candidate = withoutFence.includes("{") ? withoutFence.slice(withoutFence.indexOf("{")) : withoutFence;
  try {
    const parsed = JSON.parse(candidate) as { suggestions?: Array<Record<string, unknown>> };
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .map((entry, index) => ({
            id: `suggestion-${index + 1}`,
            title: normalizeWhitespace(safeString(entry.title).trim()) || `Option ${index + 1}`,
            excerpt: normalizeWhitespace(safeString(entry.excerpt).trim()) || null,
            bodyMarkdown: safeString(entry.bodyMarkdown) || null,
            note: normalizeWhitespace(safeString(entry.note).trim()) || null,
          }))
          .filter((entry) => entry.title || entry.bodyMarkdown || entry.excerpt)
      : [];
    return {
      available: true,
      mode,
      suggestions,
      message: suggestions.length ? "Suggestions ready." : "AI returned no structured suggestions.",
      model: null,
    };
  } catch {
    return {
      available: true,
      mode,
      suggestions: [
        {
          id: "suggestion-1",
          title: "Suggestion",
          excerpt: null,
          bodyMarkdown: trimmed,
          note: "AI returned plain text instead of structured JSON.",
        },
      ],
      message: "AI returned plain text; showing it as one suggestion.",
      model: null,
    };
  }
}

async function runCommunityBlogAiAssist(params: z.infer<typeof staffAiAssistSchema>): Promise<CommunityBlogAiResponse> {
  const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  const model = String(process.env.COMMUNITY_BLOG_AI_MODEL ?? "gpt-4.1-mini").trim();
  if (!apiKey) {
    return {
      available: false,
      mode: params.mode,
      suggestions: [],
      message: "AI assist is unavailable because OPENAI_API_KEY is not configured.",
      model: null,
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: buildAiPrompt(params),
      max_output_tokens: 1_200,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    return {
      available: false,
      mode: params.mode,
      suggestions: [],
      message: `AI assist failed: HTTP ${response.status}${message ? ` - ${message.slice(0, 240)}` : ""}`,
      model: { provider: "openai", version: model },
    };
  }

  const payload = await response.json();
  const text =
    safeString(payload?.output_text).trim() ||
    safeString(
      payload?.output
        ?.flatMap?.((part: { content?: Array<{ text?: string }> }) => part?.content || [])
        ?.map?.((part: { text?: string }) => part?.text || "")
        ?.join(" ")
    ).trim();
  const parsed = parseAiSuggestions(text, params.mode);
  return {
    ...parsed,
    model: { provider: "openai", version: model },
  };
}

export const listPublishedCommunityBlogs = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }

  const experience = await buildCommunityBlogPublicExperience();
  res.status(200).json({
    ok: true,
    generatedAtMs: experience.generatedAtMs,
    posts: experience.posts,
  });
});

export const listPublishedCommunityBlogExperience = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Method not allowed" });
      return;
    }

    const experience = await buildCommunityBlogPublicExperience();
    res.status(200).json({
      ok: true,
      ...experience,
    });
  }
);

export const getPublishedCommunityBlogBySlug = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Method not allowed" });
      return;
    }

    const parsed = parseBody(publicGetBySlugSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const slug = normalizeCommunityBlogSlug(parsed.data.slug);
    const slugSnap = await db.collection(COMMUNITY_BLOG_SLUGS_COLLECTION).doc(slug).get();
    const slugData = slugSnap.data() as Record<string, unknown> | undefined;
    const postId = safeString(slugData?.postId).trim();
    if (!postId) {
      res.status(404).json({ ok: false, message: "Post not found" });
      return;
    }

    const post = await getCommunityBlogById(postId);
    if (!post || post.status !== "published" || post.deletedAtMs) {
      res.status(404).json({ ok: false, message: "Post not found" });
      return;
    }

    res.status(200).json({ ok: true, post: toPublicCommunityBlog(post) });
  }
);

export const staffListCommunityBlogs = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    res.status(admin.httpStatus).json({ ok: false, message: admin.message });
    return;
  }

  const parsed = parseBody(staffListSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const rows = await listCommunityBlogRecords(parsed.data.limit ?? 120);
  const statuses = parsed.data.statuses ?? [];
  const includeDeleted = parsed.data.includeDeleted === true;
  const filtered = sortPostsNewestFirst(
    rows.filter((row) => {
      if (!includeDeleted && row.status === "deleted") return false;
      if (statuses.length && !statuses.includes(row.status)) return false;
      return true;
    })
  );
  const counts = filtered.reduce<Record<CommunityBlogStatus, number>>(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { draft: 0, staged: 0, published: 0, archived: 0, deleted: 0 }
  );

  res.status(200).json({
    ok: true,
    generatedAtMs: Date.now(),
    posts: filtered,
    counts,
    distributionAvailability: getCommunityBlogDistributionAvailability(),
  });
});

export const staffGetCommunityBlog = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    res.status(admin.httpStatus).json({ ok: false, message: admin.message });
    return;
  }

  const parsed = parseBody(staffGetSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const post = await getCommunityBlogById(parsed.data.postId);
  if (!post) {
    res.status(404).json({ ok: false, message: "Post not found" });
    return;
  }

  res.status(200).json({ ok: true, post });
});

export const staffListCommunityBlogSources = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    res.status(admin.httpStatus).json({ ok: false, message: admin.message });
    return;
  }

  const parsed = parseBody(staffSourceListSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const [sources, items] = await Promise.all([
    listCommunityBlogSourceRecords(parsed.data.limit ?? 24),
    listCommunityBlogExternalItemRecords(80),
  ]);
  const includeDisabled = parsed.data.includeDisabled === true;
  res.status(200).json({
    ok: true,
    generatedAtMs: Date.now(),
    sources: sources.filter((source) => includeDisabled || source.status === "enabled"),
    items,
    distributionAvailability: getCommunityBlogDistributionAvailability(),
  });
});

export const staffUpsertCommunityBlogSource = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    res.status(admin.httpStatus).json({ ok: false, message: admin.message });
    return;
  }

  const parsed = parseBody(staffSourceUpsertSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const existing = parsed.data.sourceId ? await getCommunityBlogSourceById(parsed.data.sourceId) : null;
  const now = Date.now();
  const sourceId = parsed.data.sourceId?.trim() || db.collection(COMMUNITY_BLOG_SOURCES_COLLECTION).doc().id;
  const next: CommunityBlogSourceRecord = {
    id: sourceId,
    title: normalizeWhitespace(parsed.data.title),
    feedUrl: parsed.data.feedUrl.trim(),
    siteUrl: sanitizeAbsoluteUrl(parsed.data.siteUrl ?? "") || null,
    summary: normalizeWhitespace(parsed.data.summary ?? "") || null,
    status: parsed.data.status ?? existing?.status ?? "enabled",
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAtMs: now,
    createdByUid: existing?.createdByUid ?? auth.uid,
    updatedByUid: auth.uid,
    lastFetchedAtMs: existing?.lastFetchedAtMs ?? null,
    lastError: existing?.lastError ?? null,
  };

  await db.collection(COMMUNITY_BLOG_SOURCES_COLLECTION).doc(sourceId).set(sourceRecordToFirestore(next), { merge: true });
  res.status(200).json({
    ok: true,
    source: next,
    message: existing ? "Source saved." : "Source added.",
  });
});

export const staffRefreshCommunityBlogSources = onRequest(
  { region: REGION, timeoutSeconds: 120 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Method not allowed" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(admin.httpStatus).json({ ok: false, message: admin.message });
      return;
    }

    const parsed = parseBody(staffSourceRefreshSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const targetSources = parsed.data.sourceId
      ? [await getCommunityBlogSourceById(parsed.data.sourceId)].filter((entry): entry is CommunityBlogSourceRecord => Boolean(entry))
      : (await listCommunityBlogSourceRecords(30)).filter((entry) => entry.status === "enabled");
    if (parsed.data.sourceId && targetSources.length === 0) {
      res.status(404).json({ ok: false, message: "Source not found" });
      return;
    }

    const refreshed: CommunityBlogSourceRecord[] = [];
    const imported: CommunityBlogExternalItemRecord[] = [];

    for (const source of targetSources) {
      try {
        const items = await refreshCommunityBlogSourceFeed(source);
        for (const item of items) {
          const existingItem = await getCommunityBlogExternalItemById(item.id);
          const nextItem: CommunityBlogExternalItemRecord = {
            ...item,
            status: existingItem?.status ?? item.status,
            studioNote: existingItem?.studioNote ?? item.studioNote,
            importedAtMs: existingItem?.importedAtMs ?? item.importedAtMs,
          };
          await db.collection(COMMUNITY_BLOG_EXTERNAL_ITEMS_COLLECTION).doc(nextItem.id).set(externalItemRecordToFirestore(nextItem), {
            merge: true,
          });
          imported.push(nextItem);
        }
        const refreshedSource: CommunityBlogSourceRecord = {
          ...source,
          updatedAtMs: Date.now(),
          updatedByUid: auth.uid,
          lastFetchedAtMs: Date.now(),
          lastError: null,
        };
        await db
          .collection(COMMUNITY_BLOG_SOURCES_COLLECTION)
          .doc(source.id)
          .set(sourceRecordToFirestore(refreshedSource), { merge: true });
        refreshed.push(refreshedSource);
      } catch (error: unknown) {
        const nextError = error instanceof Error ? error.message : String(error);
        const erroredSource: CommunityBlogSourceRecord = {
          ...source,
          updatedAtMs: Date.now(),
          updatedByUid: auth.uid,
          lastError: nextError,
        };
        await db
          .collection(COMMUNITY_BLOG_SOURCES_COLLECTION)
          .doc(source.id)
          .set(sourceRecordToFirestore(erroredSource), { merge: true });
        refreshed.push(erroredSource);
      }
    }

    res.status(200).json({
      ok: true,
      generatedAtMs: Date.now(),
      sources: refreshed,
      items: sortPostsNewestFirst(imported),
      message: `Refreshed ${refreshed.length} source${refreshed.length === 1 ? "" : "s"}.`,
    });
  }
);

export const staffSetCommunityBlogExternalHighlight = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Method not allowed" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(admin.httpStatus).json({ ok: false, message: admin.message });
      return;
    }

    const parsed = parseBody(staffExternalHighlightSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const existing = await getCommunityBlogExternalItemById(parsed.data.itemId);
    if (!existing) {
      res.status(404).json({ ok: false, message: "External item not found" });
      return;
    }
    const next: CommunityBlogExternalItemRecord = {
      ...existing,
      status: parsed.data.status,
      studioNote: normalizeWhitespace(parsed.data.studioNote ?? "") || null,
      updatedAtMs: Date.now(),
    };
    await db.collection(COMMUNITY_BLOG_EXTERNAL_ITEMS_COLLECTION).doc(existing.id).set(externalItemRecordToFirestore(next), {
      merge: true,
    });
    res.status(200).json({
      ok: true,
      item: next,
      message: parsed.data.status === "featured" ? "External highlight featured." : "External highlight updated.",
    });
  }
);

export const staffUpsertCommunityBlog = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    res.status(admin.httpStatus).json({ ok: false, message: admin.message });
    return;
  }

  const parsed = parseBody(staffUpsertSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const input = parsed.data;
  const postId = input.postId?.trim() || db.collection(COMMUNITY_BLOGS_COLLECTION).doc().id;
  const existing = input.postId ? await getCommunityBlogById(postId) : null;
  const slug = normalizeCommunityBlogSlug(input.slug ?? input.title);

  try {
    await reserveSlugForPost({
      postId,
      slug,
      actorUid: auth.uid,
      previousSlug: existing?.slug ?? null,
    });
  } catch (error: unknown) {
    res.status(409).json({
      ok: false,
      message: error instanceof Error ? error.message : "That blog slug is already in use.",
    });
    return;
  }

  const record = makeCommunityBlogRecord({
    id: postId,
    slug,
    input,
    actorUid: auth.uid,
    actorName: safeString(auth.decoded.name).trim() || safeString(auth.decoded.email).trim() || null,
    existing,
  });

  await db.collection(COMMUNITY_BLOGS_COLLECTION).doc(postId).set(blogRecordToFirestore(record), { merge: true });
  res.status(200).json({
    ok: true,
    post: record,
    message: existing ? "Draft saved." : "Draft created.",
  });
});

export const staffSetCommunityBlogStatus = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Method not allowed" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(admin.httpStatus).json({ ok: false, message: admin.message });
      return;
    }

    const parsed = parseBody(staffSetStatusSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const existing = await getCommunityBlogById(parsed.data.postId);
    if (!existing) {
      res.status(404).json({ ok: false, message: "Post not found" });
      return;
    }

    const config = await getCommunitySafetyConfig();
    const safety = await computeCommunityBlogSafety({
      actorUid: auth.uid,
      title: existing.title,
      excerpt: existing.excerpt,
      bodyMarkdown: existing.bodyMarkdown,
      overrideReason: parsed.data.overrideReason ?? null,
    });

    let next: CommunityBlogRecord;
    try {
      next = prepareCommunityBlogStatusChange({
        record: existing,
        nextStatus: parsed.data.status,
        safety,
        publishKillSwitch: config.publishKillSwitch,
        actorUid: auth.uid,
        overrideReason: parsed.data.overrideReason ?? null,
      });
    } catch (error: unknown) {
      res.status(400).json({
        ok: false,
        message: error instanceof Error ? error.message : "Could not change status.",
        safety,
      });
      return;
    }

    await db.collection(COMMUNITY_BLOGS_COLLECTION).doc(existing.id).set(blogRecordToFirestore(next), { merge: true });
    res.status(200).json({
      ok: true,
      post: next,
      safety,
      message:
        parsed.data.status === "published"
          ? "Post published."
          : parsed.data.status === "staged"
            ? "Post staged."
            : parsed.data.status === "archived"
              ? "Post archived."
              : "Post returned to draft.",
    });
  }
);

export const staffDeleteCommunityBlog = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    res.status(admin.httpStatus).json({ ok: false, message: admin.message });
    return;
  }

  const parsed = parseBody(staffDeleteSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  const existing = await getCommunityBlogById(parsed.data.postId);
  if (!existing) {
    res.status(404).json({ ok: false, message: "Post not found" });
    return;
  }

  const nowMs = Date.now();
  const next: CommunityBlogRecord = {
    ...existing,
    status: "deleted",
    updatedAtMs: nowMs,
    updatedByUid: auth.uid,
    deletedAtMs: nowMs,
    lastStatusChangedByUid: auth.uid,
    deletedReason: normalizeWhitespace(parsed.data.reason ?? "") || null,
  };

  await db.collection(COMMUNITY_BLOGS_COLLECTION).doc(existing.id).set(blogRecordToFirestore(next), { merge: true });
  res.status(200).json({ ok: true, post: next, message: "Post deleted." });
});

export const staffPublishCommunityBlogDistribution = onRequest(
  { region: REGION, timeoutSeconds: 120 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Method not allowed" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(admin.httpStatus).json({ ok: false, message: admin.message });
      return;
    }

    const parsed = parseBody(staffDistributionPublishSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const existing = await getCommunityBlogById(parsed.data.postId);
    if (!existing) {
      res.status(404).json({ ok: false, message: "Post not found" });
      return;
    }
    if (existing.status !== "published" || existing.deletedAtMs) {
      res.status(400).json({ ok: false, message: "Only published posts can be distributed." });
      return;
    }

    const distributions = await publishCommunityBlogToChannels({
      post: existing,
      channels: parsed.data.channels,
      captionOverride: parsed.data.captionOverride ?? null,
    });
    const next: CommunityBlogRecord = {
      ...existing,
      distributions,
      updatedAtMs: Date.now(),
      updatedByUid: auth.uid,
    };

    await db.collection(COMMUNITY_BLOGS_COLLECTION).doc(existing.id).set(blogRecordToFirestore(next), { merge: true });
    res.status(200).json({
      ok: true,
      post: next,
      distributionAvailability: getCommunityBlogDistributionAvailability(next),
      message: "Distribution update complete.",
    });
  }
);

export const staffPrepareCommunityBlogImageUpload = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Method not allowed" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(admin.httpStatus).json({ ok: false, message: admin.message });
      return;
    }

    const parsed = parseBody(staffPrepareImageUploadSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const imageId = db.collection(COMMUNITY_BLOGS_COLLECTION).doc().id;
    const extension = parsed.data.fileName.includes(".")
      ? sanitizeFileNameToken(parsed.data.fileName.split(".").slice(-1)[0] ?? "")
      : "";
    const fileName = sanitizeFileNameToken(parsed.data.fileName.replace(/\.[^.]+$/, ""));
    const suffix = extension ? `${fileName}.${extension}` : fileName;
    const postSegment = parsed.data.postId?.trim() || "draft";
    const storagePath = `communityBlogs/${sanitizeFileNameToken(auth.uid)}/${sanitizeFileNameToken(postSegment)}/${Date.now()}-${imageId}-${suffix}`;

    res.status(200).json({
      ok: true,
      imageId,
      storagePath,
      maxBytes: COMMUNITY_BLOG_IMAGE_MAX_BYTES,
      allowedContentTypes: COMMUNITY_BLOG_IMAGE_ALLOWED_TYPES,
      contentTypeHint: safeString(parsed.data.contentType).trim() || null,
    });
  }
);

export const staffAssistCommunityBlog = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, message: "Method not allowed" });
    return;
  }

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }
  const admin = await requireAdmin(req);
  if (!admin.ok) {
    res.status(admin.httpStatus).json({ ok: false, message: admin.message });
    return;
  }

  const limit = await enforceRateLimit({
    req,
    key: COMMUNITY_BLOG_AI_RATE_LIMIT_KEY,
    max: 10,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    res.status(429).json({
      ok: false,
      message: `AI assist is cooling down. Try again in ${Math.ceil(limit.retryAfterMs / 1000)} seconds.`,
    });
    return;
  }

  const parsed = parseBody(staffAiAssistSchema, req.body ?? {});
  if (!parsed.ok) {
    res.status(400).json({ ok: false, message: parsed.message });
    return;
  }

  try {
    const ai = await runCommunityBlogAiAssist(parsed.data);
    res.status(200).json({
      ok: true,
      ...ai,
      generatedAtMs: Date.now(),
    });
  } catch (error: unknown) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "AI assist failed.",
      available: false,
      mode: parsed.data.mode,
      suggestions: [],
    });
  }
});
