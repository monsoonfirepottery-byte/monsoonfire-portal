#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);

function readFlag(name, fallback = undefined) {
  const key = `--${name}`;
  const index = args.indexOf(key);
  if (index === -1) return fallback;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) return "true";
  return next;
}

function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeWhitespace(text) {
  return text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function redactLikelySecrets(text) {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._-]{20,}\b/g, "Bearer [REDACTED]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_FIREBASE_KEY]")
    .replace(/(\b(?:password|token|secret|api[_-]?key)\b\s*[:=]\s*)([^\s]+)/gi, "$1[REDACTED]");
}

function shortHash(text, size = 24) {
  return createHash("sha256").update(text).digest("hex").slice(0, size);
}

function shouldSkipText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  const lineCount = trimmed.split("\n").length;

  const boilerplatePatterns = [
    /^<permissions instructions>/i,
    /^# AGENTS\.md instructions/i,
    /^<environment_context>/i,
    /^<collaboration_mode>/i,
    /^<INSTRUCTIONS>/i,
    /^## JavaScript REPL/i,
    /^## Skills/i,
    /^## Apps/i,
    /^You are Codex, a coding agent/i,
  ];
  if (boilerplatePatterns.some((pattern) => pattern.test(trimmed))) return true;
  if (/^<subagent_notification>/i.test(trimmed)) return true;
  if (/^\s*[\w.-]+@[\w.-]+:.*\$\s/m.test(trimmed)) return true;
  if (lineCount > 25 && /(?:\bsudo\b|\bnpm\b|\bnode\b|\bgit\b|\bcurl\b|\bsystemctl\b|\bdocker\b)/i.test(trimmed)) {
    return true;
  }

  if (
    trimmed.length > 1_500 &&
    /(View & Copy Prompt|<role>|<guardrails>|<execution>|<context-gathering>)/i.test(trimmed)
  ) {
    return true;
  }

  return false;
}

function collectJsonlFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && full.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  }
  return files.sort();
}

function parseLines(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // ignore invalid lines
    }
  }
  return parsed;
}

const sessionsRoot = resolve(readFlag("sessions-root", "/home/wuff/.codex/sessions"));
const outputPath = resolve(readFlag("output", "./imports/codex-resumable-memory.jsonl"));
const source = String(readFlag("source", "codex-resumable-session"));
const tenantIdFlag = readFlag("tenant-id", "");
const tenantId = tenantIdFlag ? String(tenantIdFlag).trim() : "";
const includeAssistant = String(readFlag("include-assistant", "false")).toLowerCase() === "true";
const maxChars = toInt(readFlag("max-chars", "900"), 900);
const minChars = toInt(readFlag("min-chars", "12"), 12);
const maxItems = toInt(readFlag("max-items", "5000"), 5000);
const excludeRecentMinutes = toInt(readFlag("exclude-recent-minutes", "10"), 10);

const nowMs = Date.now();
const recentCutoffMs = nowMs - excludeRecentMinutes * 60_000;

const files = collectJsonlFiles(sessionsRoot);
const seen = new Set();
const items = [];

let filesScanned = 0;
let filesSkippedRecent = 0;
let messagesScanned = 0;
let droppedBoilerplate = 0;
let droppedShort = 0;
let droppedDuplicate = 0;
let droppedRole = 0;
let droppedInvalid = 0;
let clipped = 0;

for (const filePath of files) {
  let stats;
  try {
    stats = statSync(filePath);
  } catch {
    continue;
  }
  if (Number.isFinite(stats.mtimeMs) && stats.mtimeMs >= recentCutoffMs) {
    filesSkippedRecent += 1;
    continue;
  }

  filesScanned += 1;
  const events = parseLines(filePath);
  for (const event of events) {
    if (!event || event.type !== "response_item") continue;
    const payload = event.payload;
    if (!payload || payload.type !== "message") continue;

    const role = String(payload.role ?? "").trim().toLowerCase();
    if (role !== "user" && !(includeAssistant && role === "assistant")) {
      droppedRole += 1;
      continue;
    }

    const content = Array.isArray(payload.content) ? payload.content : [];
    for (const part of content) {
      const textValue =
        part && typeof part === "object" && typeof part.text === "string" ? part.text : "";
      if (!textValue) {
        droppedInvalid += 1;
        continue;
      }
      messagesScanned += 1;
      let normalized = normalizeWhitespace(textValue);
      if (shouldSkipText(normalized)) {
        droppedBoilerplate += 1;
        continue;
      }
      if (normalized.length < minChars) {
        droppedShort += 1;
        continue;
      }
      normalized = redactLikelySecrets(normalized);
      if (normalized.length > maxChars) {
        normalized = `${normalized.slice(0, maxChars - 13).trimEnd()} [truncated]`;
        clipped += 1;
      }

      const dedupeKey = `${role}:${normalized.toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        droppedDuplicate += 1;
        continue;
      }
      seen.add(dedupeKey);

      const metadata = {
        extraction: "codex-resumable-session",
        role,
        sessionFile: relative(process.cwd(), filePath),
        capturedAt: typeof event.timestamp === "string" ? event.timestamp : null,
      };
      const sessionStem = basename(filePath, ".jsonl");
      const runId = `resume-${shortHash(sessionStem, 16)}`;
      const clientRequestId = `resume-${shortHash(
        `${metadata.sessionFile}|${metadata.capturedAt ?? ""}|${role}|${normalized}`,
        24
      )}`;
      const item = {
        content: normalized,
        source,
        tags: ["codex", "resumable-session", role],
        metadata,
        agentId: "agent:codex-resumable",
        runId,
        clientRequestId,
      };
      if (tenantId) item.tenantId = tenantId;
      items.push(item);

      if (items.length >= maxItems) {
        break;
      }
    }
    if (items.length >= maxItems) break;
  }
  if (items.length >= maxItems) break;
}

mkdirSync(dirname(outputPath), { recursive: true });
const out = items.map((entry) => JSON.stringify(entry)).join("\n");
writeFileSync(outputPath, out.length ? `${out}\n` : "", "utf8");

const summary = {
  sessionsRoot,
  outputPath,
  source,
  tenantId: tenantId || null,
  includeAssistant,
  filesTotal: files.length,
  filesScanned,
  filesSkippedRecent,
  messagesScanned,
  extracted: items.length,
  dropped: {
    boilerplate: droppedBoilerplate,
    short: droppedShort,
    duplicate: droppedDuplicate,
    role: droppedRole,
    invalid: droppedInvalid,
  },
  clipped,
  generatedAt: new Date().toISOString(),
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
