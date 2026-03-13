#!/usr/bin/env node

/* eslint-disable no-console */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureAutomationMemory } from "./open-memory-automation.mjs";
import { mintStaffIdTokenFromPortalEnv } from "../lib/firebase-auth-token.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "../studio-brain-url-resolution.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..", "..");
const now = new Date();
const runDate = now.toISOString().slice(0, 10);

const DEFAULT_SOURCE = `weekly-external-intelligence:${runDate}`;
const DEFAULT_OUTPUT_JSONL_PATH = resolve(repoRoot, "imports", `weekly-external-intelligence-${runDate}.jsonl`);
const DEFAULT_REPORT_JSON_PATH = resolve(repoRoot, "output", "intel", "weekly-external-intelligence-latest.json");
const DEFAULT_REPORT_MARKDOWN_PATH = resolve(repoRoot, "output", "intel", "weekly-external-intelligence-latest.md");

const DEFAULT_SUBJECT = "Micah Wyenn";
const DEFAULT_WEB_QUERIES = [
  "\"Micah Wyenn\"",
  "\"helixwuff\"",
  "\"Monsoon Fire\" \"Micah Wyenn\"",
  "\"Monsoon Fire\" ceramics portal",
  "site:community.smartthings.com helixwuff",
  "site:community.particle.io helixwuff",
  "site:linkedin.com \"Micah Wyenn\"",
];
const DEFAULT_REDDIT_QUERIES = [
  "\"Micah Wyenn\"",
  "helixwuff",
  "\"Monsoon Fire\"",
  "wyenn",
];
const DEFAULT_SEED_URLS = [
  "https://www.monsoonfire.com/",
  "https://www.monsoonfire.com/About/",
  "https://www.monsoonfire.com/Memberships/",
  "https://www.monsoonfire.com/Classes/",
  "https://community.smartthings.com/t/the-hidden-docs/380",
  "https://community.smartthings.com/t/dev-rosetta-stone-needed-help/363",
  "https://community.particle.io/t/spark-core-projects/47",
  "https://www.flickr.com/photos/44235466%40N00/",
];

const BLOCKLISTED_DOMAINS = [
  "mylife.com",
  "spokeo.com",
  "whitepages.com",
  "peoplebyphone.com",
  "locatefamily.com",
  "fastpeoplesearch.com",
  "beenverified.com",
  "truepeoplesearch.com",
  "clustrmaps.com",
  "radaris.com",
  "usphonebook.com",
  "homes.com",
];

const TRUSTED_DOMAIN_CONFIDENCE = new Map([
  ["monsoonfire.com", 0.97],
  ["community.smartthings.com", 0.93],
  ["community.particle.io", 0.92],
  ["flickr.com", 0.9],
  ["linkedin.com", 0.82],
  ["reddit.com", 0.55],
]);

const DEFAULT_TIMEOUT_MS = 9000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const DEFAULT_STUDIO_ENV_PATH = resolve(repoRoot, "secrets", "studio-brain", "studio-brain-automation.env");
const DEFAULT_PORTAL_ENV_PATH = resolve(repoRoot, "secrets", "portal", "portal-automation.env");

function parseArgs(argv) {
  const options = {
    apply: false,
    dryRun: true,
    asJson: false,
    includeWeb: true,
    includeReddit: true,
    subject: DEFAULT_SUBJECT,
    source: DEFAULT_SOURCE,
    webQueries: [...DEFAULT_WEB_QUERIES],
    redditQueries: [...DEFAULT_REDDIT_QUERIES],
    maxResultsPerQuery: 10,
    maxPageFetches: 24,
    lookbackDays: 7,
    fetchTimeoutMs: DEFAULT_TIMEOUT_MS,
    outputJsonlPath: DEFAULT_OUTPUT_JSONL_PATH,
    reportJsonPath: DEFAULT_REPORT_JSON_PATH,
    reportMarkdownPath: DEFAULT_REPORT_MARKDOWN_PATH,
    continueOnError: true,
  };

  let webQueriesOverridden = false;
  let redditQueriesOverridden = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;

    if (arg === "--apply") {
      options.apply = true;
      options.dryRun = false;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      options.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--no-web") {
      options.includeWeb = false;
      continue;
    }
    if (arg === "--no-reddit") {
      options.includeReddit = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (!next || String(next).startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--subject") {
      options.subject = String(next).trim() || DEFAULT_SUBJECT;
      index += 1;
      continue;
    }
    if (arg === "--source") {
      options.source = String(next).trim() || DEFAULT_SOURCE;
      index += 1;
      continue;
    }
    if (arg === "--web-query") {
      if (!webQueriesOverridden) {
        options.webQueries = [];
        webQueriesOverridden = true;
      }
      const value = String(next).trim();
      if (value) options.webQueries.push(value);
      index += 1;
      continue;
    }
    if (arg === "--reddit-query") {
      if (!redditQueriesOverridden) {
        options.redditQueries = [];
        redditQueriesOverridden = true;
      }
      const value = String(next).trim();
      if (value) options.redditQueries.push(value);
      index += 1;
      continue;
    }
    if (arg === "--max-results") {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid --max-results value: ${next}`);
      }
      options.maxResultsPerQuery = Math.trunc(parsed);
      index += 1;
      continue;
    }
    if (arg === "--max-fetch") {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid --max-fetch value: ${next}`);
      }
      options.maxPageFetches = Math.trunc(parsed);
      index += 1;
      continue;
    }
    if (arg === "--lookback-days") {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error(`Invalid --lookback-days value: ${next}`);
      }
      options.lookbackDays = Math.trunc(parsed);
      index += 1;
      continue;
    }
    if (arg === "--fetch-timeout-ms") {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1000) {
        throw new Error(`Invalid --fetch-timeout-ms value: ${next}`);
      }
      options.fetchTimeoutMs = Math.trunc(parsed);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputJsonlPath = resolve(repoRoot, String(next));
      index += 1;
      continue;
    }
    if (arg === "--report-json") {
      options.reportJsonPath = resolve(repoRoot, String(next));
      index += 1;
      continue;
    }
    if (arg === "--report-markdown") {
      options.reportMarkdownPath = resolve(repoRoot, String(next));
      index += 1;
      continue;
    }
    if (arg === "--continue-on-error") {
      const value = String(next).trim().toLowerCase();
      options.continueOnError = value !== "false" && value !== "0" && value !== "no";
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.includeWeb && !options.includeReddit) {
    throw new Error("At least one source channel must be enabled (web or reddit).");
  }

  return options;
}

function printUsage() {
  process.stdout.write(
    [
      "Weekly external intelligence gatherer",
      "",
      "Usage:",
      "  node ./scripts/codex/weekly-external-intelligence.mjs [--dry-run] [--json]",
      "  node ./scripts/codex/weekly-external-intelligence.mjs --apply --json",
      "",
      "Flags:",
      "  --subject <text>              Subject label for generated memories",
      "  --source <source-name>        Memory source override (default weekly date source)",
      "  --web-query <query>           Add/override a web query (repeat flag to pass many)",
      "  --reddit-query <query>        Add/override a reddit query (repeat flag to pass many)",
      "  --max-results <n>             Per-query result cap (default 10)",
      "  --max-fetch <n>               Max web pages to fetch for evidence (default 24)",
      "  --lookback-days <n>           Reddit recency window in days (default 7)",
      "  --output <path>               JSONL output path",
      "  --report-json <path>          JSON summary artifact path",
      "  --report-markdown <path>      Markdown summary artifact path",
      "  --no-web                      Skip web discovery",
      "  --no-reddit                   Skip reddit discovery",
      "  --apply                       Import generated memories into Open Memory API",
      "  --dry-run                     Generate artifacts without importing (default)",
      "  --json                        Print machine-readable summary to stdout",
      "",
      "Environment for --apply:",
      "  STUDIO_BRAIN_AUTH_TOKEN or STUDIO_BRAIN_ID_TOKEN",
      "  STUDIO_BRAIN_BASE_URL (optional; resolved from studio profile when omitted)",
      "  STUDIO_BRAIN_ADMIN_TOKEN (optional)",
      "  OPEN_MEMORY_TENANT_ID or STUDIO_BRAIN_MEMORY_TENANT_ID (optional)",
    ].join("\n")
  );
}

function clean(value) {
  return String(value || "").trim();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'");
}

function decodeDuckDuckGoRedirect(rawHref) {
  const href = decodeHtmlEntities(String(rawHref || ""));
  if (!href) return "";
  const normalized = href.startsWith("//") ? `https:${href}` : href;
  try {
    const parsed = new URL(normalized);
    if (!parsed.hostname.includes("duckduckgo.com")) {
      return normalized;
    }
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    return normalized;
  } catch {
    return normalized;
  }
}

function normalizeUrl(raw) {
  const value = clean(raw);
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function domainForUrl(raw) {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isBlockedDomain(domain) {
  return BLOCKLISTED_DOMAINS.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

function confidenceForDomain(domain) {
  for (const [trustedDomain, confidence] of TRUSTED_DOMAIN_CONFIDENCE.entries()) {
    if (domain === trustedDomain || domain.endsWith(`.${trustedDomain}`)) {
      return confidence;
    }
  }
  return 0.62;
}

function confidenceTier(confidence) {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

function buildEntityTerms(subject) {
  const commonNameTerms = new Set([
    "micah",
    "john",
    "michael",
    "mike",
    "david",
    "daniel",
    "james",
    "robert",
    "chris",
    "matt",
  ]);
  const subjectTerms = clean(subject)
    .split(/\s+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length >= 2);
  const strongSubjectTerms = subjectTerms.filter((entry) => entry.length >= 4 && !commonNameTerms.has(entry));
  return Array.from(
    new Set([
      ...strongSubjectTerms,
      subject.toLowerCase(),
      "micah wyenn",
      "wyenn",
      "helixwuff",
      "monsoon fire",
      "monsoonfire",
      "kilnfire",
    ])
  );
}

function summarizeEvidence(rawText, terms, maxLength = 260) {
  const text = clean(rawText).replace(/\s+/g, " ");
  if (!text) return "";
  const lowered = text.toLowerCase();
  for (const term of terms) {
    const index = lowered.indexOf(term.toLowerCase());
    if (index < 0) continue;
    const start = Math.max(0, index - 80);
    const end = Math.min(text.length, index + term.length + 140);
    const excerpt = text.slice(start, end).trim();
    return excerpt.length > maxLength ? `${excerpt.slice(0, maxLength - 1)}…` : excerpt;
  }
  const fallback = text.slice(0, maxLength);
  return fallback.length < text.length ? `${fallback.slice(0, maxLength - 1)}…` : fallback;
}

function stripHtml(rawHtml) {
  return decodeHtmlEntities(
    String(rawHtml || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|li|h1|h2|h3|h4|h5|h6|div|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  ).trim();
}

function textMentionsTerm(text, terms) {
  const lowered = String(text || "").toLowerCase();
  return terms.some((term) => {
    const normalizedTerm = String(term || "").toLowerCase().trim();
    if (!normalizedTerm) return false;
    if (normalizedTerm.includes(" ")) {
      return lowered.includes(normalizedTerm);
    }
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
    return pattern.test(lowered);
  });
}

function safeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function toAbsolutePath(candidate) {
  return resolve(repoRoot, candidate);
}

function normalizeBearer(value) {
  const token = clean(value);
  if (!token) return "";
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function resolveTenantId(env = process.env) {
  return clean(env.OPEN_MEMORY_TENANT_ID || env.STUDIO_BRAIN_MEMORY_TENANT_ID || "");
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {
      attempted: false,
      loaded: false,
      filePath,
      keysLoaded: 0,
    };
  }
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  let keysLoaded = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if (!key || process.env[key]) continue;
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    keysLoaded += 1;
  }
  return {
    attempted: true,
    loaded: keysLoaded > 0,
    filePath,
    keysLoaded,
  };
}

async function ensureOpenMemoryAuth() {
  let authHeader = normalizeBearer(process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN || "");
  if (authHeader) {
    return {
      ok: true,
      minted: false,
      loadedEnv: false,
      reason: "",
    };
  }

  const studioEnvLoad = loadEnvFile(DEFAULT_STUDIO_ENV_PATH);
  const portalEnvLoad = loadEnvFile(DEFAULT_PORTAL_ENV_PATH);
  const loadedEnv = Boolean(studioEnvLoad.loaded || portalEnvLoad.loaded);
  authHeader = normalizeBearer(process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN || "");
  if (authHeader) {
    return {
      ok: true,
      minted: false,
      loadedEnv,
      reason: "",
    };
  }

  const minted = await mintStaffIdTokenFromPortalEnv({
    env: process.env,
    defaultCredentialsPath: resolve(repoRoot, "secrets", "portal", "portal-agent-staff.json"),
    preferRefreshToken: true,
  });
  if (minted.ok && minted.token) {
    process.env.STUDIO_BRAIN_ID_TOKEN = minted.token;
    process.env.STUDIO_BRAIN_AUTH_TOKEN = normalizeBearer(minted.token);
    return {
      ok: true,
      minted: true,
      loadedEnv,
      reason: "",
    };
  }

  return {
    ok: false,
    minted: false,
    loadedEnv,
    reason: minted.reason || "missing-auth-token",
  };
}

function timeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    clear: () => clearTimeout(timeout),
  };
}

async function fetchText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {}) {
  const timeout = timeoutController(timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent": DEFAULT_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
        ...headers,
      },
      signal: timeout.controller.signal,
    });
    const status = response.status;
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const body = await response.text();
    return {
      ok: response.ok,
      status,
      contentType,
      body,
      finalUrl: normalizeUrl(response.url || url) || normalizeUrl(url),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      body: "",
      error: error instanceof Error ? error.message : String(error),
      finalUrl: normalizeUrl(url),
    };
  } finally {
    timeout.clear();
  }
}

function parseDuckDuckGoResults(html, query) {
  const results = [];
  const regex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const resolvedUrl = normalizeUrl(decodeDuckDuckGoRedirect(match[1]));
    if (!resolvedUrl) continue;
    const title = decodeHtmlEntities(String(match[2] || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!title) continue;
    results.push({
      channel: "web",
      provider: "duckduckgo",
      query,
      title,
      url: resolvedUrl,
      discoveredAt: new Date().toISOString(),
    });
  }
  return results;
}

function parseBingRssResults(xml, query) {
  const output = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const block = itemMatch[1];
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    const title = clean(decodeHtmlEntities(titleMatch?.[1] || ""));
    const url = normalizeUrl(clean(decodeHtmlEntities(linkMatch?.[1] || "")));
    if (!title || !url) continue;
    output.push({
      channel: "web",
      provider: "bing-rss",
      query,
      title,
      url,
      discoveredAt: new Date().toISOString(),
    });
  }
  return output;
}

async function searchBingRss(query, maxResults, timeoutMs) {
  const endpoint = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=${Math.max(
    1,
    maxResults
  )}`;
  const response = await fetchText(endpoint, { timeoutMs });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: response.error || `HTTP ${response.status}`,
      items: [],
    };
  }
  return {
    ok: true,
    status: response.status,
    error: "",
    items: parseBingRssResults(response.body, query).slice(0, maxResults),
  };
}

async function searchDuckDuckGo(query, maxResults, timeoutMs) {
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetchText(endpoint, { timeoutMs });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: response.error || `HTTP ${response.status}`,
      items: [],
    };
  }
  let parsed = parseDuckDuckGoResults(response.body, query).slice(0, maxResults);
  if (parsed.length === 0 || response.status === 202) {
    const fallback = await searchBingRss(query, maxResults, timeoutMs);
    if (fallback.ok && fallback.items.length > 0) {
      parsed = fallback.items;
    }
  }
  return {
    ok: true,
    status: response.status,
    error: "",
    items: parsed,
  };
}

async function searchReddit(query, maxResults, lookbackDays, timeoutMs) {
  const endpoint = new URL("https://www.reddit.com/search.json");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("sort", "new");
  endpoint.searchParams.set("t", "year");
  endpoint.searchParams.set("limit", String(maxResults));

  const response = await fetchText(endpoint.toString(), {
    timeoutMs,
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: response.error || `HTTP ${response.status}`,
      items: [],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return {
      ok: false,
      status: response.status,
      error: "Invalid JSON from reddit search endpoint.",
      items: [],
    };
  }

  const minCreatedUtc = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
  const items = [];
  for (const entry of parsed?.data?.children || []) {
    const data = entry?.data || {};
    const createdUtc = Number(data.created_utc || 0);
    if (!Number.isFinite(createdUtc) || createdUtc < minCreatedUtc) continue;
    const permalink = clean(data.permalink);
    const url = normalizeUrl(permalink ? `https://www.reddit.com${permalink}` : "");
    if (!url) continue;
    items.push({
      channel: "reddit",
      provider: "reddit-public-json",
      query,
      url,
      title: clean(data.title),
      subreddit: clean(data.subreddit),
      author: clean(data.author),
      selfText: clean(data.selftext),
      score: Number.isFinite(Number(data.score)) ? Number(data.score) : null,
      comments: Number.isFinite(Number(data.num_comments)) ? Number(data.num_comments) : null,
      createdAtIso: createdUtc > 0 ? new Date(createdUtc * 1000).toISOString() : "",
      discoveredAt: new Date().toISOString(),
    });
  }

  return {
    ok: true,
    status: response.status,
    error: "",
    items,
  };
}

function dedupeByUrl(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = `${item.channel || "unknown"}::${item.url || ""}`;
    if (!item.url || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function buildWebMemoryItem({
  source,
  subject,
  query,
  url,
  title,
  domain,
  evidenceSnippet,
  confidence,
  fetchedAtIso,
}) {
  const confidenceRounded = Math.round(confidence * 1000) / 1000;
  const confidenceLabel = confidenceTier(confidenceRounded);
  const slug = safeSlug(domain || "web");
  const content = `Weekly external intelligence found ${subject}-related mention on ${domain}: ${title}`;
  return {
    content,
    source,
    tags: [
      "weekly-intelligence",
      "outside-source",
      "web",
      `confidence:${confidenceLabel}`,
      `domain:${slug}`,
    ],
    metadata: {
      channel: "web",
      query,
      url,
      title,
      domain,
      confidence: confidenceRounded,
      confidenceTier: confidenceLabel,
      evidenceSnippet,
      fetchedAtIso,
      subject,
    },
  };
}

function buildRedditMemoryItem({ source, subject, query, item, evidenceSnippet, confidence }) {
  const confidenceRounded = Math.round(confidence * 1000) / 1000;
  const confidenceLabel = confidenceTier(confidenceRounded);
  const title = clean(item.title) || "(untitled reddit post)";
  const subreddit = clean(item.subreddit) || "unknown";
  const author = clean(item.author) || "unknown";
  const content = `Weekly external intelligence found a Reddit match for ${subject} in r/${subreddit} by u/${author}: ${title}`;
  return {
    content,
    source,
    tags: [
      "weekly-intelligence",
      "outside-source",
      "reddit",
      `confidence:${confidenceLabel}`,
      `subreddit:${safeSlug(subreddit)}`,
    ],
    metadata: {
      channel: "reddit",
      query,
      url: item.url,
      title,
      subreddit,
      author,
      confidence: confidenceRounded,
      confidenceTier: confidenceLabel,
      score: item.score,
      comments: item.comments,
      createdAtIso: item.createdAtIso || null,
      evidenceSnippet,
      subject,
    },
  };
}

function buildCrossReferenceMemory({ source, subject, webMemories, redditMemories }) {
  const domainSet = new Set(
    webMemories
      .map((entry) => clean(entry?.metadata?.domain))
      .filter(Boolean)
  );
  const highConfidenceWeb = webMemories.filter((entry) => Number(entry?.metadata?.confidence || 0) >= 0.85);
  const mediumPlusReddit = redditMemories.filter((entry) => Number(entry?.metadata?.confidence || 0) >= 0.6);
  if (domainSet.size < 2 || highConfidenceWeb.length === 0) {
    return null;
  }
  const topDomains = Array.from(domainSet).slice(0, 5);
  const content = `Weekly external intelligence cross-reference: ${subject} signals aligned across ${topDomains.length} domains (${topDomains.join(", ")}), with ${highConfidenceWeb.length} high-confidence web mentions and ${mediumPlusReddit.length} medium-or-better reddit mentions.`;
  return {
    content,
    source,
    tags: ["weekly-intelligence", "outside-source", "cross-reference", "confidence:high"],
    metadata: {
      channel: "cross-reference",
      subject,
      domains: topDomains,
      highConfidenceWebCount: highConfidenceWeb.length,
      mediumPlusRedditCount: mediumPlusReddit.length,
      generatedAtIso: new Date().toISOString(),
    },
  };
}

function redactHighRiskMemoryItems(items) {
  return items.filter((entry) => {
    const domain = clean(entry?.metadata?.domain || "");
    if (!domain) return true;
    return !isBlockedDomain(domain);
  });
}

function dedupeMemories(memories) {
  const seen = new Set();
  const output = [];
  for (const memory of memories) {
    const serialized = JSON.stringify({
      content: memory.content,
      source: memory.source,
      url: memory?.metadata?.url || "",
      domain: memory?.metadata?.domain || "",
      query: memory?.metadata?.query || "",
    });
    const fingerprint = createHash("sha1").update(serialized).digest("hex");
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    output.push(memory);
  }
  return output;
}

function toJsonlBody(items) {
  return items.map((entry) => JSON.stringify(entry)).join("\n");
}

async function writeArtifacts({ outputJsonlPath, reportJsonPath, reportMarkdownPath, memories, report }) {
  const outputDir = dirname(outputJsonlPath);
  const reportJsonDir = dirname(reportJsonPath);
  const reportMarkdownDir = dirname(reportMarkdownPath);
  await mkdir(outputDir, { recursive: true });
  await mkdir(reportJsonDir, { recursive: true });
  await mkdir(reportMarkdownDir, { recursive: true });

  const jsonlBody = toJsonlBody(memories);
  await writeFile(outputJsonlPath, jsonlBody.length > 0 ? `${jsonlBody}\n` : "", "utf8");
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const markdown = [
    "# Weekly External Intelligence",
    "",
    `- Generated at: ${report.generatedAtIso}`,
    `- Subject: ${report.subject}`,
    `- Memories generated: ${report.generatedMemoryCount}`,
    `- Memory import attempted: ${report.import?.attempted ? "yes" : "no"}`,
    `- Memory import status: ${report.import?.ok ? "ok" : report.import?.error ? "error" : "skipped"}`,
    "",
    "## Source Counts",
    "",
    `- Web search hits: ${report.discovery.web.totalHits}`,
    `- Reddit hits: ${report.discovery.reddit.totalHits}`,
    `- High-confidence memories: ${report.generatedByConfidence.high}`,
    `- Medium-confidence memories: ${report.generatedByConfidence.medium}`,
    `- Low-confidence memories: ${report.generatedByConfidence.low}`,
    "",
    "## Notes",
    "",
    ...report.notes.map((note) => `- ${note}`),
    "",
    "## Output",
    "",
    `- JSONL: ${report.outputJsonlPath}`,
    `- JSON: ${report.reportJsonPath}`,
  ].join("\n");

  await writeFile(reportMarkdownPath, `${markdown}\n`, "utf8");
}

async function importToOpenMemory({ items, source, continueOnError = true, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const authResolution = await ensureOpenMemoryAuth();
  const baseUrl = clean(resolveStudioBrainBaseUrlFromEnv({ env: process.env })).replace(/\/$/, "");
  const authHeader = normalizeBearer(
    process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN || ""
  );
  if (!baseUrl) {
    return {
      attempted: false,
      ok: false,
      error: "missing-base-url",
      importedCount: 0,
      failedCount: 0,
      auth: authResolution,
    };
  }
  if (!authHeader) {
    return {
      attempted: false,
      ok: false,
      error: authResolution.reason || "missing-auth-token",
      importedCount: 0,
      failedCount: 0,
      auth: authResolution,
    };
  }

  const adminToken = clean(process.env.STUDIO_BRAIN_ADMIN_TOKEN || "");
  const tenantId = resolveTenantId(process.env);
  const payloadItems = items.map((entry) => ({
    content: String(entry.content || ""),
    source: String(entry.source || source),
    tags: Array.isArray(entry.tags) ? entry.tags.map((tag) => String(tag)) : [],
    metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
    tenantId: tenantId || undefined,
  }));

  const payload = {
    sourceOverride: source,
    continueOnError,
    items: payloadItems,
  };

  const timeout = timeoutController(timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/memory/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: authHeader,
        ...(adminToken ? { "x-studio-brain-admin-token": adminToken } : {}),
      },
      body: JSON.stringify(payload),
      signal: timeout.controller.signal,
    });
    const raw = await response.text();
    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      return {
        attempted: true,
        ok: false,
        status: response.status,
        error: clean(parsed?.message) || `HTTP ${response.status}`,
        importedCount: 0,
        failedCount: items.length,
        auth: authResolution,
      };
    }
    return {
      attempted: true,
      ok: true,
      status: response.status,
      error: "",
      importedCount:
        Number(parsed?.summary?.importedCount ?? parsed?.importedCount ?? payloadItems.length) || payloadItems.length,
      failedCount: Number(parsed?.summary?.failedCount ?? parsed?.failedCount ?? 0) || 0,
      auth: authResolution,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
      importedCount: 0,
      failedCount: items.length,
      auth: authResolution,
    };
  } finally {
    timeout.clear();
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const entityTerms = buildEntityTerms(options.subject);
  const notes = [];
  const webDiscovery = {
    totalQueries: 0,
    totalHits: 0,
    errors: [],
  };
  const redditDiscovery = {
    totalQueries: 0,
    totalHits: 0,
    errors: [],
  };

  const discoveredWebResults = [];
  if (options.includeWeb) {
    for (const query of options.webQueries) {
      webDiscovery.totalQueries += 1;
      const result = await searchDuckDuckGo(query, options.maxResultsPerQuery, options.fetchTimeoutMs);
      if (!result.ok) {
        webDiscovery.errors.push({ query, error: result.error, status: result.status });
        if (!options.continueOnError) {
          throw new Error(`Web search failed for query "${query}": ${result.error}`);
        }
        continue;
      }
      webDiscovery.totalHits += result.items.length;
      discoveredWebResults.push(...result.items);
    }
  } else {
    notes.push("Web discovery disabled via --no-web.");
  }

  const discoveredRedditResults = [];
  if (options.includeReddit) {
    for (const query of options.redditQueries) {
      redditDiscovery.totalQueries += 1;
      const result = await searchReddit(query, options.maxResultsPerQuery, options.lookbackDays, options.fetchTimeoutMs);
      if (!result.ok) {
        redditDiscovery.errors.push({ query, error: result.error, status: result.status });
        if (!options.continueOnError) {
          throw new Error(`Reddit search failed for query "${query}": ${result.error}`);
        }
        continue;
      }
      redditDiscovery.totalHits += result.items.length;
      discoveredRedditResults.push(...result.items);
    }
  } else {
    notes.push("Reddit discovery disabled via --no-reddit.");
  }

  const seededWebResults = DEFAULT_SEED_URLS.map((url) => ({
    channel: "web",
    provider: "seed-url",
    query: "seed-url",
    title: url,
    url,
    discoveredAt: new Date().toISOString(),
  }));
  const dedupedWebResults = dedupeByUrl([...seededWebResults, ...discoveredWebResults]);
  const dedupedRedditResults = dedupeByUrl(discoveredRedditResults);

  const webMemories = [];
  const skippedDomains = [];
  let fetchedPages = 0;
  for (const entry of dedupedWebResults) {
    if (fetchedPages >= options.maxPageFetches) break;
    const normalizedUrl = normalizeUrl(entry.url);
    if (!normalizedUrl) continue;

    const domain = domainForUrl(normalizedUrl);
    if (!domain || isBlockedDomain(domain)) {
      if (domain) skippedDomains.push(domain);
      continue;
    }

    const pageResponse = await fetchText(normalizedUrl, { timeoutMs: options.fetchTimeoutMs });
    fetchedPages += 1;
    if (!pageResponse.ok) {
      notes.push(`Page fetch failed (${pageResponse.status}) for ${normalizedUrl}`);
      continue;
    }
    if (!pageResponse.contentType.includes("html") && !pageResponse.contentType.includes("xml")) {
      continue;
    }

    const pageText = stripHtml(pageResponse.body);
    if (!pageText) continue;

    const titleMatch = pageResponse.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = clean(decodeHtmlEntities(String(titleMatch?.[1] || ""))) || entry.title;
    const evidenceSnippet = summarizeEvidence(pageText, entityTerms);

    if (!textMentionsTerm(`${pageTitle} ${pageText}`, entityTerms)) {
      continue;
    }

    let confidence = confidenceForDomain(domain);
    if (textMentionsTerm(pageTitle, [options.subject.toLowerCase(), "helixwuff"])) {
      confidence += 0.08;
    }
    if (textMentionsTerm(evidenceSnippet, ["micah wyenn", "helixwuff", "monsoon fire"])) {
      confidence += 0.1;
    }
    confidence = Math.max(0.3, Math.min(0.99, confidence));

    webMemories.push(
      buildWebMemoryItem({
        source: options.source,
        subject: options.subject,
        query: entry.query,
        url: pageResponse.finalUrl || normalizedUrl,
        title: pageTitle,
        domain,
        evidenceSnippet,
        confidence,
        fetchedAtIso: new Date().toISOString(),
      })
    );
  }

  const redditMemories = [];
  for (const item of dedupedRedditResults) {
    const combined = `${item.title || ""} ${item.selfText || ""}`;
    if (!textMentionsTerm(combined, entityTerms)) continue;
    const evidenceSnippet = summarizeEvidence(combined, entityTerms);
    let confidence = 0.42;
    if (textMentionsTerm(combined, ["micah wyenn", "helixwuff"])) confidence += 0.22;
    if (textMentionsTerm(combined, ["monsoon fire"])) confidence += 0.16;
    if ((item.score || 0) >= 3) confidence += 0.05;
    confidence = Math.max(0.25, Math.min(0.85, confidence));
    redditMemories.push(
      buildRedditMemoryItem({
        source: options.source,
        subject: options.subject,
        query: item.query,
        item,
        evidenceSnippet,
        confidence,
      })
    );
  }

  const crossReference = buildCrossReferenceMemory({
    source: options.source,
    subject: options.subject,
    webMemories,
    redditMemories,
  });

  const generatedMemories = dedupeMemories(
    redactHighRiskMemoryItems([
      ...webMemories,
      ...redditMemories,
      ...(crossReference ? [crossReference] : []),
      {
        content:
          "Weekly external intelligence guardrail: people-search/property-broker sources are excluded by default due to high noise and privacy risk.",
        source: options.source,
        tags: ["weekly-intelligence", "outside-source", "guardrail", "privacy"],
        metadata: {
          channel: "policy",
          excludedDomains: BLOCKLISTED_DOMAINS,
          subject: options.subject,
        },
      },
    ])
  );

  if (generatedMemories.length === 0) {
    notes.push("No memory candidates passed relevance and privacy filters in this run.");
  }
  if (skippedDomains.length > 0) {
    const uniqueSkipped = Array.from(new Set(skippedDomains));
    notes.push(`Skipped ${uniqueSkipped.length} blocked high-noise domains.`);
  }

  const importResult =
    options.apply && generatedMemories.length > 0
      ? await importToOpenMemory({
          items: generatedMemories,
          source: options.source,
          continueOnError: options.continueOnError,
          timeoutMs: options.fetchTimeoutMs,
        })
      : {
          attempted: false,
          ok: false,
          error: options.apply ? "no-memory-items" : "dry-run",
          importedCount: 0,
          failedCount: 0,
        };

  if (options.apply && !importResult.attempted) {
    notes.push(`Memory import skipped: ${importResult.error}`);
  } else if (options.apply && importResult.attempted && !importResult.ok) {
    notes.push(`Memory import failed: ${importResult.error}`);
  } else if (importResult.ok) {
    notes.push(`Imported ${importResult.importedCount} memory item(s) into Open Memory.`);
  }

  const generatedByConfidence = {
    high: generatedMemories.filter((entry) => entry.tags.includes("confidence:high")).length,
    medium: generatedMemories.filter((entry) => entry.tags.includes("confidence:medium")).length,
    low: generatedMemories.filter((entry) => entry.tags.includes("confidence:low")).length,
  };

  const report = {
    tool: "codex-weekly-external-intelligence",
    generatedAtIso: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    subject: options.subject,
    apply: options.apply,
    dryRun: options.dryRun,
    source: options.source,
    discovery: {
      web: webDiscovery,
      reddit: redditDiscovery,
    },
    fetchedPages,
    generatedMemoryCount: generatedMemories.length,
    generatedByConfidence,
    import: importResult,
    outputJsonlPath: options.outputJsonlPath,
    reportJsonPath: options.reportJsonPath,
    reportMarkdownPath: options.reportMarkdownPath,
    notes,
  };

  await writeArtifacts({
    outputJsonlPath: options.outputJsonlPath,
    reportJsonPath: options.reportJsonPath,
    reportMarkdownPath: options.reportMarkdownPath,
    memories: generatedMemories,
    report,
  });

  const captureResult = await captureAutomationMemory({
    tool: "weekly-external-intelligence",
    runId: runDate,
    status: importResult.ok || options.dryRun ? "ok" : "error",
    summary: {
      generatedMemories: generatedMemories.length,
      importedMemories: importResult.importedCount || 0,
      webHits: webDiscovery.totalHits,
      redditHits: redditDiscovery.totalHits,
      fetches: fetchedPages,
      errors: webDiscovery.errors.length + redditDiscovery.errors.length,
    },
    extraTags: ["weekly-intel", options.apply ? "apply" : "dry-run"],
    source: options.source,
    metadata: {
      subject: options.subject,
      outputJsonlPath: options.outputJsonlPath,
      reportJsonPath: options.reportJsonPath,
      reportMarkdownPath: options.reportMarkdownPath,
      importResult,
    },
  });

  if (!captureResult.ok && captureResult.attempted) {
    notes.push(`Automation memory capture failed: ${captureResult.error}`);
  }

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      `weekly-external-intelligence ${options.apply ? "apply" : "dry-run"} complete`,
      `subject: ${options.subject}`,
      `memories: ${generatedMemories.length}`,
      `imported: ${importResult.importedCount || 0}`,
      `report: ${options.reportJsonPath}`,
      `jsonl: ${options.outputJsonlPath}`,
    ].join("\n")
  );
  process.stdout.write("\n");
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`weekly-external-intelligence failed: ${message}`);
  process.exit(1);
});
