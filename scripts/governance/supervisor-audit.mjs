#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
const BOT_MARKER = "<!-- governance-supervisor-audit -->";

function parseArgs(argv) {
  const parsed = {
    eventPath: process.env.GITHUB_EVENT_PATH || "",
    outputJson: "output/governance/supervisor-audit.json",
    outputMarkdown: "output/governance/supervisor-audit.md",
    governanceRoot: ".governance"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (!arg) continue;
    if ((arg === "--event-path" || arg === "--event") && argv[i + 1]) {
      parsed.eventPath = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === "--output-json" || arg === "--json") && argv[i + 1]) {
      parsed.outputJson = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === "--output-md" || arg === "--markdown") && argv[i + 1]) {
      parsed.outputMarkdown = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === "--governance-root" || arg === "--root") && argv[i + 1]) {
      parsed.governanceRoot = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Governance supervisor audit",
          "",
          "Usage:",
          "  node ./scripts/governance/supervisor-audit.mjs [options]",
          "",
          "Options:",
          "  --event-path <path>      GitHub event payload path",
          "  --output-json <path>     Audit output JSON path",
          "  --output-md <path>       Audit comment markdown path",
          "  --governance-root <dir>  Governance root (default: .governance)"
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, "utf8"));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return fallback;
}

function parseTimestamp(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

function lineValueFromBody(body, key) {
  const regex = new RegExp(`^\\s*${key}\\s*[:=]\\s*(.+)$`, "im");
  const match = String(body || "").match(regex);
  return match ? String(match[1] || "").trim() : "";
}

function parseEvidenceLinks(text) {
  const raw = String(text || "");
  const links = Array.from(raw.matchAll(/https?:\/\/[^\s)]+/g)).map((match) => String(match[0] || "").trim());
  return Array.from(new Set(links));
}

function matchesPathPattern(filePath, pattern) {
  const fileValue = normalizePath(filePath);
  const patternValue = normalizePath(pattern);
  if (!patternValue) return false;
  if (patternValue.endsWith("/**")) {
    const prefix = patternValue.slice(0, -3);
    return fileValue.startsWith(prefix);
  }
  if (patternValue.endsWith("/*")) {
    const prefix = patternValue.slice(0, -2);
    if (!fileValue.startsWith(prefix)) return false;
    const rest = fileValue.slice(prefix.length).replace(/^\/+/, "");
    return rest.length > 0 && !rest.includes("/");
  }
  return fileValue === patternValue || fileValue.startsWith(`${patternValue}/`);
}

async function ghFetchJson(endpoint, token) {
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${apiBase}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "monsoonfire-governance-supervisor"
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${endpoint} failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function ghPaginate(endpointFactory, token, limit = 500) {
  const rows = [];
  let page = 1;
  while (rows.length < limit) {
    const endpoint = endpointFactory(page);
    const pageRows = await ghFetchJson(endpoint, token);
    if (!Array.isArray(pageRows) || pageRows.length === 0) break;
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
    page += 1;
  }
  return rows.slice(0, limit);
}

function loadJsonOrDefault(pathValue, fallback) {
  if (!existsSync(pathValue)) return fallback;
  try {
    return readJson(pathValue);
  } catch {
    return fallback;
  }
}

function loadIntentIndex(governanceRoot) {
  const intentsDir = resolve(governanceRoot, "intents");
  const index = new Map();
  if (!existsSync(intentsDir)) return index;
  const files = readdirSync(intentsDir).filter((file) => file.endsWith(".intent.json")).sort();
  for (const fileName of files) {
    try {
      const absolutePath = resolve(intentsDir, fileName);
      const intent = readJson(absolutePath);
      const intentId = String(intent.intent_id || "").trim();
      if (!intentId) continue;
      index.set(intentId, {
        intent,
        filePath: normalizePath(`.governance/intents/${fileName}`)
      });
    } catch {
      // ignore malformed intent here; validator handles this independently
    }
  }
  return index;
}

function resolveIntentReference(prText, intentIndex) {
  const text = String(prText || "");
  const idMatch = text.match(/intent(?:_id)?\s*[:=]\s*([a-z0-9._-]+)/i);
  if (idMatch) {
    const intentId = String(idMatch[1]).trim();
    if (intentIndex.has(intentId)) return intentIndex.get(intentId);
    return { intent: null, filePath: "", missingIntentId: intentId };
  }
  const pathMatch = text.match(/\.governance\/intents\/([a-z0-9._-]+)\.intent\.json/i);
  if (pathMatch) {
    const expected = String(pathMatch[1] || "").trim();
    for (const row of intentIndex.values()) {
      if (row.filePath.endsWith(`${expected}.intent.json`)) return row;
    }
    return { intent: null, filePath: "", missingIntentId: expected };
  }
  return null;
}

function loadAuthorityMap(governanceRoot) {
  return loadJsonOrDefault(resolve(governanceRoot, "config/authority-map.json"), {
    verified_identities: [],
    default_unknown_identity_tier: 5
  });
}

function roleForLogin(login, authorityMap) {
  const normalized = String(login || "").toLowerCase();
  const identities = Array.isArray(authorityMap.verified_identities) ? authorityMap.verified_identities : [];
  const found = identities.find((row) => String(row.github_login || "").toLowerCase() === normalized);
  return found ? String(found.role || "unknown") : "unknown";
}

function tierForLogin(login, authorityMap) {
  const normalized = String(login || "").toLowerCase();
  const identities = Array.isArray(authorityMap.verified_identities) ? authorityMap.verified_identities : [];
  const found = identities.find((row) => String(row.github_login || "").toLowerCase() === normalized);
  return found ? Number(found.tier || 5) : Number(authorityMap.default_unknown_identity_tier || 5);
}

function extractBotAuditMeta(commentBody) {
  const body = String(commentBody || "");
  if (!body.includes(BOT_MARKER)) return null;
  const eventType = lineValueFromBody(body, "-\\s*Primary Event Type");
  const action = lineValueFromBody(body, "-\\s*Recommended Action");
  const severity = lineValueFromBody(body, "-\\s*Severity");
  const confidenceRaw = lineValueFromBody(body, "-\\s*Confidence");
  const confidence = Number(confidenceRaw);
  return {
    eventType: eventType || "",
    action: action || "",
    severity: severity || "",
    confidence: Number.isFinite(confidence) ? confidence : null
  };
}

function withinWindow(tsMs, nowMs, windowMs) {
  return tsMs > 0 && nowMs - tsMs <= windowMs;
}

function classifySeverity(findings) {
  if (findings.some((row) => row.severity === "critical")) return "critical";
  if (findings.some((row) => row.severity === "high")) return "high";
  if (findings.some((row) => row.severity === "medium")) return "medium";
  return "low";
}

function classifyPrimaryEventType(findings) {
  const priorities = ["integrity_failure", "constraint_violation", "grounding_gap", "drift", "needs_human_input"];
  for (const type of priorities) {
    if (findings.some((row) => row.eventType === type)) return type;
  }
  return "needs_human_input";
}

function buildQuestions(findings, maxQuestions) {
  const rows = [];
  for (const finding of findings) {
    for (const question of finding.questions || []) {
      if (!rows.some((row) => row.question === question.question)) {
        rows.push(question);
      }
      if (rows.length >= maxQuestions) return rows;
    }
  }
  return rows.slice(0, maxQuestions);
}

function hasMergeRecommendation(text) {
  return /(ready[- ]to[- ]merge|recommend(?:ed)?\s+merge|ship\s+it|lgtm\s+for\s+merge)/i.test(String(text || ""));
}

function computeCriteriaCoverage(intent, sources) {
  if (!intent || !Array.isArray(intent.required_evidence) || intent.required_evidence.length === 0) {
    return { total: 0, covered: 0, ratio: 1 };
  }
  let covered = 0;
  for (const row of intent.required_evidence) {
    const accepted = Array.isArray(row?.accepted_sources) ? row.accepted_sources : [];
    const ok = accepted.some((source) => sources.has(source));
    if (ok) covered += 1;
  }
  const total = intent.required_evidence.length;
  return {
    total,
    covered,
    ratio: total > 0 ? covered / total : 1
  };
}

function loadThresholds(governanceRoot) {
  return loadJsonOrDefault(resolve(governanceRoot, "config/supervisor-thresholds.json"), {});
}

function canaryWindowActive(config, nowMs) {
  if (!parseBoolean(config.enabled, false)) return false;
  const startMs = parseTimestamp(config.start_utc);
  const durationDays = Number(config.duration_days || 0);
  if (startMs <= 0 || durationDays <= 0) return false;
  const endMs = startMs + durationDays * 24 * 60 * 60 * 1000;
  return nowMs >= startMs && nowMs <= endMs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.eventPath) throw new Error("Missing --event-path (or GITHUB_EVENT_PATH).");

  const event = readJson(resolve(args.eventPath));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (!token) throw new Error("Missing GITHUB_TOKEN (or GH_TOKEN).");

  const owner = event.repository?.owner?.login || event.repository?.owner?.name;
  const repo = event.repository?.name;
  if (!owner || !repo) throw new Error("Unable to resolve repository from event payload.");

  const pullNumber =
    event.pull_request?.number ||
    (Array.isArray(event.workflow_run?.pull_requests) ? event.workflow_run.pull_requests[0]?.number : null);
  if (!pullNumber) throw new Error("No pull request number found in event payload.");

  const governanceRoot = resolve(REPO_ROOT, args.governanceRoot);
  const thresholds = loadThresholds(governanceRoot);
  const authorityMap = loadAuthorityMap(governanceRoot);
  const intentIndex = loadIntentIndex(governanceRoot);

  const nowMs = Date.now();
  const pr = await ghFetchJson(`/repos/${owner}/${repo}/pulls/${pullNumber}`, token);
  const changedFiles = await ghPaginate(
    (page) => `/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
    token
  );
  const reviews = await ghPaginate(
    (page) => `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews?per_page=100&page=${page}`,
    token
  );
  const comments = await ghPaginate(
    (page) => `/repos/${owner}/${repo}/issues/${pullNumber}/comments?per_page=100&page=${page}`,
    token
  );
  const checkRunsResponse = await ghFetchJson(`/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`, token);

  const prText = `${pr.title || ""}\n${pr.body || ""}`;
  const intentRef = resolveIntentReference(prText, intentIndex);
  const intent = intentRef?.intent || null;
  const riskLevel = String(intent?.risk_level || "medium");
  const findings = [];
  const evidenceRefs = [];

  if (!intentRef || !intentRef.intent) {
    findings.push({
      severity: "medium",
      eventType: "grounding_gap",
      summary: intentRef?.missingIntentId
        ? `PR references missing intent id "${intentRef.missingIntentId}".`
        : "PR does not reference an intent contract.",
      questions: [
        {
          question: "Which intent contract governs this PR?",
          why: "Supervisor cannot verify constraints and success criteria without intent context."
        }
      ]
    });
  } else {
    evidenceRefs.push(`tier3:intent:${intentRef.filePath}@${pr.head.sha}`);
  }

  const labels = Array.isArray(pr.labels) ? pr.labels.map((row) => String(row?.name || "")) : [];
  const overrideCfg = thresholds.override_valve || {};
  const overrideLabel = String(overrideCfg.label || "human-override");
  const overrideActive = labels.includes(overrideLabel);
  const overrideReason = lineValueFromBody(pr.body || "", String(overrideCfg.reason_key || "override_reason"));
  const overrideExpiresRaw = lineValueFromBody(pr.body || "", String(overrideCfg.expires_key || "override_expires"));
  const overrideExpiresMs = parseTimestamp(overrideExpiresRaw);
  const overrideExpired = overrideActive && overrideExpiresMs > 0 && overrideExpiresMs < nowMs;

  let overrideActorTier = 5;
  try {
    const issueEvents = await ghPaginate(
      (page) => `/repos/${owner}/${repo}/issues/${pullNumber}/events?per_page=100&page=${page}`,
      token
    );
    const latestOverrideEvent = issueEvents
      .filter((row) => String(row?.event || "") === "labeled" && String(row?.label?.name || "") === overrideLabel)
      .sort((a, b) => parseTimestamp(b?.created_at) - parseTimestamp(a?.created_at))[0];
    overrideActorTier = latestOverrideEvent ? tierForLogin(latestOverrideEvent?.actor?.login, authorityMap) : 5;
  } catch {
    overrideActorTier = 5;
  }

  if (overrideActive) {
    if (!overrideReason) {
      findings.push({
        severity: "medium",
        eventType: "needs_human_input",
        summary: `Override label "${overrideLabel}" is set but override reason is missing.`,
        questions: [
          {
            question: "Please add override_reason in PR body.",
            why: "Urgent override needs traceable decision rationale."
          }
        ]
      });
    }
    if (!overrideExpiresRaw || overrideExpiresMs <= 0) {
      findings.push({
        severity: "medium",
        eventType: "needs_human_input",
        summary: `Override label "${overrideLabel}" is set but override expiry is missing or invalid.`,
        questions: [
          {
            question: "Please add override_expires in PR body (ISO-8601 UTC).",
            why: "Override must be time-bounded to avoid indefinite policy bypass."
          }
        ]
      });
    } else if (overrideExpired) {
      findings.push({
        severity: "high",
        eventType: "constraint_violation",
        summary: `Override label "${overrideLabel}" has expired.`,
        questions: [
          {
            question: "Renew override with new expiry or remove override label.",
            why: "Expired overrides cannot remain active."
          }
        ]
      });
    }
    if (overrideActorTier === 1) {
      evidenceRefs.push(`tier1:human_override:${overrideLabel}@pr-${pullNumber}`);
    }
  }

  if (intent) {
    const allowedPaths = Array.isArray(intent.constraints?.allowed_paths) ? intent.constraints.allowed_paths : [];
    if (allowedPaths.length > 0) {
      const outOfScope = changedFiles
        .map((row) => String(row?.filename || ""))
        .filter((filePath) => filePath && !allowedPaths.some((pattern) => matchesPathPattern(filePath, pattern)));
      if (outOfScope.length > 0) {
        findings.push({
          severity: "high",
          eventType: "constraint_violation",
          summary: `Found ${outOfScope.length} changed files outside allowed scope.`,
          details: outOfScope.slice(0, 16),
          questions: [
            {
              question: "Should out-of-scope files be split into a separate intent?",
              why: "Scope containment is an explicit intent constraint."
            }
          ]
        });
      }
    }

    const maxChanged = Number(intent.constraints?.max_changed_files || 0);
    if (Number.isFinite(maxChanged) && maxChanged > 0 && changedFiles.length > maxChanged) {
      findings.push({
        severity: "medium",
        eventType: "drift",
        summary: `Changed file count ${changedFiles.length} exceeds max_changed_files ${maxChanged}.`,
        questions: [
          {
            question: "Can this PR be split to reduce verification risk?",
            why: "Large change sets increase drift and false-confidence risk."
          }
        ]
      });
    }

    const criteria = Array.isArray(intent.success_criteria) ? intent.success_criteria : [];
    const evidenceRows = Array.isArray(intent.required_evidence) ? intent.required_evidence : [];
    const mapped = new Set(evidenceRows.map((row) => String(row?.criterion_id || "").trim()).filter(Boolean));
    const unmapped = criteria.map((row) => String(row?.id || "").trim()).filter(Boolean).filter((id) => !mapped.has(id));
    if (unmapped.length > 0) {
      findings.push({
        severity: "high",
        eventType: "grounding_gap",
        summary: `Intent has ${unmapped.length} success criteria without evidence mapping.`,
        details: unmapped,
        questions: [
          {
            question: "Map each success criterion to required evidence.",
            why: "Verification cannot be completed without criterion-evidence mapping."
          }
        ]
      });
    }
  }

  const checkRuns = Array.isArray(checkRunsResponse.check_runs) ? checkRunsResponse.check_runs : [];
  const failedChecks = checkRuns.filter((row) =>
    ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(String(row?.conclusion || ""))
  );
  if (failedChecks.length > 0) {
    findings.push({
      severity: failedChecks.length >= 2 ? "high" : "medium",
      eventType: "grounding_gap",
      summary: `Detected ${failedChecks.length} failing check run(s) on head commit.`,
      details: failedChecks.slice(0, 8).map((row) => ({
        name: row.name,
        conclusion: row.conclusion,
        html_url: row.html_url || ""
      })),
      questions: [
        {
          question: "Which single failing check should be fixed first?",
          why: "Focused triage reduces repeated CI loops."
        }
      ]
    });
  } else {
    evidenceRefs.push(`tier2:ci:check_runs:${checkRuns.length}@${pr.head.sha}`);
  }

  const evidenceLinks = parseEvidenceLinks(pr.body || "");
  if (evidenceLinks.length > 0) {
    evidenceRefs.push(...evidenceLinks.slice(0, 12).map((url) => `tier2:link:${url}`));
  }

  const approvals = reviews
    .filter((row) => String(row?.state || "").toUpperCase() === "APPROVED")
    .filter((row) => tierForLogin(row?.user?.login, authorityMap) === 1);
  if (approvals.length > 0) {
    const latest = approvals[approvals.length - 1];
    evidenceRefs.push(`tier1:human:${latest.user.login}:${latest.html_url || latest.id}`);
  }

  const qualityPolicy = thresholds.quality_policy || {};
  const hypothesisKey = String(qualityPolicy.hypothesis_mode_key || "hypothesis_mode");
  const hypothesisMode = parseBoolean(lineValueFromBody(pr.body || "", hypothesisKey), false);
  const hasTier1 = approvals.length > 0 || (overrideActive && overrideActorTier === 1);
  const hasTier2 = checkRuns.length > 0 || evidenceLinks.length > 0;
  const hasTier3Doc = /[A-Za-z0-9_./-]+\.md@[0-9a-f]{7,40}/.test(prText);
  const hasTier4Memory = /(open-memory|memory:\/\/|memory_id[:=])/i.test(prText);
  const hasNonTier5Evidence = hasTier1 || hasTier2 || hasTier3Doc || hasTier4Memory;
  if (!hasNonTier5Evidence && !hypothesisMode) {
    findings.push({
      severity: "high",
      eventType: "grounding_gap",
      summary: "No tier 1-4 evidence detected; tier-5-only assertions are not allowed.",
      questions: [
        {
          question: "Add at least one tier 1-4 evidence reference before continuing.",
          why: "Tier-5-only claims cannot support action-impacting decisions."
        }
      ]
    });
  } else if (!hasNonTier5Evidence && hypothesisMode) {
    findings.push({
      severity: "low",
      eventType: "needs_human_input",
      summary: "Hypothesis mode is active without tier 1-4 evidence; validation step is required before merge recommendation.",
      questions: [
        {
          question: "What concrete validation step will convert this hypothesis into evidence?",
          why: "Hypothesis mode is allowed only as a bridge to grounded verification."
        }
      ]
    });
  }

  const sourceSet = new Set();
  if (hasTier1) sourceSet.add("human");
  if (checkRuns.length > 0) {
    sourceSet.add("ci");
    sourceSet.add("test");
    sourceSet.add("tool_output");
  }
  if (hasTier3Doc) sourceSet.add("repo_doc");
  if (hasTier4Memory) sourceSet.add("memory");
  const criteriaCoverage = computeCriteriaCoverage(intent, sourceSet);
  if (hasMergeRecommendation(prText) && parseBoolean(qualityPolicy.merge_recommendation_requires_criteria_evidence, true)) {
    if (criteriaCoverage.ratio < 1) {
      findings.push({
        severity: "high",
        eventType: "grounding_gap",
        summary: `Merge recommendation present but criteria evidence coverage is ${(criteriaCoverage.ratio * 100).toFixed(0)}%.`,
        questions: [
          {
            question: "Provide evidence for each success criterion before recommending merge.",
            why: "Merge recommendations require criterion-complete grounding."
          }
        ]
      });
    }
  }

  const severity = classifySeverity(findings);
  const highCount = findings.filter((row) => row.severity === "high" || row.severity === "critical").length;
  const mediumCount = findings.filter((row) => row.severity === "medium").length;

  const confidenceScore = clamp01(
    0.2 +
      (intent ? 0.15 : 0) +
      (hasTier1 ? 0.2 : 0) +
      (hasTier2 ? 0.2 : 0) +
      (hasTier3Doc ? 0.1 : 0) +
      (hasTier4Memory ? 0.05 : 0) -
      Math.min(0.45, findings.length * 0.07)
  );

  const botComments = comments
    .filter((row) => row?.user?.type === "Bot")
    .map((row) => ({
      createdAtMs: parseTimestamp(row?.created_at),
      body: String(row?.body || ""),
      meta: extractBotAuditMeta(row?.body || "")
    }))
    .filter((row) => row.meta);

  const persistenceWindowMs = Number(thresholds.decision_ladder?.hold?.persistence_window_hours || 24) * 60 * 60 * 1000;
  const sameEventRecentCount = botComments.filter(
    (row) => withinWindow(row.createdAtMs, nowMs, persistenceWindowMs) && row.meta.eventType === eventType
  ).length;
  const holdCount24h = botComments.filter(
    (row) =>
      withinWindow(row.createdAtMs, nowMs, 24 * 60 * 60 * 1000) &&
      row.meta.action === "hold_for_verification"
  ).length;
  const escalationCount24h = botComments.filter(
    (row) =>
      withinWindow(row.createdAtMs, nowMs, 24 * 60 * 60 * 1000) &&
      row.meta.action === "escalate_human_review"
  ).length;

  const openPulls = await ghPaginate(
    (page) => `/repos/${owner}/${repo}/pulls?state=open&per_page=100&page=${page}`,
    token,
    300
  );
  const openPrCount = openPulls.length;
  const openHoldCount = openPulls.filter((row) =>
    Array.isArray(row.labels) && row.labels.some((label) => String(label?.name || "") === "verification-hold")
  ).length;
  const holdRate = openPrCount > 0 ? openHoldCount / openPrCount : 0;

  let ciInfraFailureRate = 0;
  let ciInfraFailureCount = 0;
  let ciInfraTotal = 0;
  try {
    const runsPayload = await ghFetchJson(`/repos/${owner}/${repo}/actions/runs?per_page=100`, token);
    const runs = Array.isArray(runsPayload.workflow_runs) ? runsPayload.workflow_runs : [];
    const infraWindowMs = Number(thresholds.circuit_breaker?.ci_infra_failure_window_hours || 1) * 60 * 60 * 1000;
    const recent = runs.filter((row) => withinWindow(parseTimestamp(row?.created_at), nowMs, infraWindowMs));
    ciInfraTotal = recent.length;
    ciInfraFailureCount = recent.filter((row) => ["failure", "cancelled", "timed_out"].includes(String(row?.conclusion || ""))).length;
    ciInfraFailureRate = ciInfraTotal > 0 ? ciInfraFailureCount / ciInfraTotal : 0;
  } catch {
    ciInfraFailureRate = 0;
    ciInfraFailureCount = 0;
    ciInfraTotal = 0;
  }

  const cbCfg = thresholds.circuit_breaker || {};
  const circuitBreakerActive =
    parseBoolean(cbCfg.enabled, true) &&
    (
      (
        openPrCount >= Number(cbCfg.min_open_prs_for_hold_rate || 4) &&
        holdRate > Number(cbCfg.hold_rate_max || 0.25)
      ) ||
      (
        ciInfraTotal >= Number(cbCfg.ci_infra_failure_min_runs || 8) &&
        ciInfraFailureRate >= Number(cbCfg.ci_infra_failure_rate_threshold || 0.6)
      )
    );

  const pushGraceCfg = thresholds.push_grace || {};
  const pushGraceMs = Number(pushGraceCfg.minutes_after_synchronize || 10) * 60 * 1000;
  const pushGraceActive =
    parseBoolean(pushGraceCfg.enabled, true) &&
    String(event.action || "").toLowerCase() === "synchronize" &&
    withinWindow(parseTimestamp(pr.updated_at), nowMs, pushGraceMs);

  const canaryCfg = thresholds.canary_rollout || {};
  let canaryEligible = true;
  if (canaryWindowActive(canaryCfg, nowMs)) {
    const requiredLabels = Array.isArray(canaryCfg.required_labels_any) ? canaryCfg.required_labels_any : [];
    const requiredPaths = Array.isArray(canaryCfg.required_paths_any) ? canaryCfg.required_paths_any : [];
    const requiredRoles = Array.isArray(canaryCfg.required_authority_roles_any) ? canaryCfg.required_authority_roles_any : [];
    const hasLabelGate =
      requiredLabels.length === 0 || labels.some((label) => requiredLabels.includes(label));
    const hasPathGate =
      requiredPaths.length === 0 ||
      changedFiles.some((row) => requiredPaths.some((pattern) => matchesPathPattern(row?.filename || "", pattern)));
    const authorRole = roleForLogin(pr.user?.login || "", authorityMap);
    const hasRoleGate = requiredRoles.length === 0 || requiredRoles.includes(authorRole);
    canaryEligible = hasLabelGate || hasPathGate || hasRoleGate;
  }

  const holdCfg = thresholds.decision_ladder?.hold || {};
  const escalateCfg = thresholds.decision_ladder?.escalate || {};
  const idempotency = thresholds.idempotency || {};
  const maxHoldsPerDay = Number(idempotency.max_holds_per_pr_per_day || 2);
  const maxEscalationsPerDay = Number(idempotency.max_escalations_per_pr_per_day || 1);
  const holdCapReached = holdCount24h >= maxHoldsPerDay;
  const escalationCapReached = escalationCount24h >= maxEscalationsPerDay;

  const holdHighGate = highCount >= Number(holdCfg.high_findings_min || 1) && confidenceScore >= Number(holdCfg.minimum_confidence || 0.7);
  const holdMediumGate =
    mediumCount >= Number(holdCfg.medium_findings_min || 2) &&
    (!parseBoolean(holdCfg.require_persistence_for_medium, true) || sameEventRecentCount >= 1);
  const holdCiGate = failedChecks.length >= Number(thresholds.intervention_ladder?.hold_for_verification?.failed_ci_checks_min || 2);
  let holdEligible = holdHighGate || holdMediumGate || holdCiGate;

  const escalateHighGate =
    highCount >= Number(escalateCfg.high_findings_min || 2) &&
    confidenceScore >= Number(escalateCfg.minimum_confidence || 0.8);
  const escalateCiGate = failedChecks.length >= Number(escalateCfg.failed_ci_checks_min || 4);
  const escalateRepeatHoldGate = holdCount24h >= Number(escalateCfg.repeat_holds_same_pr_min || 2);
  let escalateEligible = escalateHighGate && (escalateCiGate || sameEventRecentCount >= 1 || mediumCount >= 2);
  if (escalateRepeatHoldGate) escalateEligible = true;

  const riskPolicy = thresholds.risk_policy || {};
  if (riskLevel === "low") {
    if (!parseBoolean(riskPolicy.low?.allow_hold, false) && highCount < 2) holdEligible = false;
    if (!parseBoolean(riskPolicy.low?.allow_escalation, false)) escalateEligible = false;
  }
  if (riskLevel === "medium" && !parseBoolean(riskPolicy.medium?.allow_hold_on_repeated_medium, true) && mediumCount > 0) {
    holdEligible = holdHighGate || holdCiGate;
  }
  if (riskLevel === "high" || riskLevel === "critical") {
    if (!parseBoolean(riskPolicy[riskLevel]?.allow_hold_fast, true)) holdEligible = holdMediumGate || holdCiGate;
    if (!parseBoolean(riskPolicy[riskLevel]?.allow_escalation_fast, true)) escalateEligible = false;
  }

  let recommendation = "observe";
  let recommendationReason = "no_threshold_crossed";
  if (overrideActive && !overrideExpired) {
    recommendation = "observe";
    recommendationReason = "human_override_active";
  } else if (pushGraceActive) {
    recommendation = "observe";
    recommendationReason = "push_grace_window";
  } else if (!canaryEligible) {
    recommendation = "observe";
    recommendationReason = "canary_not_eligible";
  } else if (circuitBreakerActive) {
    recommendation = "observe";
    recommendationReason = "circuit_breaker_active";
  } else if (escalateEligible && !escalationCapReached) {
    recommendation = "escalate_human_review";
    recommendationReason = "escalation_threshold";
  } else if (holdEligible && !holdCapReached) {
    recommendation = "hold_for_verification";
    recommendationReason = "hold_threshold";
  } else if (escalationCapReached) {
    recommendation = "observe";
    recommendationReason = "escalation_cap_reached";
  } else if (holdCapReached) {
    recommendation = "observe";
    recommendationReason = "hold_cap_reached";
  }

  const eventType = classifyPrimaryEventType(findings);
  const maxQuestions = Number(thresholds.human_question_protocol?.max_questions_per_cycle || 3);
  const questions = buildQuestions(findings, maxQuestions);

  const previousHash = "0".repeat(64);
  const auditBase = {
    event_id: `audit-${Date.now()}-${randomUUID().slice(0, 8)}`,
    supervisor_version: "governance-supervisor.v2",
    subject_pr: Number(pullNumber),
    subject_run_id: process.env.GITHUB_RUN_ID ? String(process.env.GITHUB_RUN_ID) : null,
    intent_id: intent ? String(intent.intent_id || "") : null,
    intent_version: intent ? Number(intent.version || 1) : null,
    event_type: eventType,
    severity,
    summary: findings.length > 0 ? findings.map((row, idx) => `${idx + 1}. ${row.summary}`).join(" ") : "No blocking governance findings detected.",
    evidence_refs: Array.from(new Set(evidenceRefs)),
    recommended_action: recommendation,
    action_taken: "none",
    confidence_score: Number(confidenceScore.toFixed(3)),
    previous_hash: previousHash,
    timestamp: new Date().toISOString()
  };
  const tamperHash = sha256(`${auditBase.previous_hash}${stableStringify(auditBase)}`);
  const auditEvent = { ...auditBase, tamper_hash: tamperHash };

  const controls = {
    recommendation_reason: recommendationReason,
    risk_level: riskLevel,
    canary_eligible: canaryEligible,
    push_grace_active: pushGraceActive,
    circuit_breaker_active: circuitBreakerActive,
    override_active: overrideActive,
    override_expired: overrideExpired,
    override_reason_present: Boolean(overrideReason),
    override_expires_utc: overrideExpiresRaw || null,
    hold_cap_reached: holdCapReached,
    escalation_cap_reached: escalationCapReached,
    hold_count_24h: holdCount24h,
    escalation_count_24h: escalationCount24h,
    same_event_recent_count: sameEventRecentCount,
    criteria_coverage_ratio: Number(criteriaCoverage.ratio.toFixed(3)),
    criteria_coverage_total: criteriaCoverage.total,
    criteria_coverage_covered: criteriaCoverage.covered,
    hypothesis_mode: hypothesisMode,
    no_tier5_alone_satisfied: hasNonTier5Evidence,
    merge_recommendation_detected: hasMergeRecommendation(prText),
    override_followup_required: overrideActive && !overrideExpired
  };

  const scorecard = {
    finding_count: findings.length,
    high_or_critical_findings: highCount,
    medium_findings: mediumCount,
    failed_checks: failedChecks.length,
    changed_files: changedFiles.length,
    evidence_links: evidenceLinks.length,
    confidence_score: auditEvent.confidence_score,
    hold_rate_open_prs: Number(holdRate.toFixed(3)),
    ci_infra_failure_rate: Number(ciInfraFailureRate.toFixed(3))
  };

  const markdownLines = [
    BOT_MARKER,
    "## Governance Audit Findings",
    "",
    `- PR: #${pullNumber}`,
    `- Intent: ${auditEvent.intent_id || "unresolved"}`,
    `- Risk Level: ${riskLevel}`,
    `- Primary Event Type: ${auditEvent.event_type}`,
    `- Severity: ${auditEvent.severity}`,
    `- Recommended Action: ${auditEvent.recommended_action}`,
    `- Recommendation Reason: ${controls.recommendation_reason}`,
    `- Confidence: ${auditEvent.confidence_score}`,
    "",
    "### Policy Gates",
    "",
    `- Canary eligible: ${controls.canary_eligible}`,
    `- Push grace active: ${controls.push_grace_active}`,
    `- Circuit breaker active: ${controls.circuit_breaker_active}`,
    `- Override active: ${controls.override_active}`,
    `- Hold cap reached: ${controls.hold_cap_reached}`,
    `- Escalation cap reached: ${controls.escalation_cap_reached}`,
    "",
    "### Scorecard",
    "",
    `- Findings: ${scorecard.finding_count}`,
    `- High/Critical: ${scorecard.high_or_critical_findings}`,
    `- Medium: ${scorecard.medium_findings}`,
    `- Failed checks: ${scorecard.failed_checks}`,
    `- Changed files: ${scorecard.changed_files}`,
    `- Evidence links in PR body: ${scorecard.evidence_links}`,
    `- Criteria coverage: ${(controls.criteria_coverage_ratio * 100).toFixed(0)}%`,
    "",
    "### Verified",
    ""
  ];

  const verifiedLines = [];
  if (intent) verifiedLines.push(`- Intent contract resolved: \`${intent.intent_id}\``);
  if (checkRuns.length > 0) verifiedLines.push(`- CI check runs discovered: ${checkRuns.length}`);
  if (evidenceLinks.length > 0) verifiedLines.push(`- PR evidence links present: ${evidenceLinks.length}`);
  if (approvals.length > 0) verifiedLines.push("- Tier-1 approval found from verified identity.");
  if (overrideActive) verifiedLines.push(`- Override label \`${overrideLabel}\` is present.`);
  if (verifiedLines.length === 0) verifiedLines.push("- No substantial verified signals yet.");
  markdownLines.push(...verifiedLines, "", "### Unverified / Gaps", "");

  if (findings.length === 0) {
    markdownLines.push("- No blocking unverified gaps detected in this cycle.");
  } else {
    for (const finding of findings) {
      markdownLines.push(`- (${finding.severity}) ${finding.summary}`);
    }
  }

  markdownLines.push("", `### Questions (max ${maxQuestions})`, "");
  if (questions.length === 0) {
    markdownLines.push("- No open questions in this cycle.");
  } else {
    for (const row of questions) {
      markdownLines.push(`- ${row.question}`);
      markdownLines.push(`  - Why this matters: ${row.why}`);
    }
  }

  markdownLines.push("", "### Evidence Refs", "");
  if (auditEvent.evidence_refs.length === 0) {
    markdownLines.push("- none");
  } else {
    for (const ref of auditEvent.evidence_refs.slice(0, 20)) markdownLines.push(`- ${ref}`);
  }

  const outputJsonPath = resolve(REPO_ROOT, args.outputJson);
  const outputMdPath = resolve(REPO_ROOT, args.outputMarkdown);
  mkdirSync(dirname(outputJsonPath), { recursive: true });
  mkdirSync(dirname(outputMdPath), { recursive: true });

  writeFileSync(
    outputJsonPath,
    `${JSON.stringify(
      {
        audit_event: auditEvent,
        findings,
        questions,
        scorecard,
        controls
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(outputMdPath, `${markdownLines.join("\n")}\n`, "utf8");

  process.stdout.write(`supervisor-audit generated: ${normalizePath(args.outputJson)}\n`);
  process.stdout.write(`supervisor-comment generated: ${normalizePath(args.outputMarkdown)}\n`);
}

main().catch((error) => {
  process.stderr.write(`supervisor-audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
