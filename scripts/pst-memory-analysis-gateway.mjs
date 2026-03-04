#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const STOP_WORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "re",
  "fw",
  "fwd",
  "subject",
  "message",
  "email",
  "team",
  "thanks",
  "thank",
  "hello",
  "hi",
  "regards",
  "best",
  "please",
]);

const SIGNAL_PATTERNS = {
  decision: [
    /\bdecision\b/i,
    /\bdecid(?:e|ed|ing)\b/i,
    /\bagreed\b/i,
    /\bapproved?\b/i,
    /\bfinal call\b/i,
    /\bgo\/no-go\b/i,
    /\bwe will\b/i,
    /\bconfirmed\b/i,
  ],
  action: [
    /\baction item\b/i,
    /\bnext step\b/i,
    /\bfollow[- ]?up\b/i,
    /\bneed to\b/i,
    /\bowner\b/i,
    /\bassign(?:ed|ment)?\b/i,
    /\btodo\b/i,
    /\bdue\b/i,
    /\bdeadline\b/i,
  ],
  risk: [
    /\brisk\b/i,
    /\bblocker\b/i,
    /\bblocked\b/i,
    /\bissue\b/i,
    /\bincident\b/i,
    /\boutage\b/i,
    /\bescalat(?:e|ed|ion)\b/i,
    /\bconcern\b/i,
    /\bsecurity\b/i,
    /\bcompliance\b/i,
  ],
  financial: [
    /\bbudget\b/i,
    /\bcost\b/i,
    /\binvoice\b/i,
    /\bpricing\b/i,
    /\bquote\b/i,
    /\bcontract\b/i,
    /\brenewal\b/i,
    /\barr\b/i,
  ],
  timeline: [
    /\btimeline\b/i,
    /\bschedule\b/i,
    /\bmilestone\b/i,
    /\blaunch\b/i,
    /\brollout\b/i,
    /\bship\b/i,
    /\bq[1-4]\b/i,
  ],
};

const SIGNAL_WEIGHTS = {
  decision: 2,
  action: 2,
  risk: 1,
  financial: 1,
  timeline: 1,
  dateCue: 1,
};

const TYPE_PRIORITIES = {
  thread_summary: 300,
  message_insight: 250,
  contact_fact: 200,
  trend_summary: 150,
  correlation: 100,
};

function parseArgs(argv) {
  const parsed = {
    input: "imports/pst/mailbox-raw-memory.jsonl",
    output: "imports/pst/mailbox-analysis-memory.jsonl",
    report: "output/open-memory/pst-analysis-gateway-latest.json",
    source: "pst:analysis-gateway",
    json: false,
    minSignalScore: 2,
    minThreadMessages: 2,
    maxOutput: 250,
    maxMessageInsights: 120,
    maxThreadSummaries: 80,
    maxContactFacts: 30,
    maxTrendSummaries: 10,
    maxCorrelations: 10,
    maxSnippetChars: 280,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg) continue;

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--input" && argv[index + 1]) {
      parsed.input = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--input=")) {
      parsed.input = arg.slice("--input=".length).trim();
      continue;
    }

    if (arg === "--output" && argv[index + 1]) {
      parsed.output = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      parsed.output = arg.slice("--output=".length).trim();
      continue;
    }

    if (arg === "--report" && argv[index + 1]) {
      parsed.report = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--report=")) {
      parsed.report = arg.slice("--report=".length).trim();
      continue;
    }

    if (arg === "--source" && argv[index + 1]) {
      parsed.source = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--source=")) {
      parsed.source = arg.slice("--source=".length).trim();
      continue;
    }

    if (arg === "--min-signal-score" && argv[index + 1]) {
      parsed.minSignalScore = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--min-signal-score=")) {
      parsed.minSignalScore = Number(arg.slice("--min-signal-score=".length));
      continue;
    }

    if (arg === "--min-thread-messages" && argv[index + 1]) {
      parsed.minThreadMessages = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--min-thread-messages=")) {
      parsed.minThreadMessages = Number(arg.slice("--min-thread-messages=".length));
      continue;
    }

    if (arg === "--max-output" && argv[index + 1]) {
      parsed.maxOutput = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-output=")) {
      parsed.maxOutput = Number(arg.slice("--max-output=".length));
      continue;
    }

    if (arg === "--max-message-insights" && argv[index + 1]) {
      parsed.maxMessageInsights = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-message-insights=")) {
      parsed.maxMessageInsights = Number(arg.slice("--max-message-insights=".length));
      continue;
    }

    if (arg === "--max-thread-summaries" && argv[index + 1]) {
      parsed.maxThreadSummaries = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-thread-summaries=")) {
      parsed.maxThreadSummaries = Number(arg.slice("--max-thread-summaries=".length));
      continue;
    }

    if (arg === "--max-contact-facts" && argv[index + 1]) {
      parsed.maxContactFacts = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-contact-facts=")) {
      parsed.maxContactFacts = Number(arg.slice("--max-contact-facts=".length));
      continue;
    }

    if (arg === "--max-trend-summaries" && argv[index + 1]) {
      parsed.maxTrendSummaries = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-trend-summaries=")) {
      parsed.maxTrendSummaries = Number(arg.slice("--max-trend-summaries=".length));
      continue;
    }

    if (arg === "--max-correlations" && argv[index + 1]) {
      parsed.maxCorrelations = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-correlations=")) {
      parsed.maxCorrelations = Number(arg.slice("--max-correlations=".length));
      continue;
    }

    if (arg === "--max-snippet-chars" && argv[index + 1]) {
      parsed.maxSnippetChars = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-snippet-chars=")) {
      parsed.maxSnippetChars = Number(arg.slice("--max-snippet-chars=".length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  const integerFields = [
    "minSignalScore",
    "minThreadMessages",
    "maxOutput",
    "maxMessageInsights",
    "maxThreadSummaries",
    "maxContactFacts",
    "maxTrendSummaries",
    "maxCorrelations",
    "maxSnippetChars",
  ];
  for (const field of integerFields) {
    const value = Number(parsed[field]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`--${field.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)} must be >= 0`);
    }
    parsed[field] = Math.trunc(value);
  }

  return parsed;
}

function printUsage() {
  process.stdout.write(
    [
      "PST memory analysis gateway",
      "",
      "Purpose:",
      "  Distill high-signal insights from raw PST-derived memory JSONL before Open Memory import.",
      "",
      "Usage:",
      "  node ./scripts/pst-memory-analysis-gateway.mjs \\",
      "    --input ./imports/pst/mailbox-raw-memory.jsonl \\",
      "    --output ./imports/pst/mailbox-analysis-memory.jsonl \\",
      "    --report ./output/open-memory/pst-analysis-gateway-latest.json",
      "",
      "Key options:",
      "  --min-signal-score <n>      Minimum message signal score (default: 2)",
      "  --max-output <n>            Total analyzed memories cap (default: 250)",
      "  --max-message-insights <n>  Per-message insight cap (default: 120)",
      "  --max-thread-summaries <n>  Thread synthesis cap (default: 80)",
      "  --max-contact-facts <n>     Contact insight cap (default: 30)",
      "  --max-trend-summaries <n>   Trend summary cap (default: 10)",
      "  --max-correlations <n>      Correlation insight cap (default: 10)",
      "  --json                      Print machine-readable report",
    ].join("\n")
  );
}

function readJsonl(inputPath) {
  const raw = readFileSync(inputPath, "utf8");
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        entries.push(parsed);
      }
    } catch {
      // ignore malformed lines for this deterministic gateway
    }
  }
  return entries;
}

function writeJsonl(outputPath, rows) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(outputPath, body.length > 0 ? `${body}\n` : "", "utf8");
}

function writeJson(outputPath, value) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stableHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value, maxChars) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function parseDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp);
}

function isoDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return value.toISOString().slice(0, 10);
}

function normalizeSubject(value) {
  let subject = normalizeWhitespace(value);
  if (!subject) return "";
  for (let i = 0; i < 6; i += 1) {
    const updated = subject.replace(/^(re|fw|fwd)\s*:\s*/i, "").trim();
    if (updated === subject) break;
    subject = updated;
  }
  return subject;
}

function normalizeIdentity(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function extractAddressParts(value) {
  const raw = String(value || "");
  const parts = raw
    .split(/[;,]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const entries = [];

  for (const part of parts) {
    const bracketMatch = part.match(/^(.*?)<([^>]+)>$/);
    if (bracketMatch) {
      const alias = normalizeWhitespace(bracketMatch[1] || "");
      const email = toCanonicalEmail(bracketMatch[2] || "");
      entries.push({ alias, email });
      continue;
    }

    const directEmail = toCanonicalEmail(part);
    if (directEmail) {
      entries.push({ alias: "", email: directEmail });
      continue;
    }

    const extracted = extractEmails(part);
    if (extracted.length > 0) {
      const cleanedAlias = normalizeWhitespace(part.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ""));
      for (const email of extracted) {
        entries.push({ alias: cleanedAlias, email });
      }
      continue;
    }

    const alias = normalizeWhitespace(part.replace(/[<>"']/g, ""));
    if (alias) {
      entries.push({ alias, email: "" });
    }
  }

  return entries;
}

function stripQuotedSections(value) {
  const text = String(value || "");
  if (!text.trim()) {
    return {
      body: "",
      quoteLines: 0,
      quotedMarkerCount: 0,
    };
  }

  const lines = text.split(/\r?\n/);
  const bodyLines = [];
  let quoteLines = 0;
  let quotedMarkerCount = 0;
  let inQuotedBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed && !inQuotedBlock) {
      bodyLines.push("");
      continue;
    }

    if (/^on .+wrote:$/i.test(trimmed) || /^from:\s.+$/i.test(trimmed) || /^-----original message-----$/i.test(trimmed)) {
      inQuotedBlock = true;
      quotedMarkerCount += 1;
      quoteLines += 1;
      continue;
    }
    if (/^>+/.test(trimmed)) {
      inQuotedBlock = true;
      quoteLines += 1;
      continue;
    }
    if (inQuotedBlock && (/^(sent|to|subject|cc):\s/i.test(trimmed) || trimmed === "")) {
      quoteLines += 1;
      continue;
    }
    if (inQuotedBlock && trimmed && !/^[-_=]{2,}$/.test(trimmed)) {
      // Continue skipping known quoted payload once quote mode started.
      quoteLines += 1;
      continue;
    }

    bodyLines.push(line);
  }

  return {
    body: normalizeWhitespace(bodyLines.join(" ")),
    quoteLines,
    quotedMarkerCount,
  };
}

function fingerprintText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toCanonicalEmail(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) {
    return trimmed;
  }
  return "";
}

function extractEmails(value) {
  const found = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const normalized = new Set();
  for (const email of found) {
    const canonical = toCanonicalEmail(email);
    if (canonical) normalized.add(canonical);
  }
  return [...normalized];
}

function tokenize(value) {
  const sanitized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9@._ -]+/g, " ");
  return sanitized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !token.includes("@"))
    .filter((token) => !STOP_WORDS.has(token));
}

function topTermsFromTokens(tokens, limit, minCount = 1) {
  const frequencies = new Map();
  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }
  return [...frequencies.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([token]) => token);
}

function dedupeValues(values) {
  const seen = new Set();
  const deduped = [];
  for (const value of values) {
    const text = normalizeWhitespace(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(text);
  }
  return deduped;
}

function detectSignals(text) {
  const normalized = normalizeWhitespace(text);
  const categories = [];
  let score = 0;

  for (const [category, patterns] of Object.entries(SIGNAL_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      categories.push(category);
      score += SIGNAL_WEIGHTS[category] || 1;
    }
  }

  const hasDateCue = /\b(by|before|on)\s+(mon|tues|wednes|thurs|fri|satur|sun|q[1-4]|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})/i.test(
    normalized
  );
  if (hasDateCue) {
    score += SIGNAL_WEIGHTS.dateCue;
  }

  return {
    categories,
    score,
    hasDateCue,
  };
}

function formatParticipantList(participants, limit = 3) {
  const unique = dedupeValues(participants);
  if (unique.length === 0) return "unknown participants";
  if (unique.length <= limit) return unique.join(", ");
  const shown = unique.slice(0, limit).join(", ");
  return `${shown} (+${unique.length - limit} more)`;
}

function pairKey(a, b) {
  return [a, b].sort((left, right) => left.localeCompare(right)).join("::");
}

function buildAliasLookup(messages) {
  const map = new Map();
  const remember = (aliasValue, emailValue) => {
    const alias = normalizeIdentity(aliasValue);
    const email = toCanonicalEmail(emailValue);
    if (!alias || !email) return;
    map.set(alias, email);
  };

  for (const message of messages) {
    for (const entry of message.fromAddressEntries) {
      remember(entry.alias, entry.email);
    }
    for (const entry of message.toAddressEntries) {
      remember(entry.alias, entry.email);
    }
  }
  return map;
}

function canonicalizeIdentity(identity, aliasLookup) {
  const normalized = normalizeIdentity(identity);
  if (!normalized) return "";
  const asEmail = toCanonicalEmail(normalized);
  if (asEmail) return asEmail;
  return aliasLookup.get(normalized) || normalized;
}

function buildThreadKey({ metadata, threadSubject, canonicalParticipants }) {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const explicitThreadHint = normalizeWhitespace(
    meta.threadId || meta.threadKey || meta.conversationId || meta.conversationIndex || meta.inReplyTo || meta.references
  );
  if (explicitThreadHint) {
    return `conversation:${explicitThreadHint.toLowerCase()}`;
  }
  const subject = normalizeSubject(threadSubject || "");
  if (subject) {
    return `subject:${subject.toLowerCase()}`;
  }
  const participantAnchor = canonicalParticipants
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 4)
    .join(",");
  return `participants:${participantAnchor || "unknown"}`;
}

function createMessageModel(rawItem, index, maxSnippetChars) {
  const metadata = rawItem?.metadata && typeof rawItem.metadata === "object" ? rawItem.metadata : {};
  const rawSubject = normalizeWhitespace(metadata.subject || "");
  const subject = normalizeSubject(rawSubject || "");
  const fromRaw = String(metadata.from || "").trim();
  const toRaw = String(metadata.to || "").trim();
  const fromAddressEntries = extractAddressParts(fromRaw);
  const toAddressEntries = extractAddressParts(toRaw);
  const fromEmails = dedupeValues(fromAddressEntries.map((entry) => entry.email).filter(Boolean));
  const toEmails = dedupeValues(toAddressEntries.map((entry) => entry.email).filter(Boolean));
  const fromAliases = dedupeValues(fromAddressEntries.map((entry) => entry.alias).filter(Boolean));
  const toAliases = dedupeValues(toAddressEntries.map((entry) => entry.alias).filter(Boolean));
  const participants = dedupeValues([...fromEmails, ...toEmails, ...fromAliases, ...toAliases]);

  const content = normalizeWhitespace(rawItem?.content || "");
  const quoteSplit = stripQuotedSections(rawItem?.content || "");
  const contentCore = quoteSplit.body || content;
  const snippet = clip(contentCore || content, maxSnippetChars);
  const date = parseDate(rawItem?.occurredAt || metadata.messageDate || rawItem?.createdAt || "");
  const dateLabel = date ? isoDate(date) : "unknown-date";

  const threadSubject = subject || normalizeSubject(contentCore.slice(0, 120));
  const signal = detectSignals(`${subject} ${contentCore}`);
  const tokens = tokenize(`${subject} ${contentCore}`);
  const stableSourceId =
    String(rawItem?.clientRequestId || "").trim() ||
    `raw-${stableHash(`${index}|${subject}|${contentCore}|${fromRaw}|${toRaw}`).slice(0, 24)}`;
  const isReply =
    /^(re|fw|fwd)\s*:/i.test(rawSubject) ||
    quoteSplit.quotedMarkerCount > 0 ||
    /(^|\s)wrote:/i.test(String(rawItem?.content || ""));
  const nearDuplicateFingerprint = stableHash(
    `${normalizeSubject(threadSubject)}|${fingerprintText(fromRaw || fromEmails[0] || "")}|${fingerprintText(contentCore)}`
  ).slice(0, 32);

  return {
    index,
    rawItem,
    metadata,
    subject,
    fromRaw,
    toRaw,
    fromAddressEntries,
    toAddressEntries,
    fromEmails,
    toEmails,
    fromAliases,
    toAliases,
    participants,
    canonicalParticipants: participants,
    canonicalSender: fromEmails[0] || normalizeIdentity(fromAliases[0] || fromRaw || "unknown"),
    content,
    contentCore,
    snippet,
    date,
    dateLabel,
    threadSubject,
    threadKey: buildThreadKey({
      metadata,
      threadSubject,
      canonicalParticipants: participants,
    }),
    signal,
    tokens,
    stableSourceId,
    isReply,
    quoteLines: quoteSplit.quoteLines,
    quotedMarkerCount: quoteSplit.quotedMarkerCount,
    nearDuplicateFingerprint,
  };
}

function createMemoryRecord({
  analysisType,
  content,
  tags,
  occurredAt,
  metadata,
  score,
  source,
  uniqueKey,
}) {
  const normalizedContent = normalizeWhitespace(content);
  const clientRequestId = `pst-ana-${stableHash(`${analysisType}|${uniqueKey}|${normalizedContent}`).slice(0, 24)}`;
  return {
    analysisType,
    rankScore: (TYPE_PRIORITIES[analysisType] || 0) + Math.max(0, Number(score) || 0),
    row: {
      content: normalizedContent,
      source,
      tags: dedupeValues(["pst", "analysis", analysisType.replace(/_/g, "-"), ...(tags || [])]),
      metadata: {
        analysisType,
        score: Number(score) || 0,
        ...metadata,
      },
      clientRequestId,
      occurredAt: occurredAt || undefined,
    },
  };
}

function buildMessageInsights(messages, options) {
  const candidates = messages
    .filter((message) => message.signal.score >= options.minSignalScore)
    .sort((left, right) => {
      if (right.signal.score !== left.signal.score) return right.signal.score - left.signal.score;
      const leftTime = left.date ? left.date.getTime() : 0;
      const rightTime = right.date ? right.date.getTime() : 0;
      return rightTime - leftTime;
    })
    .slice(0, options.maxMessageInsights);

  return candidates.map((message) => {
    const sender = message.canonicalSender || message.fromEmails[0] || normalizeWhitespace(message.fromRaw) || "unknown sender";
    const recipients = message.toEmails.length > 0 ? message.toEmails.join(", ") : normalizeWhitespace(message.toRaw) || "unknown recipients";
    const subject = message.subject || "no subject";
    const categories = message.signal.categories.length > 0 ? message.signal.categories.join(", ") : "general";
    const content = `High-signal email on ${message.dateLabel}: ${sender} -> ${recipients}, subject "${subject}". Signals: ${categories}. Summary: ${message.snippet}`;
    return createMemoryRecord({
      analysisType: "message_insight",
      content,
      tags: [...message.signal.categories, "email-insight"],
      occurredAt: message.date ? message.date.toISOString() : undefined,
      score: message.signal.score,
      source: options.source,
      uniqueKey: message.stableSourceId,
      metadata: {
        threadKey: message.threadKey,
        sourceClientRequestId: message.stableSourceId,
        subject,
        sender,
        recipients,
        canonicalParticipants: message.canonicalParticipants.slice(0, 12),
        replyDetected: message.isReply,
        quoteLines: message.quoteLines,
        signalCategories: message.signal.categories,
      },
    });
  });
}

function buildThreadSummaries(messages, options) {
  const byThread = new Map();
  for (const message of messages) {
    const list = byThread.get(message.threadKey) || [];
    list.push(message);
    byThread.set(message.threadKey, list);
  }

  const summaries = [];
  for (const [threadKey, threadMessages] of byThread.entries()) {
    if (threadMessages.length < options.minThreadMessages) continue;

    const sorted = [...threadMessages].sort((a, b) => {
      const left = a.date ? a.date.getTime() : 0;
      const right = b.date ? b.date.getTime() : 0;
      return left - right;
    });
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const allParticipants = dedupeValues(sorted.flatMap((message) => message.participants));
    const allTokens = sorted.flatMap((message) => message.tokens);
    const topTerms = topTermsFromTokens(allTokens, 5, 2);
    const signals = {
      decision: 0,
      action: 0,
      risk: 0,
      financial: 0,
      timeline: 0,
    };
    let threadScore = 0;
    let replyMessageCount = 0;
    let quoteLinkedMessages = 0;

    for (const message of sorted) {
      threadScore += message.signal.score;
      if (message.isReply) replyMessageCount += 1;
      if (message.quoteLines > 0 || message.quotedMarkerCount > 0) quoteLinkedMessages += 1;
      for (const category of message.signal.categories) {
        if (Object.prototype.hasOwnProperty.call(signals, category)) {
          signals[category] += 1;
        }
      }
    }

    const bestMessage = [...sorted].sort((a, b) => b.signal.score - a.signal.score)[0];
    const subject = first.threadSubject || "Untitled thread";
    const content = `Email thread "${subject}" ran ${first.dateLabel} to ${last.dateLabel} with ${sorted.length} messages across ${allParticipants.length} participants (${formatParticipantList(allParticipants)}). Reply continuity: ${replyMessageCount} replies, ${quoteLinkedMessages} quote-linked messages. Themes: ${
      topTerms.length > 0 ? topTerms.join(", ") : "mixed discussion"
    }. Signal mix: ${signals.decision} decision, ${signals.action} action, ${signals.risk} risk cues. Key takeaway: ${bestMessage.snippet}`;

    summaries.push(
      createMemoryRecord({
        analysisType: "thread_summary",
        content,
        tags: ["thread-summary", ...topTerms],
        occurredAt: last.date ? last.date.toISOString() : undefined,
        score: Math.round(threadScore / sorted.length),
        source: options.source,
        uniqueKey: threadKey,
        metadata: {
          threadKey,
          subject,
          messageCount: sorted.length,
          participantCount: allParticipants.length,
          participants: allParticipants.slice(0, 12),
          canonicalParticipants: allParticipants.slice(0, 12),
          replyMessageCount,
          quoteLinkedMessages,
          signalMix: signals,
          themes: topTerms,
          sourceClientRequestIds: sorted.map((message) => message.stableSourceId).slice(0, 50),
        },
      })
    );
  }

  return summaries
    .sort((left, right) => right.rankScore - left.rankScore)
    .slice(0, options.maxThreadSummaries);
}

function buildContactFacts(messages, options) {
  const contacts = new Map();
  for (const message of messages) {
    for (const participant of message.participants) {
      const state =
        contacts.get(participant) ||
        {
          count: 0,
          threads: new Set(),
          tokens: [],
          highSignalCount: 0,
          firstDate: null,
          lastDate: null,
          counterparts: new Map(),
        };
      state.count += 1;
      state.threads.add(message.threadKey);
      state.tokens.push(...message.tokens);
      if (message.signal.score >= options.minSignalScore) {
        state.highSignalCount += 1;
      }
      if (message.date) {
        if (!state.firstDate || message.date < state.firstDate) state.firstDate = message.date;
        if (!state.lastDate || message.date > state.lastDate) state.lastDate = message.date;
      }
      for (const peer of message.participants) {
        if (peer === participant) continue;
        state.counterparts.set(peer, (state.counterparts.get(peer) || 0) + 1);
      }
      contacts.set(participant, state);
    }
  }

  const rows = [];
  for (const [email, state] of contacts.entries()) {
    if (state.count < 3) continue;
    const topThemes = topTermsFromTokens(state.tokens, 4, 2);
    const topPeers = [...state.counterparts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([peer]) => peer);
    const firstLabel = isoDate(state.firstDate);
    const lastLabel = isoDate(state.lastDate);
    const content = `${email} is a recurrent contact (${state.count} messages across ${state.threads.size} threads${firstLabel ? `, ${firstLabel} to ${lastLabel}` : ""}). High-signal participation: ${state.highSignalCount} messages. Recurring themes: ${
      topThemes.length > 0 ? topThemes.join(", ") : "mixed"
    }. Frequent collaborators: ${topPeers.length > 0 ? topPeers.join(", ") : "none detected"}.`;

    rows.push(
      createMemoryRecord({
        analysisType: "contact_fact",
        content,
        tags: ["contact", ...topThemes],
        occurredAt: state.lastDate ? state.lastDate.toISOString() : undefined,
        score: state.highSignalCount + Math.round(state.count / 3),
        source: options.source,
        uniqueKey: email,
        metadata: {
          contact: email,
          messageCount: state.count,
          threadCount: state.threads.size,
          highSignalCount: state.highSignalCount,
          themes: topThemes,
          topCounterparts: topPeers,
        },
      })
    );
  }

  return rows.sort((left, right) => right.rankScore - left.rankScore).slice(0, options.maxContactFacts);
}

function buildTrendSummaries(messages, options) {
  if (messages.length === 0) return [];

  const monthCounts = new Map();
  const allTokens = [];
  let highSignalCount = 0;
  const highSignalBySender = new Map();

  for (const message of messages) {
    const monthKey = message.date ? message.date.toISOString().slice(0, 7) : "unknown";
    monthCounts.set(monthKey, (monthCounts.get(monthKey) || 0) + 1);
    allTokens.push(...message.tokens);
    if (message.signal.score >= options.minSignalScore) {
      highSignalCount += 1;
      const sender = message.fromEmails[0] || normalizeWhitespace(message.fromRaw) || "unknown";
      highSignalBySender.set(sender, (highSignalBySender.get(sender) || 0) + 1);
    }
  }

  const monthsSorted = [...monthCounts.entries()].sort((a, b) => b[1] - a[1]);
  const topMonth = monthsSorted[0];
  const secondMonth = monthsSorted[1];
  const topThemes = topTermsFromTokens(allTokens, 6, 2);
  const topHighSignalSenders = [...highSignalBySender.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sender, count]) => `${sender} (${count})`);

  const rows = [];
  rows.push(
    createMemoryRecord({
      analysisType: "trend_summary",
      content: `Mailbox trend snapshot: ${
        topMonth ? `${topMonth[0]} had the highest volume (${topMonth[1]} messages)` : "no dominant month detected"
      }${secondMonth ? `, followed by ${secondMonth[0]} (${secondMonth[1]})` : ""}.`,
      tags: ["trend", "volume"],
      occurredAt: new Date().toISOString(),
      score: 8,
      source: options.source,
      uniqueKey: "trend-volume",
      metadata: {
        monthCounts: Object.fromEntries(monthCounts),
      },
    })
  );

  rows.push(
    createMemoryRecord({
      analysisType: "trend_summary",
      content: `Recurring mailbox themes: ${topThemes.length > 0 ? topThemes.join(", ") : "insufficient repeated terms"} across ${messages.length} messages.`,
      tags: ["trend", "themes", ...topThemes.slice(0, 3)],
      occurredAt: new Date().toISOString(),
      score: 7,
      source: options.source,
      uniqueKey: "trend-themes",
      metadata: {
        themes: topThemes,
        totalMessages: messages.length,
      },
    })
  );

  rows.push(
    createMemoryRecord({
      analysisType: "trend_summary",
      content: `High-signal density: ${highSignalCount}/${messages.length} messages (${Math.round(
        (highSignalCount / Math.max(1, messages.length)) * 100
      )}%) carried decision/action/risk cues.`,
      tags: ["trend", "signal-density"],
      occurredAt: new Date().toISOString(),
      score: 7,
      source: options.source,
      uniqueKey: "trend-signal-density",
      metadata: {
        highSignalCount,
        totalMessages: messages.length,
        minSignalScore: options.minSignalScore,
      },
    })
  );

  if (topHighSignalSenders.length > 0) {
    rows.push(
      createMemoryRecord({
        analysisType: "trend_summary",
        content: `Top high-signal senders: ${topHighSignalSenders.join(", ")}.`,
        tags: ["trend", "senders"],
        occurredAt: new Date().toISOString(),
        score: 6,
        source: options.source,
        uniqueKey: "trend-high-signal-senders",
        metadata: {
          highSignalBySender: Object.fromEntries(highSignalBySender),
        },
      })
    );
  }

  return rows.slice(0, options.maxTrendSummaries);
}

function buildCorrelations(messages, options) {
  const byThread = new Map();
  for (const message of messages) {
    const bucket = byThread.get(message.threadKey) || [];
    bucket.push(message);
    byThread.set(message.threadKey, bucket);
  }

  const participantPairs = new Map();
  const topicPairs = new Map();
  for (const threadMessages of byThread.values()) {
    const participants = dedupeValues(threadMessages.flatMap((message) => message.participants));
    for (let i = 0; i < participants.length; i += 1) {
      for (let j = i + 1; j < participants.length; j += 1) {
        const key = pairKey(participants[i], participants[j]);
        participantPairs.set(key, (participantPairs.get(key) || 0) + 1);
      }
    }

    const topTerms = topTermsFromTokens(threadMessages.flatMap((message) => message.tokens), 4, 2);
    for (let i = 0; i < topTerms.length; i += 1) {
      for (let j = i + 1; j < topTerms.length; j += 1) {
        const key = pairKey(topTerms[i], topTerms[j]);
        topicPairs.set(key, (topicPairs.get(key) || 0) + 1);
      }
    }
  }

  const rows = [];
  const topParticipantPairs = [...participantPairs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, Math.floor(options.maxCorrelations / 2)));
  for (const [pair, count] of topParticipantPairs) {
    if (count < 2) continue;
    const [left, right] = pair.split("::");
    rows.push(
      createMemoryRecord({
        analysisType: "correlation",
        content: `Correlation: ${left} and ${right} co-appeared in ${count} threads, indicating repeated collaboration context.`,
        tags: ["correlation", "participants"],
        occurredAt: new Date().toISOString(),
        score: count + 3,
        source: options.source,
        uniqueKey: `participants:${pair}`,
        metadata: {
          correlationType: "participant_pair",
          left,
          right,
          threadCount: count,
        },
      })
    );
  }

  const remaining = Math.max(0, options.maxCorrelations - rows.length);
  const topTopicPairs = [...topicPairs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, remaining);
  for (const [pair, count] of topTopicPairs) {
    if (count < 2) continue;
    const [left, right] = pair.split("::");
    rows.push(
      createMemoryRecord({
        analysisType: "correlation",
        content: `Correlation: topics "${left}" and "${right}" co-occurred in ${count} threads and should be treated as linked context.`,
        tags: ["correlation", "topics", left, right],
        occurredAt: new Date().toISOString(),
        score: count + 2,
        source: options.source,
        uniqueKey: `topics:${pair}`,
        metadata: {
          correlationType: "topic_pair",
          left,
          right,
          threadCount: count,
        },
      })
    );
  }

  return rows.slice(0, options.maxCorrelations);
}

function dedupeAndLimit(insights, maxOutput) {
  const seen = new Set();
  const ordered = insights.sort((a, b) => b.rankScore - a.rankScore);
  const deduped = [];
  for (const insight of ordered) {
    const contentKey = stableHash(insight.row.content.toLowerCase());
    if (seen.has(contentKey)) continue;
    seen.add(contentKey);
    deduped.push(insight.row);
    if (deduped.length >= maxOutput) break;
  }
  return deduped;
}

function summarizeCounts(rows) {
  const counts = {
    message_insight: 0,
    thread_summary: 0,
    contact_fact: 0,
    trend_summary: 0,
    correlation: 0,
  };
  for (const row of rows) {
    const kind = String(row?.metadata?.analysisType || "");
    if (Object.prototype.hasOwnProperty.call(counts, kind)) {
      counts[kind] += 1;
    }
  }
  return counts;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = resolve(REPO_ROOT, options.input);
  const outputPath = resolve(REPO_ROOT, options.output);
  const reportPath = resolve(REPO_ROOT, options.report);

  if (!existsSync(inputPath)) {
    throw new Error(`Input JSONL not found: ${inputPath}`);
  }

  const rawEntries = readJsonl(inputPath);
  const messagesPreDedup = rawEntries.map((entry, index) => createMessageModel(entry, index, options.maxSnippetChars));

  const aliasLookup = buildAliasLookup(messagesPreDedup);
  for (const message of messagesPreDedup) {
    const canonicalParticipants = dedupeValues(
      message.participants
        .map((participant) => canonicalizeIdentity(participant, aliasLookup))
        .filter(Boolean)
    );
    const canonicalSender =
      canonicalizeIdentity(
        message.fromEmails[0] || message.fromAliases[0] || message.fromRaw || "unknown",
        aliasLookup
      ) || "unknown";
    message.canonicalParticipants = canonicalParticipants.length > 0 ? canonicalParticipants : message.participants;
    message.canonicalSender = canonicalSender;
    message.threadKey = buildThreadKey({
      metadata: message.metadata,
      threadSubject: message.threadSubject,
      canonicalParticipants: message.canonicalParticipants,
    });
    message.nearDuplicateFingerprint = stableHash(
      `${message.threadKey}|${message.canonicalSender}|${fingerprintText(message.contentCore)}`
    ).slice(0, 32);
  }

  const messageByStableId = new Map();
  for (const message of messagesPreDedup) {
    if (!message.content) continue;
    const dedupeKey = `${message.stableSourceId}|${message.nearDuplicateFingerprint}`;
    const existing = messageByStableId.get(dedupeKey);
    if (!existing) {
      messageByStableId.set(dedupeKey, message);
      continue;
    }
    const existingScore = Number(existing.signal?.score || 0);
    const incomingScore = Number(message.signal?.score || 0);
    const existingBody = Number(existing.contentCore?.length || 0);
    const incomingBody = Number(message.contentCore?.length || 0);
    if (incomingScore > existingScore || (incomingScore === existingScore && incomingBody > existingBody)) {
      messageByStableId.set(dedupeKey, message);
    }
  }
  const messages = [...messageByStableId.values()];

  const messageInsights = buildMessageInsights(messages, options);
  const threadSummaries = buildThreadSummaries(messages, options);
  const contactFacts = buildContactFacts(messages, options);
  const trendSummaries = buildTrendSummaries(messages, options);
  const correlations = buildCorrelations(messages, options);

  const finalRows = dedupeAndLimit(
    [...messageInsights, ...threadSummaries, ...contactFacts, ...trendSummaries, ...correlations],
    options.maxOutput
  );

  writeJsonl(outputPath, finalRows);

  const counts = summarizeCounts(finalRows);
  const highSignalMessageCount = messages.filter((message) => message.signal.score >= options.minSignalScore).length;
  const uniqueThreadCount = new Set(messages.map((message) => message.threadKey)).size;
  const report = {
    schema: "pst-memory-analysis-gateway-report.v1",
    generatedAt: new Date().toISOString(),
    status: "ok",
    inputPath: options.input,
    outputPath: options.output,
    summary: {
      rawInputRows: rawEntries.length,
      parsedMessages: messages.length,
      highSignalMessages: highSignalMessageCount,
      uniqueThreads: uniqueThreadCount,
      aliasLinksResolved: Array.from(aliasLookup.entries()).length,
      analyzedMemoriesWritten: finalRows.length,
      ingestionReductionRatio:
        rawEntries.length > 0 ? Number((finalRows.length / rawEntries.length).toFixed(4)) : 0,
      caps: {
        maxOutput: options.maxOutput,
        maxMessageInsights: options.maxMessageInsights,
        maxThreadSummaries: options.maxThreadSummaries,
        maxContactFacts: options.maxContactFacts,
        maxTrendSummaries: options.maxTrendSummaries,
        maxCorrelations: options.maxCorrelations,
      },
    },
    breakdown: counts,
  };

  writeJson(reportPath, report);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write("pst-memory-analysis-gateway complete\n");
  process.stdout.write(`input:  ${inputPath}\n`);
  process.stdout.write(`output: ${outputPath}\n`);
  process.stdout.write(`report: ${reportPath}\n`);
  process.stdout.write(`raw rows: ${report.summary.rawInputRows}\n`);
  process.stdout.write(`analyzed rows: ${report.summary.analyzedMemoriesWritten}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `pst-memory-analysis-gateway failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
