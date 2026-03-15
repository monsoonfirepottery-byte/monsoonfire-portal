import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const repoRoot = resolve(__dirname, "..", "..");
export const marketingRoot = resolve(repoRoot, "marketing");
export const defaultAnnouncementSourceDir = resolve(marketingRoot, "announcements");
export const defaultWebsiteAnnouncementsPath = resolve(repoRoot, "website", "data", "announcements.json");
export const defaultMarketingArtifactsDir = resolve(repoRoot, "artifacts", "marketing");
export const defaultPortalPayloadPath = resolve(defaultMarketingArtifactsDir, "portal-announcements-sync-latest.json");
export const defaultBuildSummaryPath = resolve(defaultMarketingArtifactsDir, "announcements-build-latest.json");
export const marketingSourceSystem = "marketing-feed-v1";

const ALLOWED_STATUSES = new Set(["draft", "approved", "archived"]);
const ALLOWED_CATEGORIES = new Set(["ops_update", "event", "spotlight", "policy", "offer"]);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function isWithinRoot(rootDir, targetPath) {
  const rel = relative(rootDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`${sep}..${sep}`) && rel !== "..");
}

function toRelativePath(rootDir, value) {
  return normalizePath(relative(rootDir, value));
}

function asObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value;
}

function parseIso(value, fieldName) {
  const text = normalizeText(value);
  if (!text) throw new Error(`${fieldName} is required`);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  return parsed.toISOString();
}

function parseOptionalIso(value, fieldName) {
  if (value == null || value === "") return null;
  return parseIso(value, fieldName);
}

function parseBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be true or false`);
  }
  return value;
}

function parseLinkTarget(value, fieldName) {
  const text = normalizeOptionalText(value);
  if (!text) return null;
  if (text.startsWith("/")) return text;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${fieldName} must use http, https, or a root-relative path`);
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message.includes(fieldName)) {
      throw error;
    }
    throw new Error(`${fieldName} must be a valid URL or root-relative path`);
  }
}

function splitBodyParagraphs(body) {
  return String(body || "")
    .split(/\r?\n\r?\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeAudience(rawAudience) {
  const audience = asObject(rawAudience, "audience");
  const normalized = {
    publicWebsite: parseBoolean(audience.publicWebsite, "audience.publicWebsite"),
    portalMembers: parseBoolean(audience.portalMembers, "audience.portalMembers"),
  };
  if (!normalized.publicWebsite && !normalized.portalMembers) {
    throw new Error("audience must enable at least one target");
  }
  return normalized;
}

function repoAssetPathToSitePath(repoPath) {
  const normalized = normalizePath(repoPath);
  if (!normalized.startsWith("website/")) return null;
  return `/${normalized.slice("website/".length)}`;
}

function normalizeAssetRefs(rawAssetRefs, { rootDir }) {
  if (rawAssetRefs == null) return [];
  if (!Array.isArray(rawAssetRefs)) {
    throw new Error("assetRefs must be an array");
  }

  return rawAssetRefs.map((entry, index) => {
    const asset = asObject(entry, `assetRefs[${index}]`);
    const repoPathRaw = normalizeText(asset.repoPath);
    if (!repoPathRaw) throw new Error(`assetRefs[${index}].repoPath is required`);

    const absolutePath = resolve(rootDir, repoPathRaw);
    if (!isWithinRoot(rootDir, absolutePath)) {
      throw new Error(`assetRefs[${index}].repoPath must stay inside the repo`);
    }
    if (!existsSync(absolutePath)) {
      throw new Error(`assetRefs[${index}].repoPath not found: ${repoPathRaw}`);
    }

    const repoPath = toRelativePath(rootDir, absolutePath);
    return {
      repoPath,
      sitePath: repoAssetPathToSitePath(repoPath),
      dropboxSource: normalizeOptionalText(asset.dropboxSource),
      alt: normalizeOptionalText(asset.alt),
    };
  });
}

function categoryLabel(category) {
  return String(category || "")
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function comparePublishDatesDesc(left, right) {
  const leftTime = new Date(left.publishAt).getTime();
  const rightTime = new Date(right.publishAt).getTime();
  return rightTime - leftTime || left.id.localeCompare(right.id);
}

export function buildManagedAnnouncementDocId(sourceId) {
  return `marketing-${sourceId}`;
}

export function isAnnouncementActive(document, now = new Date()) {
  if (!document || document.status !== "approved") return false;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const publishMs = new Date(document.publishAt).getTime();
  if (publishMs > nowMs) return false;
  if (document.expiresAt) {
    const expiresMs = new Date(document.expiresAt).getTime();
    if (expiresMs <= nowMs) return false;
  }
  return true;
}

export function normalizeAnnouncementDocument(rawDocument, options = {}) {
  const rootDir = options.rootDir || repoRoot;
  const sourcePath = normalizeOptionalText(options.sourcePath);
  const documentValue = asObject(rawDocument, "announcement");

  const id = normalizeText(documentValue.id);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("id must be lowercase kebab-case");
  }

  const status = normalizeText(documentValue.status).toLowerCase();
  if (!ALLOWED_STATUSES.has(status)) {
    throw new Error(`status must be one of: ${Array.from(ALLOWED_STATUSES).join(", ")}`);
  }

  const category = normalizeText(documentValue.category).toLowerCase();
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new Error(`category must be one of: ${Array.from(ALLOWED_CATEGORIES).join(", ")}`);
  }

  const publishAt = parseIso(documentValue.publishAt, "publishAt");
  const expiresAt = parseOptionalIso(documentValue.expiresAt, "expiresAt");
  if (expiresAt && new Date(expiresAt).getTime() <= new Date(publishAt).getTime()) {
    throw new Error("expiresAt must be later than publishAt");
  }

  const title = normalizeText(documentValue.title);
  const summary = normalizeText(documentValue.summary);
  const body = normalizeText(documentValue.body);
  const bodyParagraphs = splitBodyParagraphs(body);
  if (!title) throw new Error("title is required");
  if (!summary) throw new Error("summary is required");
  if (!bodyParagraphs.length) throw new Error("body is required");

  const ctaLabel = normalizeOptionalText(documentValue.ctaLabel);
  const ctaUrl = parseLinkTarget(documentValue.ctaUrl, "ctaUrl");
  if (ctaLabel && !ctaUrl) throw new Error("ctaUrl is required when ctaLabel is present");
  if (ctaUrl && !ctaLabel) throw new Error("ctaLabel is required when ctaUrl is present");

  return {
    id,
    status,
    audience: normalizeAudience(documentValue.audience),
    category,
    categoryLabel: categoryLabel(category),
    publishAt,
    expiresAt,
    title,
    summary,
    body,
    bodyParagraphs,
    ctaLabel,
    ctaUrl,
    homepageTeaser: parseBoolean(documentValue.homepageTeaser, "homepageTeaser"),
    portalPinned: parseBoolean(documentValue.portalPinned, "portalPinned"),
    assetRefs: normalizeAssetRefs(documentValue.assetRefs, { rootDir }),
    sourcePath,
  };
}

export async function loadAnnouncementDocuments(options = {}) {
  const rootDir = options.rootDir || repoRoot;
  const sourceDir = resolve(rootDir, options.sourceDir || defaultAnnouncementSourceDir);
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => resolve(sourceDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const documents = [];
  for (const filePath of files) {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    documents.push(
      normalizeAnnouncementDocument(parsed, {
        rootDir,
        sourcePath: toRelativePath(rootDir, filePath),
      })
    );
  }

  return {
    rootDir,
    sourceDir,
    documents,
  };
}

function serializeWebsiteItem(document) {
  return {
    id: document.id,
    category: document.category,
    categoryLabel: document.categoryLabel,
    title: document.title,
    summary: document.summary,
    body: document.body,
    bodyParagraphs: [...document.bodyParagraphs],
    publishAt: document.publishAt,
    expiresAt: document.expiresAt,
    ctaLabel: document.ctaLabel,
    ctaUrl: document.ctaUrl,
    homepageTeaser: document.homepageTeaser,
    asset: document.assetRefs.find((entry) => entry.sitePath) || null,
    assetRefs: document.assetRefs,
    sourceId: document.id,
  };
}

function serializePortalItem(document) {
  return {
    docId: buildManagedAnnouncementDocId(document.id),
    sourceId: document.id,
    sourceSystem: marketingSourceSystem,
    title: document.title,
    summary: document.summary,
    body: document.body,
    type: "marketing-feed",
    category: document.category,
    createdAt: document.publishAt,
    publishAt: document.publishAt,
    expiresAt: document.expiresAt,
    pinned: document.portalPinned,
    ctaLabel: document.ctaLabel,
    ctaUrl: document.ctaUrl,
    readBy: [],
    archived: false,
    homepageTeaser: document.homepageTeaser,
    assetRefs: document.assetRefs,
  };
}

export async function buildAnnouncementArtifacts(options = {}) {
  const rootDir = options.rootDir || repoRoot;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const { sourceDir, documents } = await loadAnnouncementDocuments({
    rootDir,
    sourceDir: options.sourceDir || defaultAnnouncementSourceDir,
  });

  const sortedDocuments = [...documents].sort(comparePublishDatesDesc);
  const activeDocuments = sortedDocuments.filter((document) => isAnnouncementActive(document, now));
  const publicItems = activeDocuments.filter((document) => document.audience.publicWebsite);
  const portalItems = activeDocuments.filter((document) => document.audience.portalMembers);

  const teaserMap = new Map();
  for (const document of publicItems.filter((entry) => entry.homepageTeaser)) {
    teaserMap.set(document.id, document);
    if (teaserMap.size >= 3) break;
  }
  for (const document of publicItems) {
    if (teaserMap.size >= 3) break;
    teaserMap.set(document.id, document);
  }
  const homepageTeasers = Array.from(teaserMap.values()).sort(comparePublishDatesDesc);

  const inactiveSummary = {
    draft: sortedDocuments.filter((document) => document.status === "draft").length,
    archived: sortedDocuments.filter((document) => document.status === "archived").length,
    scheduled: sortedDocuments.filter(
      (document) =>
        document.status === "approved" && new Date(document.publishAt).getTime() > now.getTime()
    ).length,
    expired: sortedDocuments.filter(
      (document) =>
        document.status === "approved" &&
        Boolean(document.expiresAt) &&
        new Date(document.expiresAt).getTime() <= now.getTime()
    ).length,
  };

  const websitePayload = {
    generatedAtUtc: now.toISOString(),
    sourceDir: toRelativePath(rootDir, sourceDir),
    items: publicItems.map(serializeWebsiteItem),
    homepageTeasers: homepageTeasers.map(serializeWebsiteItem),
  };

  const portalPayload = {
    generatedAtUtc: now.toISOString(),
    sourceDir: toRelativePath(rootDir, sourceDir),
    items: portalItems.map(serializePortalItem),
  };

  const buildSummary = {
    generatedAtUtc: now.toISOString(),
    sourceDir: toRelativePath(rootDir, sourceDir),
    sourceCount: sortedDocuments.length,
    activePublicCount: websitePayload.items.length,
    activePortalCount: portalPayload.items.length,
    homepageTeaserCount: websitePayload.homepageTeasers.length,
    inactive: inactiveSummary,
  };

  return {
    rootDir,
    sourceDir,
    documents: sortedDocuments,
    websitePayload,
    portalPayload,
    buildSummary,
  };
}

export async function writeAnnouncementArtifacts(artifacts, options = {}) {
  const rootDir = options.rootDir || artifacts.rootDir || repoRoot;
  const websiteJsonPath = resolve(rootDir, options.websiteJsonPath || defaultWebsiteAnnouncementsPath);
  const portalPayloadPath = resolve(rootDir, options.portalPayloadPath || defaultPortalPayloadPath);
  const buildSummaryPath = resolve(rootDir, options.buildSummaryPath || defaultBuildSummaryPath);

  await mkdir(dirname(websiteJsonPath), { recursive: true });
  await mkdir(dirname(portalPayloadPath), { recursive: true });
  await mkdir(dirname(buildSummaryPath), { recursive: true });

  await writeFile(websiteJsonPath, `${JSON.stringify(artifacts.websitePayload, null, 2)}\n`, "utf8");
  await writeFile(portalPayloadPath, `${JSON.stringify(artifacts.portalPayload, null, 2)}\n`, "utf8");
  await writeFile(buildSummaryPath, `${JSON.stringify(artifacts.buildSummary, null, 2)}\n`, "utf8");

  return {
    websiteJsonPath,
    portalPayloadPath,
    buildSummaryPath,
    websiteJsonPathRelative: toRelativePath(rootDir, websiteJsonPath),
    portalPayloadPathRelative: toRelativePath(rootDir, portalPayloadPath),
    buildSummaryPathRelative: toRelativePath(rootDir, buildSummaryPath),
  };
}
