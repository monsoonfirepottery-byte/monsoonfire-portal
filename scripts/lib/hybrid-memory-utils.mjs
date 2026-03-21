import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { clipText } from "./pst-memory-utils.mjs";

export const DEFAULT_MARKDOWN_EXCLUDE_PATTERNS = [
  /^docs\/generated\//i,
  /^output\//i,
  /^coverage\//i,
  /^dist\//i,
  /^node_modules\//i,
  /^web\/dist\//i,
  /^studio-brain\/lib\//i,
  /^tmp\//i,
  /^temp\//i,
  /\.generated\.md$/i,
];

const DEV_SIGNAL_PATTERNS = [
  { pattern: /\bmonsoonfire\b|\bportal\b|\bstudio brain\b|\bstudio-brain\b/i, weight: 4 },
  { pattern: /\b(firebase|cloud functions|typescript|javascript|node|npm|sqlite|schema|migration)\b/i, weight: 3 },
  { pattern: /\b(repo|repository|branch|commit|pr|pull request|issue|ticket|lint|test|build|deploy|script)\b/i, weight: 3 },
  { pattern: /(^|\s)(web\/|functions\/|studio-brain\/|docs\/|tickets\/|scripts\/)/i, weight: 3 },
  { pattern: /`[^`]+`|\/[A-Za-z0-9._/-]+\.[a-z]{1,6}\b/i, weight: 2 },
  { pattern: /\b(api|endpoint|runbook|playwright|firestore|vector|embedding|memory|corpus|markdown)\b/i, weight: 2 },
];

const PERSONAL_SIGNAL_PATTERNS = [
  { pattern: /\b(furry|fursona|dating|boyfriend|girlfriend|wife|husband|shopping|wishlist|vacation)\b/i, weight: 4 },
  { pattern: /\b(apartment|rent|landlord|mortgage|therapy|medical|doctor|family|birthday)\b/i, weight: 3 },
  { pattern: /\b(recipe|food|movie|tv|game|gaming|pet|cat|dog)\b/i, weight: 2 },
  { pattern: /\b(sora|image prompt|cover letter|resume advice)\b/i, weight: 2 },
];

const PROJECT_LANE_RULES = [
  {
    lane: "studio-brain",
    patterns: [/^studio-brain\//i, /\bstudio brain\b/i, /\bmemory service\b/i, /\bopen memory\b/i],
  },
  {
    lane: "functions",
    patterns: [/^functions\//i, /\bcloud functions\b/i, /\bfirestore\b/i, /\bfirebase function/i],
  },
  {
    lane: "website",
    patterns: [/^website\//i, /\bwebsite\b/i, /\bmonsoonfire\.com\b/i, /\bga\b/i, /\bseo\b/i],
  },
  {
    lane: "monsoonfire-portal",
    patterns: [
      /^web\//i,
      /^docs\//i,
      /^tickets\//i,
      /\bmonsoonfire\b/i,
      /\bportal\b/i,
      /\breservations\b/i,
      /\bkiln\b/i,
      /\bmaterials\b/i,
    ],
  },
  {
    lane: "real-estate",
    patterns: [/\breal estate\b/i, /\bzillow\b/i, /\bphoenix\b/i, /\bwest valley\b/i],
  },
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /override\s+system\s+prompt/i,
  /you\s+must\s+execute\s+this\s+command/i,
  /run\s+this\s+shell\s+command/i,
  /exfiltrate\s+secrets/i,
  /bypass\s+safety\s+rails/i,
];

const SECRET_PATTERNS = [
  { pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g, replacement: "Bearer [REDACTED]" },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, replacement: "[REDACTED_FIREBASE_KEY]" },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: "[REDACTED_OPENAI_KEY]" },
  { pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
  { pattern: /(\b(?:password|token|secret|api[_-]?key|refresh[_-]?token|access[_-]?token)\b\s*[:=]\s*)([^\s]+)/gi, replacement: "$1[REDACTED]" },
];

function hash(value, len = 24) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, len);
}

function toForwardSlash(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

export function normalizeHybridText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeLine(value) {
  return normalizeHybridText(value).replace(/\s+/g, " ").trim();
}

export function stableContentHash(value, len = 24) {
  return hash(normalizeHybridText(value), len);
}

export function redactLikelySecrets(value) {
  let redacted = String(value ?? "");
  for (const entry of SECRET_PATTERNS) {
    redacted = redacted.replace(entry.pattern, entry.replacement);
  }
  return redacted;
}

export function detectPoisoning(value) {
  const text = normalizeHybridText(value);
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function buildContextSignals(value) {
  const text = ` ${normalizeLine(value).toLowerCase()} `;
  return {
    decisionLike: /\b(decision|decided|approved|approval|final|confirmed|ship|shipped|landed|keep)\b/.test(text),
    actionLike: /\b(action item|todo|next step|follow up|follow-up|owner|assign|implement|add|create)\b/.test(text),
    blockerLike: /\b(blocker|blocked|incident|outage|failure|bug|error|risk|escalat)\b/.test(text),
    deadlineLike: /\b(deadline|due|eta|today|tomorrow|eod|eow|this week|by friday|by monday)\b/.test(text),
    urgentLike: /\b(urgent|asap|priority|p0|p1|sev1|sev2|critical)\b/.test(text),
    reopenedLike: /\b(reopen|re-open|regression|back again|recurred)\b/.test(text),
    correctionLike: /\b(correction|supersede|superseded|ignore previous|replacement|latest update)\b/.test(text),
  };
}

export function classifyDevelopmentScope({ text = "", title = "", path = "" } = {}) {
  const combined = `${title}\n${path}\n${text}`;
  const normalized = normalizeHybridText(combined);
  let devScore = 0;
  let personalScore = 0;
  const reasons = [];

  for (const entry of DEV_SIGNAL_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      devScore += entry.weight;
      reasons.push(`dev:${entry.pattern.source}`);
    }
  }
  for (const entry of PERSONAL_SIGNAL_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      personalScore += entry.weight;
      reasons.push(`personal:${entry.pattern.source}`);
    }
  }

  const isDevelopment = devScore >= 3 && devScore >= personalScore;
  const isPersonal = personalScore >= 4 && personalScore > devScore;
  const confidence = Math.max(0, Math.min(1, (Math.abs(devScore - personalScore) + Math.max(devScore, personalScore)) / 12));

  return {
    isDevelopment,
    isPersonal,
    confidence: Number(confidence.toFixed(3)),
    devScore,
    personalScore,
    reasons,
  };
}

export function inferProjectLane({ text = "", title = "", path = "" } = {}) {
  const scope = classifyDevelopmentScope({ text, title, path });
  if (scope.isPersonal && !scope.isDevelopment) return "personal";
  const haystack = `${toForwardSlash(path)}\n${title}\n${text}`;
  for (const rule of PROJECT_LANE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return rule.lane;
    }
  }
  if (scope.isDevelopment) return "general-dev";
  return "unknown";
}

function recursiveMarkdownFiles(root, relativeBase = "") {
  const current = relativeBase ? resolve(root, relativeBase) : root;
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const relativePath = toForwardSlash(relativeBase ? join(relativeBase, entry.name) : entry.name);
    if (entry.isDirectory()) {
      out.push(...recursiveMarkdownFiles(root, relativePath));
      continue;
    }
    if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      out.push(relativePath);
    }
  }
  return out;
}

export function listGitTrackedMarkdownPaths(repoRoot, { excludePatterns = DEFAULT_MARKDOWN_EXCLUDE_PATTERNS } = {}) {
  const root = resolve(repoRoot);
  const git = spawnSync("git", ["-C", root, "ls-files", "*.md"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const candidates =
    git.status === 0 && git.stdout
      ? String(git.stdout)
          .split(/\r?\n/)
          .map((line) => toForwardSlash(line.trim()))
          .filter(Boolean)
      : recursiveMarkdownFiles(root);

  return candidates
    .filter((relativePath) => !excludePatterns.some((pattern) => pattern.test(relativePath)))
    .filter((relativePath) => {
      try {
        return statSync(resolve(root, relativePath)).isFile();
      } catch {
        return false;
      }
    })
    .sort((left, right) => left.localeCompare(right));
}

export function summarizeMarkdownSection(markdown, { heading = "", maxChars = 320 } = {}) {
  const section = normalizeHybridText(markdown);
  if (!section) return "";
  const withoutCode = section.replace(/```[\s\S]*?```/g, " ");
  const lines = withoutCode
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
  const base = lines.length > 0 ? lines.join(" | ") : section;
  const prefix = normalizeLine(heading);
  const summary = prefix && !base.toLowerCase().startsWith(prefix.toLowerCase()) ? `${prefix}: ${base}` : base;
  return clipText(summary, maxChars);
}

function splitOversizedSection(text, maxChars) {
  const normalized = normalizeHybridText(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = paragraph;
      continue;
    }
    const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
    let sentenceChunk = "";
    for (const sentence of sentences) {
      const candidate = sentenceChunk ? `${sentenceChunk} ${sentence}` : sentence;
      if (candidate.length <= maxChars) {
        sentenceChunk = candidate;
        continue;
      }
      if (sentenceChunk) chunks.push(sentenceChunk);
      sentenceChunk = sentence;
    }
    if (sentenceChunk) {
      chunks.push(sentenceChunk);
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function chunkMarkdownDocument(markdown, { docPath = "", maxChars = 2200 } = {}) {
  const lines = String(markdown ?? "").replace(/\r/g, "").split("\n");
  const stack = [];
  const sections = [];
  const headingOccurrences = new Map();
  const fallbackHeading = basename(String(docPath || "document"), extname(String(docPath || "document"))) || "document";
  let currentHeading = fallbackHeading;
  let currentLevel = 0;
  let currentLines = [];

  const flush = () => {
    const body = normalizeHybridText(currentLines.join("\n"));
    if (!body) return;
    const headingPathBase = stack.length > 0 ? stack.map((entry) => entry.text).join(" > ") : fallbackHeading;
    const headingPathPartsBase = stack.length > 0 ? stack.map((entry) => entry.text) : [fallbackHeading];
    const occurrence = Number(headingOccurrences.get(headingPathBase) || 0) + 1;
    headingOccurrences.set(headingPathBase, occurrence);
    const uniqueHeadingPathBase = occurrence > 1 ? `${headingPathBase} [repeat ${occurrence}]` : headingPathBase;
    const headingPathParts =
      occurrence > 1
        ? [...headingPathPartsBase.slice(0, -1), `${headingPathPartsBase[headingPathPartsBase.length - 1]} [repeat ${occurrence}]`]
        : headingPathPartsBase;
    const split = splitOversizedSection(body, maxChars);
    split.forEach((part, index) => {
      const headingPath = split.length > 1 ? `${uniqueHeadingPathBase} [part ${index + 1}]` : uniqueHeadingPathBase;
      sections.push({
        docPath: toForwardSlash(docPath),
        heading: currentHeading,
        headingPath,
        headingPathParts,
        level: currentLevel,
        chunkIndex: index,
        text: part,
        contentHash: stableContentHash(part, 32),
        chunkId: hash(`${toForwardSlash(docPath)}|${headingPath}|${part}`, 32),
        summary: summarizeMarkdownSection(part, { heading: headingPath, maxChars: 320 }),
      });
    });
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      flush();
      currentLevel = headingMatch[1].length;
      currentHeading = normalizeLine(headingMatch[2]) || fallbackHeading;
      while (stack.length > 0 && stack[stack.length - 1].level >= currentLevel) {
        stack.pop();
      }
      stack.push({ level: currentLevel, text: currentHeading });
      currentLines = [line];
      continue;
    }
    currentLines.push(line);
  }
  flush();

  if (sections.length === 0) {
    const whole = normalizeHybridText(markdown);
    if (!whole) return [];
    return [
      {
        docPath: toForwardSlash(docPath),
        heading: fallbackHeading,
        headingPath: fallbackHeading,
        headingPathParts: [fallbackHeading],
        level: 0,
        chunkIndex: 0,
        text: whole,
        contentHash: stableContentHash(whole, 32),
        chunkId: hash(`${toForwardSlash(docPath)}|${whole}`, 32),
        summary: summarizeMarkdownSection(whole, { heading: fallbackHeading, maxChars: 320 }),
      },
    ];
  }

  return sections;
}

function sentenceCandidates(text) {
  const normalized = normalizeHybridText(text);
  if (!normalized) return [];
  const lines = normalized
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return [...lines, ...sentences]
    .map((line) => normalizeLine(line))
    .filter((line) => line.length >= 24 && line.length <= 480);
}

export function extractStructuredCandidates(text, { title = "", maxCandidates = 6 } = {}) {
  const candidates = [];
  const seen = new Set();
  const titleSummary = normalizeLine(title);

  const classify = (segment) => {
    const normalized = ` ${normalizeLine(segment).toLowerCase()} `;
    if (!normalized.trim()) return null;
    if (/\b(decision|decided|approved|approval|final|confirmed|we will|go with|ship|landed)\b/.test(normalized)) {
      return { kind: "decision", analysisType: "codex_decision", score: 0.92, prefix: "Decision" };
    }
    if (/\b(open loop|open-loop|pending|unresolved|outstanding|still open|blocked on|follow up|next step|todo)\b/.test(normalized)) {
      return { kind: "open_loop", analysisType: "codex_open_loop", score: 0.9, prefix: "Open loop" };
    }
    if (/\b(prefer|preference|default to|avoid|don't want|always|never|i like|i want)\b/.test(normalized)) {
      return { kind: "preference", analysisType: "codex_preference", score: 0.84, prefix: "Preference" };
    }
    if (/\b(hypothesis|likely|probably|suspect|seems|appears|inference)\b/.test(normalized)) {
      return { kind: "hypothesis", analysisType: "codex_hypothesis", score: 0.76, prefix: "Hypothesis" };
    }
    if (/\b(because|evidence|source:|see |ticket|issue|pr|commit)\b/.test(normalized) || /https?:\/\//.test(segment)) {
      return { kind: "evidence", analysisType: "codex_evidence_link", score: 0.72, prefix: "Evidence" };
    }
    return null;
  };

  for (const segment of sentenceCandidates(text)) {
    const match = classify(segment);
    if (!match) continue;
    const dedupeKey = `${match.kind}|${segment.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const summary = clipText(`${match.prefix}: ${segment}`, 240);
    const contextSignals = buildContextSignals(summary);
    const patternHints = [];
    if (match.kind === "open_loop") patternHints.push("state:open-loop");
    if (contextSignals.urgentLike) patternHints.push("priority:urgent");
    if (contextSignals.reopenedLike) patternHints.push("state:reopened");
    if (contextSignals.correctionLike) patternHints.push("state:superseded");
    if (contextSignals.decisionLike && !contextSignals.blockerLike) patternHints.push("state:resolved");
    candidates.push({
      kind: match.kind,
      analysisType: match.analysisType,
      summary,
      score: match.score,
      contextSignals,
      patternHints,
      titleSummary,
    });
    if (candidates.length >= maxCandidates) break;
  }

  return candidates;
}
