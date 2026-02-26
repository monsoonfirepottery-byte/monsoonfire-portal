#!/usr/bin/env node

/* eslint-disable no-console */

import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..", "..");

const TZ = "America/Phoenix";
const PRIMARY_WINDOW_HOURS = 12;
const SECONDARY_WINDOW_HOURS = 24;
const STRUCTURAL_MIN_HOURS = 24;

const codexDir = resolve(repoRoot, ".codex");
const toolcallPath = resolve(codexDir, "toolcalls.ndjson");
const improvementStatePath = resolve(codexDir, "improvement-state.json");
const interactionLogPath = resolve(codexDir, "interaction-log.md");
const userDocPath = resolve(codexDir, "user.md");
const agentsDocPath = resolve(codexDir, "agents.md");

const rollingIssueTitle = "Codex Interaction Interrogation (Rolling)";
const epicPath = "docs/epics/EPIC-CODEX-INTERACTION-INTERROGATION.md";

const ignoreChurnPaths = new Set([
  ".codex/user.md",
  ".codex/agents.md",
  epicPath,
]);

const metadataMatchers = [
  /^firebase\.json$/,
  /^firestore\.rules$/,
  /^storage\.rules$/,
  /^tsconfig[^/]*\.json$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^\.github\/workflows\//,
  /^web\/package\.json$/,
  /^functions\/package\.json$/,
  /^web\/package-lock\.json$/,
  /^functions\/package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
];

const secretKeyPattern = /(token|secret|password|authorization|api[_-]?key|cookie|session|private[_-]?key)/i;
const secretValuePatterns = [
  /bearer\s+[a-z0-9._~-]+/gi,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /(gh[opsu]_[A-Za-z0-9_]{20,})/g,
  /(sk-[A-Za-z0-9]{20,})/g,
];

const AUTO_START = "<!-- codex-interaction:auto:start -->";
const AUTO_END = "<!-- codex-interaction:auto:end -->";

const RULE_CATALOG = {
  user: {
    USER_CANONICAL_TERMS:
      "When domain enums are involved, include canonical values (for example `SHELF_PURCHASE|WHOLE_KILN|COMMUNITY_SHELF`) and avoid synonyms.",
    USER_FIRESTORE_PAYLOAD:
      "State Firestore payload constraints explicitly: never write `undefined`; omit fields or send `null` only when schema allows.",
    USER_SCHEDULING_BOUNDARY:
      "Prompt must state whether a change affects scheduling/triggers; if excluded, specify the exclusion rule directly.",
    USER_BRANCH_POLICY:
      "Include branch policy in scope constraints: PR-only changes, never direct push to `main`.",
    USER_PROMPT_STRUCTURE:
      "Require `Objective`, `Constraints`, `Non-goals`, and `Definition of Done` in implementation prompts.",
    USER_SCOPE_FENCE:
      "Explicitly list in-scope and out-of-scope surfaces to prevent scope creep.",
    USER_OUTPUT_CONTRACT:
      "Require output sections for behavior change summary, risk assessment, and copyable QA checks.",
  },
  agents: {
    AGENT_ENUM_RESOLUTION:
      "Resolve instruction terms to concrete schema/enum values before coding; if unresolved after one pass, pick the safest canonical option and log assumptions.",
    AGENT_NO_UNDEFINED_GUARD:
      "Before Firestore writes, assert that payloads contain no `undefined` values.",
    AGENT_SCHEDULING_MATRIX:
      "When touching scheduling logic, produce an explicit include/exclude matrix and corresponding regression check.",
    AGENT_BRANCH_ENFORCEMENT:
      "Enforce PR-only delivery with protected-branch behavior; never push directly to `main`.",
    AGENT_DECIDE_AFTER_ONE_CLARIFY:
      "Ask at most one clarification when risk is bounded; then execute with explicit assumptions to reduce back-and-forth loops.",
    AGENT_RETRY_STOP_TWO:
      "After two identical tool failures, stop blind retries and switch strategy with a classified failure note.",
    AGENT_SCOPE_LOCK:
      "Reject out-of-scope edits unless explicitly requested by user constraints.",
    AGENT_STRUCTURED_PR_NOTES:
      "PR updates must include friction evidence, structural rationale, risk assessment, and QA observation guidance.",
  },
};

const DEFAULT_TOP_LEVEL_STATE = {
  lastRunAtIso: "1970-01-01T00:00:00.000Z",
  lastRunId: "1970-01-01-AM",
  lastSeenCommitSha: "",
  rolling7Day: {
    errorCounts: {},
    ciFailures: 0,
    churnFiles: {},
    ticketsCreated: 0,
    ticketsClosed: 0,
  },
  lastRecommendations: [],
  recommendationOutcomes: [],
};

function defaultInteractionNamespace() {
  return {
    lastRunAtIso: "1970-01-01T00:00:00.000Z",
    lastRunId: "1970-01-01-AM",
    lastPatternIds: [],
    lastTopRecommendations: [],
    lastImpactScore: 100,
    recentImpactScores: [],
    activeRuleIds: {
      user: [],
      agents: [],
    },
    lastRuleUpdateRunId: "n/a",
    lastStructuralEditAtIso: "",
    lastSkillDensity: {
      firestore: 0,
      cloudFunctions: 0,
      schedulingLogic: 0,
      metadataConfig: 0,
      tooling: 0,
      workflowPolicy: 0,
      automation: 0,
    },
    lastToolFailureRate24: 0,
    lastErrorClusterCount: 0,
    lastHighChurnCount: 0,
    lastCiFailureRepeats: 0,
    followThroughHistory: [],
  };
}

function defaultSharedCoordination() {
  return {
    automationPrByRunId: {},
  };
}

function parseArgs(argv) {
  const options = {
    apply: false,
    dryRun: true,
    persistDryRun: false,
    asJson: false,
    includeGithub: true,
    force: false,
    allowDirty: false,
    nowIso: "",
    runId: "",
    maxRulesPerRun: 10,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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

    if (arg === "--persist-dry-run") {
      options.persistDryRun = true;
      continue;
    }

    if (arg === "--no-github") {
      options.includeGithub = false;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--allow-dirty") {
      options.allowDirty = true;
      continue;
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--now") {
      options.nowIso = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--run-id") {
      options.runId = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--max-rules") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid --max-rules value: ${next}`);
      }
      options.maxRulesPerRun = Math.floor(value);
      index += 1;
      continue;
    }
  }

  return options;
}

function toMs(value) {
  if (!value) return null;
  const parsed = new Date(value);
  const millis = parsed.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function sanitizeString(value) {
  if (typeof value !== "string") return value;
  let output = value;
  for (const pattern of secretValuePatterns) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

function sanitizeValue(value, keyHint = "") {
  if (value == null) return value;
  if (secretKeyPattern.test(keyHint)) return "[REDACTED]";

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, keyHint));
  }

  if (typeof value === "object") {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = sanitizeValue(nested, key);
    }
    return output;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  return value;
}

function runCommand(command, args, { allowFailure = false, cwd = repoRoot, env = process.env } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
  });
  const durationMs = Date.now() - startedAt;
  const code = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");

  if (code !== 0 && !allowFailure) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }

  return {
    code,
    ok: code === 0,
    stdout,
    stderr,
    durationMs,
  };
}

function runGit(args, options = {}) {
  return runCommand("git", args, options);
}

function runGh(args, options = {}) {
  return runCommand("gh", args, options);
}

function runGhJson(args, { allowFailure = true } = {}) {
  const response = runGh(args, { allowFailure });
  if (!response.ok) {
    return {
      ok: false,
      data: null,
      error: response.stderr || response.stdout || "gh command failed",
    };
  }

  try {
    return {
      ok: true,
      data: response.stdout.trim() ? JSON.parse(response.stdout) : null,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: `Invalid JSON from gh: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function runGhApiPaginated(baseEndpoint, maxPages = 5) {
  const allItems = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = baseEndpoint.includes("?") ? "&" : "?";
    const endpoint = `${baseEndpoint}${separator}per_page=100&page=${page}`;
    const response = runGhJson(["api", endpoint]);
    if (!response.ok) {
      return {
        ok: false,
        data: allItems,
        error: response.error,
      };
    }

    const pageItems = Array.isArray(response.data) ? response.data : [];
    allItems.push(...pageItems);
    if (pageItems.length < 100) {
      break;
    }
  }

  return {
    ok: true,
    data: allItems,
    error: "",
  };
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function buildAutoBlock(target, ruleIds, ruleUpdateRunId) {
  const bucket = RULE_CATALOG[target] || {};
  const lines = [AUTO_START, "### Automated Structural Addenda", ""];
  lines.push(`- Last structural update: ${ruleUpdateRunId || "n/a"}`);

  if (!Array.isArray(ruleIds) || ruleIds.length === 0) {
    lines.push("- No active automated addenda.");
  } else {
    lines.push("- Active rules:");
    for (const id of ruleIds) {
      const text = bucket[id];
      if (!text) continue;
      lines.push(`- [${id}] ${text}`);
    }
  }

  lines.push(AUTO_END);
  return `${lines.join("\n")}\n`;
}

function replaceAutoBlock(content, block) {
  const safe = String(content || "");
  if (safe.includes(AUTO_START) && safe.includes(AUTO_END)) {
    const pattern = new RegExp(`${AUTO_START}[\\s\\S]*?${AUTO_END}`, "m");
    return safe.replace(pattern, block.trimEnd());
  }
  return `${safe.trimEnd()}\n\n${block}`;
}

function defaultUserDocTemplate() {
  return [
    "# Codex User Interaction Contract",
    "",
    "## Prompt Shape (Required)",
    "",
    "- Include `Objective` in one sentence.",
    "- Include explicit `Constraints` (security, branch policy, environment limits).",
    "- Include `Non-goals` to prevent scope creep.",
    "- Include `Definition of Done` with observable checks.",
    "",
    "## Scope Boundary Rules",
    "",
    "- Prefer targeted requests over broad rewrites.",
    "- Explicitly list pages/services in scope.",
    "- Call out excluded files or systems when needed.",
    "",
    "## Non-Negotiables",
    "",
    "- No direct push to `main`.",
    "- No secrets in prompts, logs, or payload examples.",
    "- Production safety takes priority over speed when risk is unclear.",
    "- Guardrails and contracts outrank stylistic preferences.",
    "",
    "## Preferred Output Contract",
    "",
    "- Short status of what changed.",
    "- Files touched.",
    "- Behavior impact and risk callout.",
    "- Copyable QA checklist when behavior changed.",
    "",
    buildAutoBlock("user", [], "n/a").trimEnd(),
    "",
  ].join("\n");
}

function defaultAgentsDocTemplate() {
  return [
    "# Codex Agent Execution Contract",
    "",
    "## Role Responsibilities",
    "",
    "- Deliver production-safe changes with minimal user bottlenecks.",
    "- Use deterministic workflows and explicit contracts.",
    "- Keep implementation scoped; avoid opportunistic expansion.",
    "",
    "## Ask vs Decide Policy",
    "",
    "- Ask only when choices have non-obvious risk or conflicting outcomes.",
    "- Otherwise decide, execute, and surface assumptions after implementation.",
    "- If blocked, present the smallest actionable decision needed.",
    "",
    "## Tool Usage Guardrails",
    "",
    "- Prefer repeatable commands over ad hoc manual sequences.",
    "- Classify failures by signature before retrying.",
    "- Avoid infinite retry loops; switch strategy after repeated identical failures.",
    "",
    "## Delivery Policy",
    "",
    "- Never push directly to `main`.",
    "- Use branch + PR flow for autonomous changes.",
    "- Keep PRs evidence-based: analysis, rationale, risk, QA.",
    "",
    "## Workflow Constraints",
    "",
    "- Preserve branch protection and deploy safety checks.",
    "- Respect Firestore payload rules (`undefined` never written).",
    "- Preserve existing security defaults unless explicitly changed.",
    "",
    buildAutoBlock("agents", [], "n/a").trimEnd(),
    "",
  ].join("\n");
}

async function ensureContracts() {
  await mkdir(codexDir, { recursive: true });

  if (!(await pathExists(toolcallPath))) {
    await writeFile(toolcallPath, "", "utf8");
  }

  if (!(await pathExists(improvementStatePath))) {
    await writeFile(improvementStatePath, `${JSON.stringify(DEFAULT_TOP_LEVEL_STATE, null, 2)}\n`, "utf8");
  }

  if (!(await pathExists(interactionLogPath))) {
    await writeFile(
      interactionLogPath,
      "# Codex Interaction Interrogation Log\n\nThis file is append-only per run and tracks interaction friction analysis plus structural adjustments.\n",
      "utf8"
    );
  }

  if (!(await pathExists(userDocPath))) {
    await writeFile(userDocPath, defaultUserDocTemplate(), "utf8");
  }

  if (!(await pathExists(agentsDocPath))) {
    await writeFile(agentsDocPath, defaultAgentsDocTemplate(), "utf8");
  }
}

async function readJsonFile(path, fallback) {
  try {
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function appendToolcall(entry) {
  const payload = {
    tsIso: entry.tsIso || new Date().toISOString(),
    actor: entry.actor || "codex",
    tool: entry.tool || "daily-interaction",
    action: entry.action || "analyze",
    ok: entry.ok === true,
    durationMs: typeof entry.durationMs === "number" ? Math.round(entry.durationMs) : null,
    errorType: typeof entry.errorType === "string" && entry.errorType.trim() ? entry.errorType.trim() : null,
    errorMessage:
      typeof entry.errorMessage === "string" && entry.errorMessage.trim()
        ? sanitizeString(entry.errorMessage.trim())
        : null,
    context: entry.context == null ? null : sanitizeValue(entry.context),
  };
  await appendFile(toolcallPath, `${JSON.stringify(payload)}\n`, "utf8");
}

function nowDate(options) {
  if (!options.nowIso) return new Date();
  const parsed = new Date(options.nowIso);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid --now value: ${options.nowIso}`);
  }
  return parsed;
}

function detectRunActor() {
  return process.env.GITHUB_ACTIONS === "true" ? "github-action" : "codex";
}

function getPhoenixRunInfo(nowUtc) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(nowUtc);
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  const hour = Number(map.hour || "0");
  const runSlot = hour < 12 ? "AM" : "PM";
  const dateKey = `${map.year}-${map.month}-${map.day}`;

  return {
    dateKey,
    runSlot,
    runId: `${dateKey}-${runSlot}`,
    localClock: `${map.hour}:${map.minute}:${map.second}`,
  };
}

function parseRepoSlug() {
  const envSlug = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (envSlug) return envSlug;

  const remote = runGit(["config", "--get", "remote.origin.url"], { allowFailure: true });
  if (!remote.ok) return "";
  const value = remote.stdout.trim();
  if (!value) return "";

  const sshMatch = value.match(/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (sshMatch) return sshMatch[1];

  const httpsMatch = value.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (httpsMatch) return httpsMatch[1];

  return "";
}

function getWorkingTreeDirty() {
  const result = runGit(["status", "--porcelain"], { allowFailure: true });
  if (!result.ok) return false;
  return result.stdout.trim().length > 0;
}

function parseCommitLog(stdout) {
  const commits = [];
  const lines = String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const firstTab = line.indexOf("\t");
    const secondTab = line.indexOf("\t", firstTab + 1);
    if (firstTab <= 0 || secondTab <= firstTab) continue;

    const sha = line.slice(0, firstTab);
    const unix = Number(line.slice(firstTab + 1, secondTab));
    const subject = line.slice(secondTab + 1);
    if (!sha) continue;

    commits.push({
      sha,
      unix,
      atIso: Number.isFinite(unix) ? new Date(unix * 1000).toISOString() : null,
      subject,
    });
  }

  return commits;
}

function collectCommitsSince(sinceIso) {
  const result = runGit([
    "log",
    `--since=${sinceIso}`,
    "--pretty=format:%H%x09%ct%x09%s",
  ]);
  return parseCommitLog(result.stdout);
}

function collectFileCommitCountsSince(sinceIso) {
  const result = runGit([
    "log",
    `--since=${sinceIso}`,
    "--name-only",
    "--pretty=format:__COMMIT__%H",
  ]);

  const counts = new Map();
  let activeCommit = "";
  for (const rawLine of String(result.stdout || "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("__COMMIT__")) {
      activeCommit = line.slice("__COMMIT__".length).trim();
      continue;
    }

    if (!activeCommit) continue;
    const normalized = line.replace(/\\/g, "/");
    if (!counts.has(normalized)) {
      counts.set(normalized, new Set());
    }
    counts.get(normalized).add(activeCommit);
  }

  const output = {};
  for (const [path, commitSet] of counts.entries()) {
    output[path] = commitSet.size;
  }
  return output;
}

async function readToolcalls() {
  let raw = "";
  try {
    raw = await readFile(toolcallPath, "utf8");
  } catch {
    return { entries: [], invalidLines: 0 };
  }

  const entries = [];
  let invalidLines = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      invalidLines += 1;
    }
  }

  return { entries, invalidLines };
}

function filterByTimeWindow(items, key, sinceMs) {
  return items.filter((item) => {
    const ts = toMs(item?.[key]);
    return ts != null && ts >= sinceMs;
  });
}

function hasAutomationLabel(item) {
  const labels = Array.isArray(item?.labels) ? item.labels : [];
  return labels.some((label) => String(label?.name || "").toLowerCase() === "automation");
}

function parseNumberFromUrl(url, marker) {
  const value = String(url || "");
  const regex = new RegExp(`/${marker}/(\\d+)$`);
  const match = value.match(regex);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function toLowerText(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueSorted(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean))).sort();
}

function arraysEqual(a, b) {
  const left = uniqueSorted(a);
  const right = uniqueSorted(b);
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function countAlternations(entries) {
  let alternations = 0;
  let previous = "";
  for (const entry of entries) {
    const current = String(entry.author || "");
    if (!current) continue;
    if (previous && current !== previous) {
      alternations += 1;
    }
    previous = current;
  }
  return alternations;
}

function ensureRecommendation(recommendations, recommendation) {
  if (!recommendation?.id) return;
  if (recommendations.some((item) => item.id === recommendation.id)) return;
  recommendations.push(recommendation);
}

function isMetadataPath(path) {
  return metadataMatchers.some((matcher) => matcher.test(path));
}

function buildInteractionLogEntry({
  runInfo,
  summary,
  recommendations,
  structuralDecision,
  nextFocus,
}) {
  const lines = [];
  lines.push(`## ${runInfo.dateKey} (${runInfo.runSlot})`);
  lines.push("");
  lines.push("### Interaction Summary");
  lines.push(`- Commits analyzed: ${summary.commitsAnalyzed}`);
  lines.push(`- PR discussions analyzed: ${summary.prDiscussionsAnalyzed}`);
  lines.push(`- Clarification loops detected: ${summary.clarificationLoopsDetected}`);
  lines.push("");
  lines.push("### Friction Patterns");
  if (recommendations.length === 0) {
    lines.push("- None crossed thresholds in this window.");
  } else {
    for (const recommendation of recommendations) {
      lines.push(`- ${recommendation.title}`);
    }
  }
  lines.push("");
  lines.push("### Structural Adjustments Made");
  lines.push(`- user.md ${structuralDecision.userUpdated ? "updated" : "unchanged"}`);
  lines.push(`- agents.md ${structuralDecision.agentsUpdated ? "updated" : "unchanged"}`);
  lines.push("");
  lines.push("### Next Observation Focus");
  for (const item of nextFocus) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildRollingIssueComment({
  runInfo,
  summary,
  recommendations,
  structuralDecision,
  nextFocus,
  prUrl,
}) {
  const lines = [];
  lines.push(`## ${runInfo.dateKey} (${runInfo.runSlot})`);
  lines.push("");
  lines.push("### Interaction Summary");
  lines.push(`- Commits analyzed: ${summary.commitsAnalyzed}`);
  lines.push(`- PR discussions analyzed: ${summary.prDiscussionsAnalyzed}`);
  lines.push(`- Clarification loops detected: ${summary.clarificationLoopsDetected}`);
  lines.push(`- Impact score: ${summary.impactScore}`);
  lines.push("");
  lines.push("### Friction Patterns");
  if (recommendations.length === 0) {
    lines.push("- None crossed thresholds in this window.");
  } else {
    for (const recommendation of recommendations.slice(0, 10)) {
      lines.push(`- ${recommendation.id}: ${recommendation.trigger}`);
    }
  }
  lines.push("");
  lines.push("### Structural Decision");
  lines.push(`- ${structuralDecision.mode}`);
  lines.push(`- Reason: ${structuralDecision.reason}`);
  lines.push(`- user.md: ${structuralDecision.userUpdated ? "updated" : "unchanged"}`);
  lines.push(`- agents.md: ${structuralDecision.agentsUpdated ? "updated" : "unchanged"}`);
  lines.push("");
  lines.push("### PR");
  lines.push(`- ${prUrl || "None"}`);
  lines.push("");
  lines.push("### Next Observation Focus");
  nextFocus.forEach((item) => lines.push(`- ${item}`));
  lines.push("");
  return lines.join("\n");
}

function buildPrBody({
  runInfo,
  recommendations,
  previousUserRules,
  nextUserRules,
  previousAgentRules,
  nextAgentRules,
  structuralDecision,
}) {
  const lines = [];
  lines.push(`# Interaction Interrogation ${runInfo.runId}`);
  lines.push("");
  lines.push("## 1) Interaction Failure Analysis");
  if (recommendations.length === 0) {
    lines.push("- No threshold-triggered patterns in this run.");
  } else {
    for (const recommendation of recommendations.slice(0, 8)) {
      lines.push(`- **${recommendation.title}**`);
      lines.push(`  - Trigger: ${recommendation.trigger}`);
      lines.push(`  - Why friction: ${recommendation.why}`);
      if (recommendation.evidence.length > 0) {
        lines.push("  - Evidence:");
        for (const evidence of recommendation.evidence.slice(0, 5)) {
          lines.push(`    - ${evidence}`);
        }
      }
    }
  }
  lines.push("");
  lines.push("## 2) Proposed Structural Improvement");
  lines.push("### `.codex/user.md` (Before -> After)");
  lines.push("```text");
  lines.push(`Before rules: ${previousUserRules.length === 0 ? "none" : previousUserRules.join(", ")}`);
  lines.push(`After rules: ${nextUserRules.length === 0 ? "none" : nextUserRules.join(", ")}`);
  lines.push("```");
  lines.push("");
  lines.push("### `.codex/agents.md` (Before -> After)");
  lines.push("```text");
  lines.push(`Before rules: ${previousAgentRules.length === 0 ? "none" : previousAgentRules.join(", ")}`);
  lines.push(`After rules: ${nextAgentRules.length === 0 ? "none" : nextAgentRules.join(", ")}`);
  lines.push("```");
  lines.push("");
  lines.push(`Rationale: ${structuralDecision.reason}`);
  lines.push("");
  lines.push("## 3) Risk Assessment");
  lines.push("- Could over-constrain future flexibility if rules become too strict for novel requests.");
  lines.push("- Mitigation: add only structural guardrails tied to repeated evidence clusters.");
  lines.push("- This PR avoids tone/personality rewrites and limits scope to contracts/guardrails.");
  lines.push("");
  lines.push("## 4) QA Guidance");
  lines.push("1. Watch next 2-3 runs for reduction in repeated clarification loops (>3 comments).");
  lines.push("2. Verify repeated misunderstandings (intakeMode, Firestore undefined, scheduling exclusion) trend down.");
  lines.push("3. Confirm no second automation PR is opened for the same run slot.");
  lines.push("4. Confirm rule additions are structural and not cosmetic.");
  lines.push("");
  return lines.join("\n");
}

function buildPrComment({ runInfo, recommendations, structuralDecision }) {
  const lines = [];
  lines.push(`## Interaction Interrogation Update (${runInfo.runId})`);
  lines.push("");
  lines.push("Structural changes were applied to this run PR to avoid opening a second automation PR.");
  lines.push(`- Decision: ${structuralDecision.mode}`);
  lines.push(`- Reason: ${structuralDecision.reason}`);
  lines.push("");
  if (recommendations.length > 0) {
    lines.push("Top friction patterns:");
    recommendations.slice(0, 6).forEach((recommendation) => {
      lines.push(`- ${recommendation.title}: ${recommendation.trigger}`);
    });
  } else {
    lines.push("No threshold-triggered patterns detected.");
  }
  lines.push("");
  return lines.join("\n");
}

async function ensureGhLabel(repoSlug, name, color, description, enabled) {
  if (!enabled) return;
  runGh(
    [
      "label",
      "create",
      name,
      "--repo",
      repoSlug,
      "--color",
      color,
      "--description",
      description,
      "--force",
    ],
    { allowFailure: true }
  );
}

function buildNextFocus(recommendations, structuralDecision, skillSpikes) {
  const next = [];

  if (recommendations.length > 0) {
    next.push(`Confirm remediation for top cluster: ${recommendations[0].title}.`);
  } else {
    next.push("Monitor for new repeated misunderstanding clusters before broad policy changes.");
  }

  if (skillSpikes.length > 0) {
    next.push(`Review skill-density spike guardrails for: ${skillSpikes.join(", ")}.`);
  }

  if (structuralDecision.mode === "Deferred") {
    next.push("Re-check structural edit cooldown and verify whether trigger persists in next run.");
  }

  next.push("Track clarification loops and tool retry signatures in next 12h window.");
  return uniqueSorted(next);
}

function isAutomationCommitSubject(subject) {
  const value = toLowerText(subject);
  return (
    value.includes("chore(codex): continuous improvement") ||
    value.includes("chore(codex): interaction interrogation")
  );
}

function parseNormalizedState(rawState) {
  const state = rawState && typeof rawState === "object" ? rawState : {};

  const interaction = {
    ...defaultInteractionNamespace(),
    ...(state.interactionInterrogation && typeof state.interactionInterrogation === "object"
      ? state.interactionInterrogation
      : {}),
    activeRuleIds: {
      ...defaultInteractionNamespace().activeRuleIds,
      ...(state?.interactionInterrogation?.activeRuleIds || {}),
    },
  };

  const sharedCoordination = {
    ...defaultSharedCoordination(),
    ...(state.sharedCoordination && typeof state.sharedCoordination === "object"
      ? state.sharedCoordination
      : {}),
  };

  return {
    state,
    interaction,
    sharedCoordination,
  };
}

function clampScore(value) {
  return Math.max(0, Math.min(100, value));
}

function parseLabels(entry) {
  const labels = Array.isArray(entry?.labels) ? entry.labels : [];
  return labels.map((label) => String(label?.name || "").toLowerCase());
}

function summarizeFollowThrough(previousTopIds, currentRecommendations, evidenceFallback, githubAvailable) {
  const currentIds = new Set(currentRecommendations.map((recommendation) => recommendation.id));
  const byId = new Map(currentRecommendations.map((recommendation) => [recommendation.id, recommendation]));
  const output = [];

  for (const id of previousTopIds.slice(0, 3)) {
    const recommendation = byId.get(id);
    let status = "Achieved";

    if (!githubAvailable) {
      status = "Blocked";
    } else if (recommendation) {
      status = "In Progress";
    } else if (!evidenceFallback || evidenceFallback.length === 0) {
      status = "Not Started";
    }

    const evidence = recommendation?.evidence?.length
      ? recommendation.evidence.slice(0, 3)
      : evidenceFallback.slice(0, 3);

    output.push({
      id,
      status,
      evidence,
    });
  }

  return output;
}

function recommendationForPattern({
  id,
  title,
  trigger,
  why,
  evidence,
  userRuleIds,
  agentRuleIds,
}) {
  return {
    id,
    title,
    trigger,
    why,
    evidence: uniqueSorted(evidence).slice(0, 8),
    userRuleIds: uniqueSorted(userRuleIds),
    agentRuleIds: uniqueSorted(agentRuleIds),
  };
}

function formatEvidenceItem(entry, repoSlug) {
  if (!entry) return "";

  if (entry.url) {
    return `${entry.label || "evidence"}: ${entry.url}`;
  }

  if (entry.sha) {
    const shortSha = entry.sha.slice(0, 12);
    if (repoSlug) return `commit ${shortSha}: https://github.com/${repoSlug}/commit/${entry.sha}`;
    return `commit ${shortSha}`;
  }

  return entry.label || "";
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runStartedAt = new Date();
  const shouldPersist = options.apply || options.persistDryRun;

  await ensureContracts();
  const rawState = await readJsonFile(improvementStatePath, DEFAULT_TOP_LEVEL_STATE);
  const { state, interaction, sharedCoordination } = parseNormalizedState(rawState);

  const now = nowDate(options);
  const runInfo = getPhoenixRunInfo(now);
  if (options.runId) {
    runInfo.runId = options.runId;
  }

  if (!options.force && interaction.lastRunId === runInfo.runId) {
    const skipped = {
      status: "skipped",
      reason: `Run ${runInfo.runId} already processed by interaction state`,
      runId: runInfo.runId,
      timeZone: TZ,
      statePath: relative(repoRoot, improvementStatePath),
    };

    await appendToolcall({
      actor: detectRunActor(),
      tool: "daily-interaction",
      action: "skip-duplicate-run",
      ok: true,
      durationMs: Date.now() - runStartedAt.getTime(),
      context: {
        runId: runInfo.runId,
      },
    });

    if (options.asJson) {
      process.stdout.write(`${JSON.stringify(skipped, null, 2)}\n`);
    } else {
      process.stdout.write(`skipped: ${skipped.reason}\n`);
    }
    return;
  }

  if (options.apply && !options.allowDirty && getWorkingTreeDirty()) {
    throw new Error(
      "Refusing --apply run on dirty worktree. Commit/stash changes first or pass --allow-dirty explicitly."
    );
  }

  const start12Ms = now.getTime() - PRIMARY_WINDOW_HOURS * 60 * 60 * 1000;
  const start24Ms = now.getTime() - SECONDARY_WINDOW_HOURS * 60 * 60 * 1000;
  const start12Iso = new Date(start12Ms).toISOString();
  const start24Iso = new Date(start24Ms).toISOString();

  const lastRunMs = toMs(interaction.lastRunAtIso);
  const commits12 = collectCommitsSince(start12Iso);
  const commits24 = collectCommitsSince(start24Iso);
  const commitsSinceLast =
    lastRunMs == null ? [] : collectCommitsSince(new Date(lastRunMs).toISOString());

  const churn24 = collectFileCommitCountsSince(start24Iso);
  const churnEntries24 = Object.entries(churn24)
    .filter(([path]) => !ignoreChurnPaths.has(path))
    .sort((left, right) => right[1] - left[1]);
  const highChurnFiles = churnEntries24.filter(([, touches]) => touches >= 4);
  const metadataChanges24 = churnEntries24
    .filter(([path]) => isMetadataPath(path))
    .map(([path, touches]) => ({ path, touches }));

  const toolcallData = await readToolcalls();
  const calls24 = filterByTimeWindow(toolcallData.entries, "tsIso", start24Ms);
  const failures24 = calls24.filter((entry) => entry?.ok === false);
  const toolFailureRate24 = calls24.length === 0 ? 0 : failures24.length / calls24.length;

  const retryClusterMap = countBy(failures24, (entry) => {
    const tool = String(entry?.tool || "").trim();
    const action = String(entry?.action || "").trim();
    if (!tool || !action) return "";
    return `${tool}::${action}`;
  });
  const retryClusters = Array.from(retryClusterMap.entries()).filter(([, count]) => count >= 2);

  const errorClusterMap = countBy(failures24, (entry) => String(entry?.errorType || "").trim());
  const repeatedErrorClusters = Array.from(errorClusterMap.entries()).filter(
    ([name, count]) => name && count >= 2
  );

  const notes = [];
  const repoSlug = parseRepoSlug();
  let githubAvailable = false;
  let prList = [];
  let issueList = [];
  let runList = [];
  let issueComments = [];
  let reviewComments = [];

  if (!options.includeGithub) {
    notes.push("GitHub API calls disabled (--no-github).");
  } else {
    const ghVersion = runGh(["--version"], { allowFailure: true });
    const authStatus = runGh(["auth", "status"], { allowFailure: true });
    githubAvailable = ghVersion.ok && authStatus.ok && !!repoSlug;

    if (!repoSlug) notes.push("Unable to resolve repo slug; GitHub interaction analysis skipped.");
    if (!ghVersion.ok) notes.push("GitHub CLI unavailable; GitHub interaction analysis skipped.");
    if (!authStatus.ok) notes.push("GitHub CLI unauthenticated; GitHub interaction analysis skipped.");

    if (githubAvailable) {
      const prsResp = runGhJson([
        "pr",
        "list",
        "--repo",
        repoSlug,
        "--state",
        "all",
        "--limit",
        "200",
        "--json",
        "number,title,state,isDraft,createdAt,updatedAt,mergedAt,url,labels,headRefName,baseRefName",
      ]);
      if (prsResp.ok && Array.isArray(prsResp.data)) {
        prList = prsResp.data;
      } else {
        notes.push(`Failed to read PR list: ${prsResp.error}`);
      }

      const issuesResp = runGhJson([
        "issue",
        "list",
        "--repo",
        repoSlug,
        "--state",
        "all",
        "--limit",
        "200",
        "--json",
        "number,title,state,createdAt,updatedAt,closedAt,url,labels",
      ]);
      if (issuesResp.ok && Array.isArray(issuesResp.data)) {
        issueList = issuesResp.data;
      } else {
        notes.push(`Failed to read issue list: ${issuesResp.error}`);
      }

      const runsResp = runGhJson([
        "run",
        "list",
        "--repo",
        repoSlug,
        "--limit",
        "200",
        "--json",
        "databaseId,workflowName,displayTitle,name,status,conclusion,createdAt,updatedAt,url,event",
      ]);
      if (runsResp.ok && Array.isArray(runsResp.data)) {
        runList = runsResp.data;
      } else {
        notes.push(`Failed to read workflow runs: ${runsResp.error}`);
      }

      const issueCommentsResp = runGhApiPaginated(
        `repos/${repoSlug}/issues/comments?since=${encodeURIComponent(start24Iso)}`
      );
      if (issueCommentsResp.ok) {
        issueComments = Array.isArray(issueCommentsResp.data) ? issueCommentsResp.data : [];
      } else {
        notes.push(`Failed to read issue comments: ${issueCommentsResp.error}`);
      }

      const reviewCommentsResp = runGhApiPaginated(
        `repos/${repoSlug}/pulls/comments?since=${encodeURIComponent(start24Iso)}`
      );
      if (reviewCommentsResp.ok) {
        reviewComments = Array.isArray(reviewCommentsResp.data) ? reviewCommentsResp.data : [];
      } else {
        notes.push(`Failed to read review comments: ${reviewCommentsResp.error}`);
      }
    }
  }

  const nonAutomationPrs = prList.filter((pr) => !hasAutomationLabel(pr));
  const prNumberSet = new Set(nonAutomationPrs.map((pr) => Number(pr.number)).filter(Number.isFinite));
  const automationPrSet = new Set(
    prList
      .filter((pr) => hasAutomationLabel(pr))
      .map((pr) => Number(pr.number))
      .filter(Number.isFinite)
  );

  const discussions = [];

  for (const comment of issueComments) {
    const createdMs = toMs(comment?.created_at);
    if (createdMs == null || createdMs < start24Ms) continue;

    const issueNumber = parseNumberFromUrl(comment?.issue_url, "issues");
    if (issueNumber == null) continue;

    const isPrThread = prNumberSet.has(issueNumber) || automationPrSet.has(issueNumber);
    if (isPrThread && automationPrSet.has(issueNumber)) continue;

    discussions.push({
      threadKey: `${isPrThread ? "pr" : "issue"}:${issueNumber}`,
      threadType: isPrThread ? "pr" : "issue",
      threadNumber: issueNumber,
      createdMs,
      author: String(comment?.user?.login || "").trim(),
      body: String(comment?.body || ""),
      url: String(comment?.html_url || ""),
      label: isPrThread ? `PR #${issueNumber} comment` : `Issue #${issueNumber} comment`,
    });
  }

  for (const comment of reviewComments) {
    const createdMs = toMs(comment?.created_at);
    if (createdMs == null || createdMs < start24Ms) continue;

    const prNumber = parseNumberFromUrl(comment?.pull_request_url, "pulls");
    if (prNumber == null) continue;
    if (automationPrSet.has(prNumber)) continue;

    discussions.push({
      threadKey: `pr:${prNumber}`,
      threadType: "pr",
      threadNumber: prNumber,
      createdMs,
      author: String(comment?.user?.login || "").trim(),
      body: String(comment?.body || ""),
      url: String(comment?.html_url || ""),
      label: `PR #${prNumber} review comment`,
    });
  }

  const discussionsByThread = new Map();
  for (const entry of discussions) {
    if (!discussionsByThread.has(entry.threadKey)) {
      discussionsByThread.set(entry.threadKey, []);
    }
    discussionsByThread.get(entry.threadKey).push(entry);
  }

  const clarificationRegex =
    /\b(clarify|clarification|unclear|confus|not clear|what do you mean|restate|misunderstand|still seeing)\b/i;
  const restateRegex = /\b(restate|again|still|repeat|another reminder|same issue)\b/i;
  const minimalExplanationRegex =
    /\b(too brief|too short|minimal explanation|not enough detail|needs more context|explain why)\b/i;
  const verbosityRegex = /\b(too verbose|overly verbose|under[- ]specified|underspecified|unclear format)\b/i;
  const scopeCreepRegex = /\b(scope creep|out of scope|not requested|unrelated changes|too broad)\b/i;
  const reworkRegex =
    /\b(rework|re-work|structural rework|requires rework|major refactor|needs refactor|architecture rework)\b/i;

  const loops = [];
  let clarificationCommentCount = 0;
  let workflowRestatementCount = 0;
  let minimalCorrectionCount = 0;
  let verbosityPatternCount = 0;
  let scopeCreepCount = 0;
  let reworkAmbiguityCount = 0;

  for (const [threadKey, items] of discussionsByThread.entries()) {
    const sorted = items.slice().sort((left, right) => left.createdMs - right.createdMs);
    const alternations = countAlternations(sorted);
    if (threadKey.startsWith("pr:") && sorted.length > 3 && alternations >= 3) {
      loops.push({
        threadKey,
        commentCount: sorted.length,
        alternations,
        url: sorted[sorted.length - 1]?.url || "",
      });
    }

    for (const item of sorted) {
      const body = String(item.body || "");
      const lower = body.toLowerCase();
      if (clarificationRegex.test(body)) clarificationCommentCount += 1;
      if (
        restateRegex.test(body) &&
        /\b(intake\s*mode|firestore|undefined|scheduling|exclude|branch protection|pr-only|workflow|guardrail)\b/i.test(
          body
        )
      ) {
        workflowRestatementCount += 1;
      }
      if (minimalExplanationRegex.test(body)) minimalCorrectionCount += 1;
      if (verbosityRegex.test(body)) verbosityPatternCount += 1;
      if (scopeCreepRegex.test(body)) scopeCreepCount += 1;
      if (reworkRegex.test(body) && /\b(unclear|ambiguous|instruction)\b/i.test(lower)) {
        reworkAmbiguityCount += 1;
      }
    }
  }

  const commits24Filtered = commits24.filter((commit) => !isAutomationCommitSubject(commit.subject));
  const prs24 = nonAutomationPrs.filter((pr) => {
    const updatedMs = toMs(pr.updatedAt);
    const createdMs = toMs(pr.createdAt);
    return (updatedMs != null && updatedMs >= start24Ms) || (createdMs != null && createdMs >= start24Ms);
  });
  const issues24 = issueList.filter((issue) => {
    if (hasAutomationLabel(issue)) return false;
    const updatedMs = toMs(issue.updatedAt);
    const createdMs = toMs(issue.createdAt);
    return (updatedMs != null && updatedMs >= start24Ms) || (createdMs != null && createdMs >= start24Ms);
  });

  const textEntries = [];
  for (const commit of commits24Filtered) {
    textEntries.push({
      source: "commit",
      text: String(commit.subject || ""),
      sha: commit.sha,
      label: `commit ${commit.sha.slice(0, 12)}`,
    });
  }
  for (const pr of prs24) {
    textEntries.push({
      source: "pr",
      text: String(pr.title || ""),
      url: String(pr.url || ""),
      label: `PR #${pr.number}`,
    });
  }
  for (const issue of issues24) {
    textEntries.push({
      source: "issue",
      text: String(issue.title || ""),
      url: String(issue.url || ""),
      label: `Issue #${issue.number}`,
    });
  }
  for (const discussion of discussions) {
    textEntries.push({
      source: "discussion",
      text: String(discussion.body || ""),
      url: discussion.url,
      label: discussion.label,
    });
  }

  function matchPattern(name, matcher) {
    const matches = textEntries.filter((entry) => matcher(String(entry.text || ""), toLowerText(entry.text)));
    return {
      name,
      count: matches.length,
      matches,
    };
  }

  const intakeModePattern = matchPattern("intake_mode_misunderstanding", (raw, lower) => {
    return /\b(intake\s*mode|community_shelf|shelf_purchase|whole_kiln)\b/i.test(raw) && clarificationRegex.test(lower);
  });

  const firestoreUndefinedPattern = matchPattern("firestore_undefined_confusion", (raw, lower) => {
    return /\bfirestore\b/i.test(raw) && /\bundefined\b/i.test(raw) && (clarificationRegex.test(lower) || restateRegex.test(lower));
  });

  const schedulingExclusionPattern = matchPattern("scheduling_exclusion_confusion", (raw, lower) => {
    const hasScheduling = /\b(scheduling|schedule|firing|trigger)\b/i.test(raw);
    const hasExclusion = /\b(exclud|does not count|not count|lowest priority|community shelf)\b/i.test(raw);
    return hasScheduling && hasExclusion && (clarificationRegex.test(lower) || restateRegex.test(lower));
  });

  const branchProtectionPattern = matchPattern("branch_protection_confusion", (raw, lower) => {
    const hasBranchPolicy =
      /\b(branch protection|pr-only|never push|main branch|direct push|push to main)\b/i.test(raw);
    return hasBranchPolicy && (clarificationRegex.test(lower) || restateRegex.test(lower));
  });

  const recommendations = [];
  const thresholdEvidenceCount = 2;

  if (intakeModePattern.count >= thresholdEvidenceCount) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "intake-mode-clarity",
        title: "Reduce repeated intakeMode misunderstandings",
        trigger: `Pattern observed ${intakeModePattern.count} times in 24h (threshold: >=2).`,
        why: "Repeated intakeMode confusion creates avoidable clarification cycles and rework.",
        evidence: intakeModePattern.matches.map((entry) => formatEvidenceItem(entry, repoSlug)),
        userRuleIds: ["USER_CANONICAL_TERMS", "USER_PROMPT_STRUCTURE"],
        agentRuleIds: ["AGENT_ENUM_RESOLUTION", "AGENT_STRUCTURED_PR_NOTES"],
      })
    );
  }

  if (firestoreUndefinedPattern.count >= thresholdEvidenceCount) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "firestore-undefined-guardrail",
        title: "Tighten Firestore undefined handling instructions",
        trigger: `Pattern observed ${firestoreUndefinedPattern.count} times in 24h (threshold: >=2).`,
        why: "Undefined payload confusion causes runtime failures and repeated corrections.",
        evidence: firestoreUndefinedPattern.matches.map((entry) => formatEvidenceItem(entry, repoSlug)),
        userRuleIds: ["USER_FIRESTORE_PAYLOAD"],
        agentRuleIds: ["AGENT_NO_UNDEFINED_GUARD", "AGENT_STRUCTURED_PR_NOTES"],
      })
    );
  }

  if (schedulingExclusionPattern.count >= thresholdEvidenceCount) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "scheduling-exclusion-clarity",
        title: "Clarify scheduling exclusion expectations",
        trigger: `Pattern observed ${schedulingExclusionPattern.count} times in 24h (threshold: >=2).`,
        why: "Unclear exclusions lead to behavior regressions in operational scheduling flows.",
        evidence: schedulingExclusionPattern.matches.map((entry) => formatEvidenceItem(entry, repoSlug)),
        userRuleIds: ["USER_SCHEDULING_BOUNDARY"],
        agentRuleIds: ["AGENT_SCHEDULING_MATRIX", "AGENT_SCOPE_LOCK"],
      })
    );
  }

  if (branchProtectionPattern.count >= thresholdEvidenceCount) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "branch-protection-restate",
        title: "Reinforce branch protection workflow policy",
        trigger: `Pattern observed ${branchProtectionPattern.count} times in 24h (threshold: >=2).`,
        why: "Branch policy ambiguity risks unsafe delivery paths.",
        evidence: branchProtectionPattern.matches.map((entry) => formatEvidenceItem(entry, repoSlug)),
        userRuleIds: ["USER_BRANCH_POLICY"],
        agentRuleIds: ["AGENT_BRANCH_ENFORCEMENT"],
      })
    );
  }

  if (loops.length > 0) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "clarification-loop-control",
        title: "Reduce clarification loops over 3 comments",
        trigger: `${loops.length} PR discussion loop(s) exceeded 3 comments with alternating participants.`,
        why: "High back-and-forth loops indicate under-specified instructions and slow delivery.",
        evidence: loops.map((loop) => `${loop.threadKey} (${loop.commentCount} comments): ${loop.url || "link unavailable"}`),
        userRuleIds: ["USER_PROMPT_STRUCTURE", "USER_SCOPE_FENCE"],
        agentRuleIds: ["AGENT_DECIDE_AFTER_ONE_CLARIFY", "AGENT_SCOPE_LOCK"],
      })
    );
  }

  if (workflowRestatementCount >= thresholdEvidenceCount) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "workflow-restatement-cluster",
        title: "Reduce repeated workflow rule restatements",
        trigger: `Workflow restatement detected ${workflowRestatementCount} times in 24h (threshold: >=2).`,
        why: "Repeated restatements imply weak contract visibility and inconsistent execution defaults.",
        evidence: discussions.slice(0, 6).map((entry) => formatEvidenceItem(entry, repoSlug)),
        userRuleIds: ["USER_OUTPUT_CONTRACT", "USER_BRANCH_POLICY"],
        agentRuleIds: ["AGENT_BRANCH_ENFORCEMENT", "AGENT_STRUCTURED_PR_NOTES"],
      })
    );
  }

  if (minimalCorrectionCount >= thresholdEvidenceCount) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "minimal-explanation-correction",
        title: "Address repeated minimal-explanation corrections",
        trigger: `Minimal explanation corrections detected ${minimalCorrectionCount} times in 24h (threshold: >=2).`,
        why: "Insufficient rationale causes avoidable review churn and ambiguity.",
        evidence: discussions.slice(0, 6).map((entry) => formatEvidenceItem(entry, repoSlug)),
        userRuleIds: ["USER_OUTPUT_CONTRACT"],
        agentRuleIds: ["AGENT_STRUCTURED_PR_NOTES"],
      })
    );
  }

  if (verbosityPatternCount >= thresholdEvidenceCount || scopeCreepCount >= thresholdEvidenceCount) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "scope-and-verbosity-balance",
        title: "Tighten scope boundaries to reduce verbosity and scope creep",
        trigger: `Verbosity signals: ${verbosityPatternCount}, scope-creep signals: ${scopeCreepCount} (threshold: >=2).`,
        why: "Unbounded prompt shape increases unnecessary changes and review churn.",
        evidence: discussions.slice(0, 6).map((entry) => formatEvidenceItem(entry, repoSlug)),
        userRuleIds: ["USER_SCOPE_FENCE", "USER_PROMPT_STRUCTURE"],
        agentRuleIds: ["AGENT_SCOPE_LOCK", "AGENT_DECIDE_AFTER_ONE_CLARIFY"],
      })
    );
  }

  if (retryClusters.length > 0) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "tool-retry-loop-cluster",
        title: "Stop repeated tool retry loops",
        trigger: `${retryClusters.length} tool retry cluster(s) crossed threshold >=2.`,
        why: "Repeated retries without strategy change wastes cycles and hides root causes.",
        evidence: retryClusters.map(([name, count]) => `${name} failed ${count} times in 24h`),
        userRuleIds: ["USER_OUTPUT_CONTRACT"],
        agentRuleIds: ["AGENT_RETRY_STOP_TWO", "AGENT_STRUCTURED_PR_NOTES"],
      })
    );
  }

  if (reworkAmbiguityCount >= thresholdEvidenceCount) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "pr-rework-ambiguity",
        title: "Reduce PR rework caused by instruction ambiguity",
        trigger: `Rework+ambiguity signals detected ${reworkAmbiguityCount} times in 24h (threshold: >=2).`,
        why: "Structural PR rework indicates the instruction contract is underspecified.",
        evidence: discussions.slice(0, 6).map((entry) => formatEvidenceItem(entry, repoSlug)),
        userRuleIds: ["USER_PROMPT_STRUCTURE", "USER_SCOPE_FENCE"],
        agentRuleIds: ["AGENT_STRUCTURED_PR_NOTES", "AGENT_DECIDE_AFTER_ONE_CLARIFY"],
      })
    );
  }

  if (highChurnFiles.length > 0 && clarificationCommentCount >= thresholdEvidenceCount) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "churn-driven-guardrails",
        title: "Address churn hotspots linked to interaction friction",
        trigger: `${highChurnFiles.length} hotspot file(s) with >=4 touches and repeated clarification signals.`,
        why: "High churn plus confusion often indicates missing or weak guardrails.",
        evidence: highChurnFiles.slice(0, 6).map(([path, touches]) => `${path} (${touches} touches)`),
        userRuleIds: ["USER_SCOPE_FENCE"],
        agentRuleIds: ["AGENT_SCOPE_LOCK", "AGENT_STRUCTURED_PR_NOTES"],
      })
    );
  }

  const runs24 = runList.filter((run) => {
    const createdMs = toMs(run.createdAt);
    return createdMs != null && createdMs >= start24Ms;
  });
  const failedRuns24 = runs24.filter((run) =>
    ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(
      String(run?.conclusion || "").toLowerCase()
    )
  );
  const ciSignatureMap = countBy(failedRuns24, (run) => {
    const workflow = String(run?.workflowName || "unknown").trim();
    const title = String(run?.displayTitle || run?.name || "untitled").trim();
    return `${workflow}::${title}`;
  });
  const repeatedCiSignatures = Array.from(ciSignatureMap.entries()).filter(([, count]) => count >= 2);

  const merged24 = nonAutomationPrs.filter((pr) => {
    const mergedMs = toMs(pr.mergedAt);
    return mergedMs != null && mergedMs >= start24Ms;
  });
  const mergedSinceLast =
    lastRunMs == null
      ? 0
      : nonAutomationPrs.filter((pr) => {
          const mergedMs = toMs(pr.mergedAt);
          return mergedMs != null && mergedMs >= lastRunMs;
        }).length;
  const mergedSinceLastUrls =
    lastRunMs == null
      ? []
      : nonAutomationPrs
          .filter((pr) => {
            const mergedMs = toMs(pr.mergedAt);
            return mergedMs != null && mergedMs >= lastRunMs;
          })
          .map((pr) => String(pr.url || ""))
          .filter(Boolean);

  const closedIssues24 = issues24.filter((issue) => {
    const closedMs = toMs(issue.closedAt);
    return closedMs != null && closedMs >= start24Ms;
  });
  const closedSinceLast =
    lastRunMs == null
      ? 0
      : issues24.filter((issue) => {
          const closedMs = toMs(issue.closedAt);
          return closedMs != null && closedMs >= lastRunMs;
        }).length;
  const closedSinceLastUrls =
    lastRunMs == null
      ? []
      : issues24
          .filter((issue) => {
            const closedMs = toMs(issue.closedAt);
            return closedMs != null && closedMs >= lastRunMs;
          })
          .map((issue) => String(issue.url || ""))
          .filter(Boolean);

  const mergedNoRework = merged24.filter((pr) => {
    const prKey = `pr:${pr.number}`;
    const thread = discussionsByThread.get(prKey) || [];
    return !thread.some((entry) => reworkRegex.test(String(entry.body || "")));
  }).length;

  const ticketsClosedNoReopen = closedIssues24.filter((issue) => {
    const closedMs = toMs(issue.closedAt);
    const updatedMs = toMs(issue.updatedAt);
    if (closedMs == null || updatedMs == null) return false;
    return Math.abs(updatedMs - closedMs) <= 1000 * 60 * 15;
  }).length;

  const skillDensity = {
    firestore:
      firestoreUndefinedPattern.count +
      textEntries.filter((entry) => /\bfirestore\b/i.test(entry.text)).length,
    cloudFunctions: textEntries.filter((entry) => /\b(cloud function|cloudfunction|function endpoint|https callable)\b/i.test(entry.text)).length,
    schedulingLogic:
      schedulingExclusionPattern.count +
      textEntries.filter((entry) => /\b(scheduling|firing|trigger)\b/i.test(entry.text)).length,
    metadataConfig:
      metadataChanges24.reduce((sum, item) => sum + item.touches, 0) +
      textEntries.filter((entry) => /\b(config|metadata|workflow file|github workflow)\b/i.test(entry.text)).length,
    tooling: failures24.length + retryClusters.length,
    workflowPolicy:
      branchProtectionPattern.count +
      workflowRestatementCount +
      textEntries.filter((entry) => /\b(branch protection|pr-only|workflow rule|guardrail)\b/i.test(entry.text)).length,
    automation:
      textEntries.filter((entry) => /\bautomation\b/i.test(entry.text)).length +
      failedRuns24.filter((run) => /\bcodex\b/i.test(String(run?.workflowName || ""))).length,
  };

  const previousSkillDensity = interaction.lastSkillDensity || defaultInteractionNamespace().lastSkillDensity;
  const skillSpikes = Object.entries(skillDensity)
    .filter(([key, value]) => {
      const previous = Number(previousSkillDensity[key] || 0);
      if (previous === 0) return value >= 3;
      return value >= previous + 2 && value >= Math.ceil(previous * 1.5);
    })
    .map(([key]) => key);

  if (skillSpikes.length > 0) {
    ensureRecommendation(
      recommendations,
      recommendationForPattern({
        id: "skill-density-spike",
        title: "Address skill-density spike with structural guardrails",
        trigger: `Skill error density spiked in: ${skillSpikes.join(", ")}.`,
        why: "Category-level spikes indicate systemic instruction gaps requiring stronger guardrails.",
        evidence: skillSpikes.map((key) => `${key}: ${skillDensity[key]} (previous ${previousSkillDensity[key] || 0})`),
        userRuleIds: ["USER_PROMPT_STRUCTURE", "USER_SCOPE_FENCE"],
        agentRuleIds: ["AGENT_SCOPE_LOCK", "AGENT_STRUCTURED_PR_NOTES", "AGENT_RETRY_STOP_TWO"],
      })
    );
  }

  const repeatedFailureClusterCount = recommendations.filter((recommendation) =>
    [
      "intake-mode-clarity",
      "firestore-undefined-guardrail",
      "scheduling-exclusion-clarity",
      "branch-protection-restate",
      "workflow-restatement-cluster",
      "tool-retry-loop-cluster",
      "pr-rework-ambiguity",
      "churn-driven-guardrails",
    ].includes(recommendation.id)
  ).length;

  const clarificationLoopCount = loops.length;
  const ciFailureRepeatCount = repeatedCiSignatures.length;
  const toolRetryClusterCount = retryClusters.length;
  const highChurnHotspotCount = highChurnFiles.length;

  const toolFailureRateDelta = toolFailureRate24 - Number(interaction.lastToolFailureRate24 || 0);
  const toolFailureRateDecreased = toolFailureRateDelta < 0;

  let impactScore = 100;
  impactScore -= repeatedFailureClusterCount * 5;
  impactScore -= clarificationLoopCount * 5;
  impactScore -= ciFailureRepeatCount * 5;
  impactScore -= toolRetryClusterCount * 3;
  impactScore -= highChurnHotspotCount * 3;
  impactScore += mergedNoRework * 3;
  impactScore += ticketsClosedNoReopen * 3;
  if (toolFailureRateDecreased) {
    impactScore += 2;
  }
  impactScore = clampScore(impactScore);

  const scoreHistory = Array.isArray(interaction.recentImpactScores)
    ? interaction.recentImpactScores.slice(-5)
    : [];
  const previousScore = typeof scoreHistory.at(-1) === "number" ? scoreHistory.at(-1) : null;
  const twoRunsBackScore = typeof scoreHistory.at(-2) === "number" ? scoreHistory.at(-2) : null;
  const scoreDroppedTwice =
    previousScore != null &&
    twoRunsBackScore != null &&
    previousScore < twoRunsBackScore &&
    impactScore < previousScore;

  const ciStatusDelta = Number(interaction.lastCiFailureRepeats || 0) - ciFailureRepeatCount;
  const errorClusterDelta = Number(interaction.lastErrorClusterCount || 0) - repeatedFailureClusterCount;
  const fileChurnDelta = Number(interaction.lastHighChurnCount || 0) - highChurnHotspotCount;

  const impactSinceLastRun = {
    prsMerged: mergedSinceLast,
    ticketsClosed: closedSinceLast,
    ciStatusDelta,
    errorClusterDelta,
    toolFailureRateDelta,
    fileChurnDelta,
  };

  const followThrough = summarizeFollowThrough(
    Array.isArray(interaction.lastTopRecommendations) ? interaction.lastTopRecommendations : [],
    recommendations,
    uniqueSorted([...mergedSinceLastUrls, ...closedSinceLastUrls]),
    githubAvailable
  );

  const thresholdTriggered = recommendations.length > 0;
  const lastStructuralEditMs = toMs(interaction.lastStructuralEditAtIso);
  const structuralCooldownPassed =
    lastStructuralEditMs == null ||
    now.getTime() - lastStructuralEditMs >= STRUCTURAL_MIN_HOURS * 60 * 60 * 1000;

  const structuralTrigger =
    thresholdTriggered || scoreDroppedTwice || skillSpikes.length > 0;
  const structuralAllowed = structuralTrigger && structuralCooldownPassed;

  const previousUserRules = uniqueSorted(interaction?.activeRuleIds?.user || []);
  const previousAgentRules = uniqueSorted(interaction?.activeRuleIds?.agents || []);

  const suggestedUserRules = uniqueSorted(
    recommendations.flatMap((recommendation) => recommendation.userRuleIds || [])
  ).slice(0, options.maxRulesPerRun);
  const suggestedAgentRules = uniqueSorted(
    recommendations.flatMap((recommendation) => recommendation.agentRuleIds || [])
  ).slice(0, options.maxRulesPerRun);

  const nextUserRules = uniqueSorted([...previousUserRules, ...suggestedUserRules]);
  const nextAgentRules = uniqueSorted([...previousAgentRules, ...suggestedAgentRules]);

  const rulesChanged = !arraysEqual(previousUserRules, nextUserRules) || !arraysEqual(previousAgentRules, nextAgentRules);
  const ruleUpdateRunId = rulesChanged ? runInfo.runId : interaction.lastRuleUpdateRunId || "n/a";

  const currentUserDoc = await readFile(userDocPath, "utf8");
  const currentAgentsDoc = await readFile(agentsDocPath, "utf8");
  const nextUserDoc = replaceAutoBlock(currentUserDoc, buildAutoBlock("user", nextUserRules, ruleUpdateRunId));
  const nextAgentsDoc = replaceAutoBlock(currentAgentsDoc, buildAutoBlock("agents", nextAgentRules, ruleUpdateRunId));

  const userDocChanged = nextUserDoc !== currentUserDoc;
  const agentsDocChanged = nextAgentsDoc !== currentAgentsDoc;
  const structuralDocChangesAvailable = userDocChanged || agentsDocChanged;

  const structuralDecision = {
    mode: "Deferred",
    reason: "No structural trigger crossed thresholds.",
    userUpdated: false,
    agentsUpdated: false,
  };

  if (!structuralTrigger) {
    structuralDecision.reason = "No friction cluster, score-drop chain, or skill-density spike triggered.";
  } else if (!structuralCooldownPassed) {
    structuralDecision.reason = "Structural edit cooldown active (minimum 24h between structural edits).";
  } else if (!rulesChanged || !structuralDocChangesAvailable) {
    structuralDecision.reason = "Trigger detected, but no new structural rule additions were required.";
  } else {
    structuralDecision.mode = "Triggered";
    structuralDecision.reason = "Trigger detected with new structural rule additions and cooldown satisfied.";
    structuralDecision.userUpdated = userDocChanged;
    structuralDecision.agentsUpdated = agentsDocChanged;
  }

  const nextFocus = buildNextFocus(recommendations, structuralDecision, skillSpikes);

  const summary = {
    commitsAnalyzed: commits24Filtered.length,
    prDiscussionsAnalyzed: Array.from(discussionsByThread.keys()).filter((key) => key.startsWith("pr:")).length,
    clarificationLoopsDetected: loops.length,
    clarificationComments: clarificationCommentCount,
    workflowRestatements: workflowRestatementCount,
    impactScore,
    impactSinceLastRun,
    skillDensity,
    followThrough,
    interactionFrictionClusters: recommendations.map((recommendation) => recommendation.id),
    structuralEvolutionDecision: structuralDecision.mode,
  };

  const logEntry = buildInteractionLogEntry({
    runInfo,
    summary,
    recommendations,
    structuralDecision,
    nextFocus,
  });

  let prUrl = "";
  let prNumber = null;
  let usedBranch = "";
  let rollingIssueUrl = "";
  let rollingIssueNumber = null;
  let createdOrUpdatedPr = false;

  if (options.apply && githubAvailable) {
    await ensureGhLabel(repoSlug, "automation", "1d76db", "Automation-generated work", true);
    await ensureGhLabel(repoSlug, "epic:codex-interaction", "b60205", "Codex interaction interrogation epic", true);
    await ensureGhLabel(repoSlug, `run:${runInfo.runSlot}`, "0e8a16", "Codex AM/PM run marker", true);

    const existingRollingResp = runGhJson([
      "issue",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--search",
      `\"${rollingIssueTitle}\" in:title`,
      "--limit",
      "5",
      "--json",
      "number,title,url",
    ]);

    if (existingRollingResp.ok && Array.isArray(existingRollingResp.data)) {
      const exact = existingRollingResp.data.find((issue) => issue.title === rollingIssueTitle);
      if (exact) {
        rollingIssueNumber = exact.number;
        rollingIssueUrl = exact.url;
      }
    }

    if (!rollingIssueNumber) {
      const createRolling = runGh(
        [
          "issue",
          "create",
          "--repo",
          repoSlug,
          "--title",
          rollingIssueTitle,
          "--body",
          "Rolling run-by-run interaction interrogation summary for Codex collaboration quality.",
          "--label",
          "automation",
          "--label",
          "epic:codex-interaction",
        ],
        { allowFailure: true }
      );
      if (createRolling.ok) {
        rollingIssueUrl = createRolling.stdout.trim();
        const numberMatch = rollingIssueUrl.match(/\/issues\/(\d+)$/);
        rollingIssueNumber = numberMatch ? Number(numberMatch[1]) : null;
      }
    }

    const shouldAttemptStructuralPr =
      structuralDecision.mode === "Triggered" && structuralDocChangesAvailable;

    if (shouldAttemptStructuralPr) {
      const sharedEntry = sharedCoordination?.automationPrByRunId?.[runInfo.runId];
      let existingRunPr = null;

      if (sharedEntry?.url && sharedEntry?.branch) {
        const inferredNumber = sharedEntry.url.match(/\/pull\/(\d+)$/);
        existingRunPr = {
          number: inferredNumber ? Number(inferredNumber[1]) : null,
          url: sharedEntry.url,
          headRefName: sharedEntry.branch,
          title: "",
          labels: [],
        };
      }

      if (!existingRunPr) {
        const findRunPrResp = runGhJson([
          "pr",
          "list",
          "--repo",
          repoSlug,
          "--state",
          "open",
          "--label",
          "automation",
          "--label",
          `run:${runInfo.runSlot}`,
          "--limit",
          "50",
          "--json",
          "number,url,title,headRefName,labels",
        ]);

        if (findRunPrResp.ok && Array.isArray(findRunPrResp.data)) {
          existingRunPr = findRunPrResp.data.find((pr) => {
            const head = String(pr.headRefName || "");
            const title = String(pr.title || "");
            return head.includes(runInfo.runId) || title.includes(runInfo.runId);
          });
        }
      }

      const branchName =
        existingRunPr?.headRefName || `codex/interaction-improve/${runInfo.runId}`;
      usedBranch = branchName;
      const previousBranch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();

      if (existingRunPr?.headRefName) {
        const fetchResult = runGit(["fetch", "origin", branchName], { allowFailure: true });
        if (fetchResult.ok) {
          runGit(["checkout", "-B", branchName, `origin/${branchName}`]);
        } else {
          runGit(["checkout", "-B", branchName]);
        }
      } else {
        runGit(["checkout", "-B", branchName]);
      }

      if (userDocChanged) {
        await writeFile(userDocPath, nextUserDoc, "utf8");
      }
      if (agentsDocChanged) {
        await writeFile(agentsDocPath, nextAgentsDoc, "utf8");
      }

      await appendFile(interactionLogPath, `${logEntry}\n`, "utf8");

      const nextState = {
        ...state,
        interactionInterrogation: {
          ...interaction,
          lastRunAtIso: now.toISOString(),
          lastRunId: runInfo.runId,
          lastPatternIds: recommendations.map((recommendation) => recommendation.id),
          lastTopRecommendations: recommendations.map((recommendation) => recommendation.id).slice(0, 3),
          lastImpactScore: impactScore,
          recentImpactScores: [...scoreHistory, impactScore].slice(-10),
          activeRuleIds: {
            user: nextUserRules,
            agents: nextAgentRules,
          },
          lastRuleUpdateRunId: ruleUpdateRunId,
          lastStructuralEditAtIso: now.toISOString(),
          lastSkillDensity: skillDensity,
          lastToolFailureRate24: toolFailureRate24,
          lastErrorClusterCount: repeatedFailureClusterCount,
          lastHighChurnCount: highChurnHotspotCount,
          lastCiFailureRepeats: ciFailureRepeatCount,
          followThroughHistory: [
            ...(Array.isArray(interaction.followThroughHistory) ? interaction.followThroughHistory : []),
            {
              runId: runInfo.runId,
              generatedAtIso: now.toISOString(),
              outcomes: followThrough,
            },
          ].slice(-40),
        },
        sharedCoordination: {
          ...sharedCoordination,
          automationPrByRunId: {
            ...(sharedCoordination.automationPrByRunId || {}),
            [runInfo.runId]: {
              url: existingRunPr?.url || "",
              branch: branchName,
              source: existingRunPr?.url ? "shared" : "interaction",
              updatedAtIso: now.toISOString(),
            },
          },
        },
      };
      await writeJsonFile(improvementStatePath, nextState);

      runGit([
        "add",
        relative(repoRoot, userDocPath),
        relative(repoRoot, agentsDocPath),
        relative(repoRoot, interactionLogPath),
        relative(repoRoot, improvementStatePath),
      ]);

      const staged = runGit(["diff", "--cached", "--name-only"], { allowFailure: true });
      if (staged.ok && staged.stdout.trim()) {
        runGit(["commit", "-m", `chore(codex): interaction interrogation ${runInfo.runId}`]);
      }
      runGit(["push", "--set-upstream", "origin", branchName], { allowFailure: false });

      if (existingRunPr?.number) {
        const labels = parseLabels(existingRunPr);
        if (branchName.includes("codex/interaction-improve/")) {
          runGh(
            [
              "pr",
              "edit",
              String(existingRunPr.number),
              "--repo",
              repoSlug,
              "--title",
              `Codex Interaction Interrogation ${runInfo.runId}`,
              "--body",
              buildPrBody({
                runInfo,
                recommendations,
                previousUserRules,
                nextUserRules,
                previousAgentRules,
                nextAgentRules,
                structuralDecision,
              }),
              "--add-label",
              "automation",
              "--add-label",
              "epic:codex-interaction",
              "--add-label",
              `run:${runInfo.runSlot}`,
            ],
            { allowFailure: true }
          );
        } else {
          runGh(
            [
              "issue",
              "comment",
              String(existingRunPr.number),
              "--repo",
              repoSlug,
              "--body",
              buildPrComment({ runInfo, recommendations, structuralDecision }),
            ],
            { allowFailure: true }
          );

          if (!labels.includes("epic:codex-interaction")) {
            runGh(
              [
                "pr",
                "edit",
                String(existingRunPr.number),
                "--repo",
                repoSlug,
                "--add-label",
                "epic:codex-interaction",
              ],
              { allowFailure: true }
            );
          }
        }

        prUrl = existingRunPr.url || "";
        prNumber = existingRunPr.number;
      } else {
        const createPr = runGh(
          [
            "pr",
            "create",
            "--repo",
            repoSlug,
            "--base",
            "main",
            "--head",
            branchName,
            "--title",
            `Codex Interaction Interrogation ${runInfo.runId}`,
            "--body",
            buildPrBody({
              runInfo,
              recommendations,
              previousUserRules,
              nextUserRules,
              previousAgentRules,
              nextAgentRules,
              structuralDecision,
            }),
            "--label",
            "automation",
            "--label",
            "epic:codex-interaction",
            "--label",
            `run:${runInfo.runSlot}`,
          ],
          { allowFailure: true }
        );
        if (createPr.ok) {
          prUrl = createPr.stdout.trim();
          const numberMatch = prUrl.match(/\/pull\/(\d+)$/);
          prNumber = numberMatch ? Number(numberMatch[1]) : null;
        }
      }

      if (prUrl) {
        createdOrUpdatedPr = true;
      }

      if (prUrl) {
        const sharedEntry = {
          url: prUrl,
          branch: branchName,
          source: branchName.includes("codex/interaction-improve/") ? "interaction" : "shared",
          updatedAtIso: now.toISOString(),
        };
        const updatedState = await readJsonFile(improvementStatePath, DEFAULT_TOP_LEVEL_STATE);
        const parsedUpdated = parseNormalizedState(updatedState);
        await writeJsonFile(improvementStatePath, {
          ...updatedState,
          sharedCoordination: {
            ...parsedUpdated.sharedCoordination,
            automationPrByRunId: {
              ...(parsedUpdated.sharedCoordination.automationPrByRunId || {}),
              [runInfo.runId]: sharedEntry,
            },
          },
        });
      }

      if (previousBranch && previousBranch !== branchName) {
        runGit(["checkout", previousBranch], { allowFailure: true });
      }
    } else {
      await appendFile(interactionLogPath, `${logEntry}\n`, "utf8");
      const nextState = {
        ...state,
        interactionInterrogation: {
          ...interaction,
          lastRunAtIso: now.toISOString(),
          lastRunId: runInfo.runId,
          lastPatternIds: recommendations.map((recommendation) => recommendation.id),
          lastTopRecommendations: recommendations.map((recommendation) => recommendation.id).slice(0, 3),
          lastImpactScore: impactScore,
          recentImpactScores: [...scoreHistory, impactScore].slice(-10),
          activeRuleIds: {
            user: previousUserRules,
            agents: previousAgentRules,
          },
          lastRuleUpdateRunId: interaction.lastRuleUpdateRunId || "n/a",
          lastSkillDensity: skillDensity,
          lastToolFailureRate24: toolFailureRate24,
          lastErrorClusterCount: repeatedFailureClusterCount,
          lastHighChurnCount: highChurnHotspotCount,
          lastCiFailureRepeats: ciFailureRepeatCount,
          followThroughHistory: [
            ...(Array.isArray(interaction.followThroughHistory) ? interaction.followThroughHistory : []),
            {
              runId: runInfo.runId,
              generatedAtIso: now.toISOString(),
              outcomes: followThrough,
            },
          ].slice(-40),
        },
        sharedCoordination: {
          ...sharedCoordination,
        },
      };
      await writeJsonFile(improvementStatePath, nextState);
    }

    if (rollingIssueNumber) {
      const comment = buildRollingIssueComment({
        runInfo,
        summary,
        recommendations,
        structuralDecision,
        nextFocus,
        prUrl,
      });
      runGh(
        [
          "issue",
          "comment",
          String(rollingIssueNumber),
          "--repo",
          repoSlug,
          "--body",
          comment,
        ],
        { allowFailure: true }
      );
    }
  } else {
    if (shouldPersist) {
      await appendFile(interactionLogPath, `${logEntry}\n`, "utf8");
      const nextState = {
        ...state,
        interactionInterrogation: {
          ...interaction,
          lastRunAtIso: now.toISOString(),
          lastRunId: runInfo.runId,
          lastPatternIds: recommendations.map((recommendation) => recommendation.id),
          lastTopRecommendations: recommendations.map((recommendation) => recommendation.id).slice(0, 3),
          lastImpactScore: impactScore,
          recentImpactScores: [...scoreHistory, impactScore].slice(-10),
          activeRuleIds: {
            user: previousUserRules,
            agents: previousAgentRules,
          },
          lastRuleUpdateRunId: interaction.lastRuleUpdateRunId || "n/a",
          lastSkillDensity: skillDensity,
          lastToolFailureRate24: toolFailureRate24,
          lastErrorClusterCount: repeatedFailureClusterCount,
          lastHighChurnCount: highChurnHotspotCount,
          lastCiFailureRepeats: ciFailureRepeatCount,
          followThroughHistory: [
            ...(Array.isArray(interaction.followThroughHistory) ? interaction.followThroughHistory : []),
            {
              runId: runInfo.runId,
              generatedAtIso: now.toISOString(),
              outcomes: followThrough,
            },
          ].slice(-40),
        },
        sharedCoordination: {
          ...sharedCoordination,
        },
      };
      await writeJsonFile(improvementStatePath, nextState);
    } else {
      notes.push("Dry-run persistence disabled; state/log/doc files were not modified.");
    }
  }

  await appendToolcall({
    actor: detectRunActor(),
    tool: "daily-interaction",
    action: "analyze",
    ok: true,
    durationMs: Date.now() - runStartedAt.getTime(),
    context: {
      runId: runInfo.runId,
      recommendations: recommendations.length,
      impactScore,
      structuralDecision: structuralDecision.mode,
      structuralTriggered: structuralDecision.mode === "Triggered",
      prUrl: prUrl || null,
      rollingIssue: rollingIssueUrl || null,
      githubAvailable,
      dryRun: options.dryRun,
      persisted: shouldPersist,
    },
  });

  const output = {
    status: options.apply ? "applied" : "dry-run",
    persisted: shouldPersist,
    runId: runInfo.runId,
    runSlot: runInfo.runSlot,
    timeZone: TZ,
    windows: {
      primaryHours: PRIMARY_WINDOW_HOURS,
      rollupHours: SECONDARY_WINDOW_HOURS,
      start12Iso,
      start24Iso,
    },
    interactionSummary: {
      commitsAnalyzed: summary.commitsAnalyzed,
      prDiscussionsAnalyzed: summary.prDiscussionsAnalyzed,
      clarificationLoopsDetected: summary.clarificationLoopsDetected,
      clarificationComments: summary.clarificationComments,
      workflowRestatements: summary.workflowRestatements,
    },
    frictionPatterns: recommendations,
    impactSinceLastRun,
    recommendationFollowThrough: followThrough,
    skillDensity,
    skillSpikes,
    impactScore,
    structuralDecision,
    nextFocus,
    prsCreatedOrUpdated: prUrl ? [prUrl] : [],
    rollingIssue: rollingIssueUrl || null,
    notes,
    artifacts: {
      interactionLogPath: relative(repoRoot, interactionLogPath),
      improvementStatePath: relative(repoRoot, improvementStatePath),
      userDocPath: relative(repoRoot, userDocPath),
      agentsDocPath: relative(repoRoot, agentsDocPath),
      branch: usedBranch || null,
      prNumber,
      createdOrUpdatedPr,
    },
  };

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `status: ${output.status}`,
        `runId: ${output.runId}`,
        `impactScore: ${output.impactScore}`,
        `patterns: ${output.frictionPatterns.length}`,
        `structural: ${output.structuralDecision.mode}`,
        `pr: ${output.prsCreatedOrUpdated[0] || "none"}`,
        "",
      ].join("\n")
    );
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);

  try {
    await ensureContracts();
    await appendToolcall({
      actor: detectRunActor(),
      tool: "daily-interaction",
      action: "analyze",
      ok: false,
      durationMs: null,
      errorType: "runtime_error",
      errorMessage: message,
      context: null,
    });
  } catch {
    // Ignore nested logging failures.
  }

  console.error(`daily-interaction failed: ${message}`);
  process.exit(1);
});
