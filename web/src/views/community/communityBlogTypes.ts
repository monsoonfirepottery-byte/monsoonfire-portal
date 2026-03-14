export type CommunityBlogStatus = "draft" | "staged" | "published" | "archived" | "deleted";
export type CommunityBlogTonePreset = "studio_notes" | "encouraging" | "announcement" | "spotlight";
export type CommunityBlogAiMode = "topic_ideas" | "outline" | "title_excerpt" | "tone_rewrite" | "social_copy" | "cta_angle";
export type CommunityBlogMarketingFocus = "studio-services" | "kiln-firing" | "memberships" | "contact";
export type CommunityBlogDistributionChannel = "facebook_page" | "instagram_business";
export type CommunityBlogDistributionState = "idle" | "published" | "failed" | "unavailable";
export type CommunityBlogSourceStatus = "enabled" | "disabled";
export type CommunityBlogExternalItemStatus = "available" | "featured" | "hidden" | "archived";

export type CommunityBlogImage = {
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

export type CommunityBlogSafety = {
  score: number;
  severity: "low" | "medium" | "high";
  flagged: boolean;
  inspectedUrlCount: number;
  scannedAtMs: number;
  scannedByUid: string;
  overrideReason: string | null;
};

export type CommunityBlogPost = {
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

export type CommunityBlogDistributionRecord = {
  channel: CommunityBlogDistributionChannel;
  status: CommunityBlogDistributionState;
  message: string | null;
  remoteId: string | null;
  permalinkUrl: string | null;
  publishedAtMs: number | null;
  lastAttemptAtMs: number | null;
};

export type CommunityBlogChannelAvailability = {
  channel: CommunityBlogDistributionChannel;
  available: boolean;
  reason: string | null;
};

export type CommunityBlogStaffPost = CommunityBlogPost & {
  bodyMarkdown: string;
  status: CommunityBlogStatus;
  createdAtMs: number;
  stagedAtMs: number | null;
  archivedAtMs: number | null;
  deletedAtMs: number | null;
  createdByUid: string;
  updatedByUid: string;
  authorUid: string;
  lastStatusChangedByUid: string | null;
  lastPublishOverrideReason: string | null;
  deletedReason: string | null;
  distributions: Partial<Record<CommunityBlogDistributionChannel, CommunityBlogDistributionRecord>>;
  safety: CommunityBlogSafety | null;
};

export type CommunityBlogSource = {
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

export type CommunityBlogExternalHighlight = {
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

export const COMMUNITY_BLOGS_LIST_PUBLISHED_FN = "listPublishedCommunityBlogs";
export const COMMUNITY_BLOGS_LIST_EXPERIENCE_FN = "listPublishedCommunityBlogExperience";
export const COMMUNITY_BLOGS_GET_PUBLISHED_FN = "getPublishedCommunityBlogBySlug";
export const COMMUNITY_BLOGS_STAFF_LIST_FN = "staffListCommunityBlogs";
export const COMMUNITY_BLOGS_STAFF_GET_FN = "staffGetCommunityBlog";
export const COMMUNITY_BLOGS_STAFF_UPSERT_FN = "staffUpsertCommunityBlog";
export const COMMUNITY_BLOGS_STAFF_SET_STATUS_FN = "staffSetCommunityBlogStatus";
export const COMMUNITY_BLOGS_STAFF_DELETE_FN = "staffDeleteCommunityBlog";
export const COMMUNITY_BLOGS_STAFF_PREPARE_IMAGE_FN = "staffPrepareCommunityBlogImageUpload";
export const COMMUNITY_BLOGS_STAFF_AI_ASSIST_FN = "staffAssistCommunityBlog";
export const COMMUNITY_BLOGS_STAFF_LIST_SOURCES_FN = "staffListCommunityBlogSources";
export const COMMUNITY_BLOGS_STAFF_UPSERT_SOURCE_FN = "staffUpsertCommunityBlogSource";
export const COMMUNITY_BLOGS_STAFF_REFRESH_SOURCES_FN = "staffRefreshCommunityBlogSources";
export const COMMUNITY_BLOGS_STAFF_SET_EXTERNAL_FN = "staffSetCommunityBlogExternalHighlight";
export const COMMUNITY_BLOGS_STAFF_PUBLISH_DISTRIBUTION_FN = "staffPublishCommunityBlogDistribution";

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (value && typeof value === "object") {
    const maybe = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    if (typeof maybe.seconds === "number") {
      const nanos = typeof maybe.nanoseconds === "number" ? maybe.nanoseconds : 0;
      return Math.floor(maybe.seconds * 1000 + nanos / 1_000_000);
    }
  }
  return 0;
}

function normalizeTonePreset(value: unknown): CommunityBlogTonePreset {
  if (value === "encouraging" || value === "announcement" || value === "spotlight") return value;
  return "studio_notes";
}

function normalizeMarketingFocus(value: unknown): CommunityBlogMarketingFocus {
  if (value === "kiln-firing" || value === "memberships" || value === "contact") return value;
  return "studio-services";
}

function normalizeStatus(value: unknown): CommunityBlogStatus {
  if (value === "staged" || value === "published" || value === "archived" || value === "deleted") return value;
  return "draft";
}

function normalizeDistributionState(value: unknown): CommunityBlogDistributionState {
  if (value === "published" || value === "failed" || value === "unavailable") return value;
  return "idle";
}

function normalizeDistributionRecord(
  channel: CommunityBlogDistributionChannel,
  value: unknown
): CommunityBlogDistributionRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    channel,
    status: normalizeDistributionState(raw.status),
    message: str(raw.message).trim() || null,
    remoteId: str(raw.remoteId).trim() || null,
    permalinkUrl: str(raw.permalinkUrl).trim() || null,
    publishedAtMs: toMs(raw.publishedAt) || toMs(raw.publishedAtMs) || null,
    lastAttemptAtMs: toMs(raw.lastAttemptAt) || toMs(raw.lastAttemptAtMs) || null,
  };
}

function normalizeDistributionMap(
  value: unknown
): Partial<Record<CommunityBlogDistributionChannel, CommunityBlogDistributionRecord>> {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const next: Partial<Record<CommunityBlogDistributionChannel, CommunityBlogDistributionRecord>> = {};
  (["facebook_page", "instagram_business"] as CommunityBlogDistributionChannel[]).forEach((channel) => {
    const normalized = normalizeDistributionRecord(channel, raw[channel]);
    if (normalized) next[channel] = normalized;
  });
  return next;
}

function normalizeSourceStatus(value: unknown): CommunityBlogSourceStatus {
  return value === "disabled" ? "disabled" : "enabled";
}

function normalizeExternalStatus(value: unknown): CommunityBlogExternalItemStatus {
  if (value === "featured" || value === "hidden" || value === "archived") return value;
  return "available";
}

function normalizeImage(value: unknown): CommunityBlogImage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = str(raw.id).trim();
  const url = str(raw.url).trim();
  const path = str(raw.path).trim();
  const alt = str(raw.alt).trim();
  if (!id || !url || !path || !alt) return null;
  return {
    id,
    url,
    path,
    alt,
    caption: str(raw.caption).trim() || null,
    width: typeof raw.width === "number" && Number.isFinite(raw.width) ? Math.trunc(raw.width) : null,
    height: typeof raw.height === "number" && Number.isFinite(raw.height) ? Math.trunc(raw.height) : null,
    uploadedAtMs: toMs(raw.uploadedAtMs),
    uploadedByUid: str(raw.uploadedByUid).trim(),
  };
}

function normalizeSafety(value: unknown): CommunityBlogSafety | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    score: typeof raw.score === "number" && Number.isFinite(raw.score) ? Math.trunc(raw.score) : 0,
    severity: raw.severity === "high" || raw.severity === "medium" ? raw.severity : "low",
    flagged: raw.flagged === true,
    inspectedUrlCount:
      typeof raw.inspectedUrlCount === "number" && Number.isFinite(raw.inspectedUrlCount)
        ? Math.max(0, Math.trunc(raw.inspectedUrlCount))
        : 0,
    scannedAtMs: toMs(raw.scannedAtMs),
    scannedByUid: str(raw.scannedByUid).trim(),
    overrideReason: str(raw.overrideReason).trim() || null,
  };
}

export function normalizeCommunityBlogPost(row: Record<string, unknown>): CommunityBlogPost {
  return {
    id: str(row.id),
    slug: str(row.slug),
    title: str(row.title) || "Studio note",
    excerpt: str(row.excerpt),
    bodyHtml: str(row.bodyHtml),
    featuredImage: normalizeImage(row.featuredImage),
    inlineImages: Array.isArray(row.inlineImages)
      ? row.inlineImages.map((entry) => normalizeImage(entry)).filter((entry): entry is CommunityBlogImage => Boolean(entry))
      : [],
    tags: Array.isArray(row.tags) ? row.tags.map((entry) => str(entry).trim()).filter(Boolean) : [],
    tonePreset: normalizeTonePreset(row.tonePreset),
    marketingFocus: normalizeMarketingFocus(row.marketingFocus),
    publishedAtMs: toMs(row.publishedAt) || toMs(row.publishedAtMs) || toMs(row.updatedAt) || toMs(row.updatedAtMs),
    updatedAtMs: toMs(row.updatedAt) || toMs(row.updatedAtMs),
    readingMinutes:
      typeof row.readingMinutes === "number" && Number.isFinite(row.readingMinutes)
        ? Math.max(1, Math.trunc(row.readingMinutes))
        : 1,
    authorName: str(row.authorName).trim() || null,
    canonicalUrl: str(row.canonicalUrl).trim() || `https://monsoonfire.com/blog/${str(row.slug).trim()}/`,
  };
}

export function normalizeCommunityBlogStaffPost(row: Record<string, unknown>): CommunityBlogStaffPost {
  const published = normalizeCommunityBlogPost(row);
  return {
    ...published,
    bodyMarkdown: str(row.bodyMarkdown),
    status: normalizeStatus(row.status),
    createdAtMs: toMs(row.createdAt) || toMs(row.createdAtMs),
    stagedAtMs: toMs(row.stagedAt) || toMs(row.stagedAtMs) || null,
    archivedAtMs: toMs(row.archivedAt) || toMs(row.archivedAtMs) || null,
    deletedAtMs: toMs(row.deletedAt) || toMs(row.deletedAtMs) || null,
    createdByUid: str(row.createdByUid),
    updatedByUid: str(row.updatedByUid),
    authorUid: str(row.authorUid),
    lastStatusChangedByUid: str(row.lastStatusChangedByUid).trim() || null,
    lastPublishOverrideReason: str(row.lastPublishOverrideReason).trim() || null,
    deletedReason: str(row.deletedReason).trim() || null,
    distributions: normalizeDistributionMap(row.distributions),
    safety: normalizeSafety(row.safety),
  };
}

export function normalizeCommunityBlogSource(row: Record<string, unknown>): CommunityBlogSource {
  return {
    id: str(row.id),
    title: str(row.title).trim() || "External source",
    feedUrl: str(row.feedUrl).trim(),
    siteUrl: str(row.siteUrl).trim() || null,
    summary: str(row.summary).trim() || null,
    status: normalizeSourceStatus(row.status),
    createdAtMs: toMs(row.createdAt) || toMs(row.createdAtMs),
    updatedAtMs: toMs(row.updatedAt) || toMs(row.updatedAtMs),
    createdByUid: str(row.createdByUid).trim(),
    updatedByUid: str(row.updatedByUid).trim(),
    lastFetchedAtMs: toMs(row.lastFetchedAt) || toMs(row.lastFetchedAtMs) || null,
    lastError: str(row.lastError).trim() || null,
  };
}

export function normalizeCommunityBlogExternalHighlight(row: Record<string, unknown>): CommunityBlogExternalHighlight {
  return {
    id: str(row.id),
    sourceId: str(row.sourceId).trim(),
    sourceTitle: str(row.sourceTitle).trim() || "External source",
    sourceUrl: str(row.sourceUrl).trim() || null,
    title: str(row.title).trim() || "External highlight",
    excerpt: str(row.excerpt).trim(),
    canonicalUrl: str(row.canonicalUrl).trim(),
    imageUrl: str(row.imageUrl).trim() || null,
    imageAlt: str(row.imageAlt).trim() || null,
    publishedAtMs: toMs(row.publishedAt) || toMs(row.publishedAtMs),
    updatedAtMs: toMs(row.updatedAt) || toMs(row.updatedAtMs),
    importedAtMs: toMs(row.importedAt) || toMs(row.importedAtMs),
    status: normalizeExternalStatus(row.status),
    authorName: str(row.authorName).trim() || null,
    tags: Array.isArray(row.tags) ? row.tags.map((entry) => str(entry).trim()).filter(Boolean) : [],
    studioNote: str(row.studioNote).trim() || null,
  };
}

export function normalizeCommunityBlogChannelAvailability(row: Record<string, unknown>): CommunityBlogChannelAvailability {
  const channelRaw = str(row.channel).trim();
  return {
    channel: channelRaw === "instagram_business" ? "instagram_business" : "facebook_page",
    available: row.available === true,
    reason: str(row.reason).trim() || null,
  };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
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
  let priority = Number.POSITIVE_INFINITY;
  for (const entry of patterns) {
    entry.regex.lastIndex = fromIndex;
    const match = entry.regex.exec(input);
    if (!match || typeof match.index !== "number") continue;
    if (!winner || match.index < winner.index || (match.index === winner.index && entry.priority < priority)) {
      winner = { type: entry.type, index: match.index, match };
      priority = entry.priority;
    }
  }
  return winner;
}

function renderInlineMarkdown(input: string): string {
  let cursor = 0;
  let html = "";
  while (cursor < input.length) {
    const next = nextInlineMatch(input, cursor);
    if (!next) {
      html += escapeHtml(input.slice(cursor));
      break;
    }
    if (next.index > cursor) html += escapeHtml(input.slice(cursor, next.index));
    const [matched, first, second] = next.match;
    if (next.type === "code") {
      html += `<code>${escapeHtml(first ?? "")}</code>`;
    } else if (next.type === "link") {
      const href = sanitizeHref(second ?? "");
      html += href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${renderInlineMarkdown(first ?? "")}</a>`
        : escapeHtml(matched);
    } else if (next.type === "bold") {
      html += `<strong>${renderInlineMarkdown(first ?? "")}</strong>`;
    } else {
      html += `<em>${renderInlineMarkdown(first ?? "")}</em>`;
    }
    cursor = next.index + matched.length;
  }
  return html;
}

export function renderCommunityBlogPreview(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  const lines = normalized.split("\n");
  const html: string[] = [];
  let paragraphLines: string[] = [];
  let quoteLines: string[] = [];
  let listItems: string[] = [];

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
  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushAll();
      continue;
    }
    const imageMatch = trimmed.match(/^!\[(.*)\]\(([^)\s]+)\)$/);
    if (imageMatch) {
      flushAll();
      const href = sanitizeHref(imageMatch[2] ?? "");
      if (href) {
        const alt = imageMatch[1]?.trim() || "Blog image";
        html.push(
          `<figure class="community-blog-body-figure"><img src="${escapeHtml(href)}" alt="${escapeHtml(
            alt
          )}" loading="lazy" /><figcaption>${escapeHtml(alt)}</figcaption></figure>`
        );
      }
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
      flushList();
      quoteLines.push(quoteMatch[1] ?? "");
      continue;
    }
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      flushQuote();
      listItems.push(listMatch[1] ?? "");
      continue;
    }
    flushQuote();
    flushList();
    paragraphLines.push(trimmed);
  }
  flushAll();
  return html.join("\n");
}

export function parseCommunityBlogTagsInput(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const token of input.split(",")) {
    const next = token
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!next || seen.has(next)) continue;
    seen.add(next);
    tags.push(next);
  }
  return tags.slice(0, 8);
}

export function formatCommunityBlogDate(ms: number): string {
  if (!ms) return "Unscheduled";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function communityBlogMarketingFocusLabel(value: CommunityBlogMarketingFocus): string {
  switch (value) {
    case "kiln-firing":
      return "Kiln firing";
    case "memberships":
      return "Memberships";
    case "contact":
      return "Contact";
    default:
      return "Studio services";
  }
}

export function sortCommunityBlogStaffPosts(posts: CommunityBlogStaffPost[]): CommunityBlogStaffPost[] {
  return [...posts].sort((a, b) => {
    const aKey = a.publishedAtMs || a.updatedAtMs || a.createdAtMs;
    const bKey = b.publishedAtMs || b.updatedAtMs || b.createdAtMs;
    return bKey - aKey;
  });
}

export const COMMUNITY_BLOG_TONE_OPTIONS: Array<{ value: CommunityBlogTonePreset; label: string; help: string }> = [
  { value: "studio_notes", label: "Studio notes", help: "Practical and direct for process updates." },
  { value: "encouraging", label: "Encouraging", help: "Warm and community-forward without sounding syrupy." },
  { value: "announcement", label: "Announcement", help: "Clear, concise, and operational." },
  { value: "spotlight", label: "Spotlight", help: "A little more narrative for people or process features." },
];

export const COMMUNITY_BLOG_AI_MODES: Array<{ value: CommunityBlogAiMode; label: string; help: string }> = [
  { value: "topic_ideas", label: "Topic ideas", help: "Find fast post ideas from the current angle." },
  { value: "outline", label: "Outline", help: "Sketch a short structure you can publish quickly." },
  { value: "title_excerpt", label: "Title + excerpt", help: "Generate sharper packaging for the current draft." },
  { value: "tone_rewrite", label: "Tone rewrite", help: "Rewrite selected text or the whole draft." },
  { value: "social_copy", label: "Social copy", help: "Generate ready-to-post social caption options." },
  { value: "cta_angle", label: "CTA angle", help: "Brainstorm service-first calls to action from the draft." },
];

export const COMMUNITY_BLOG_MARKETING_OPTIONS: Array<{ value: CommunityBlogMarketingFocus; label: string; help: string }> = [
  { value: "studio-services", label: "Studio services", help: "General studio access, production support, and resources." },
  { value: "kiln-firing", label: "Kiln firing", help: "Guide readers toward firing services and queue support." },
  { value: "memberships", label: "Memberships", help: "Pull readers toward recurring studio access and accountability." },
  { value: "contact", label: "Contact", help: "Use a softer inquiry CTA for opportunities or conversations." },
];
