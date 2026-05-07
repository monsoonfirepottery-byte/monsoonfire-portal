#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const DEFAULT_OUTPUT_ROOT = resolve(REPO_ROOT, "output", "ops", "swarm");
const DEFAULT_RISK_DOC = resolve(REPO_ROOT, "docs", "ops", "01-risk-register.md");
const DEFAULT_BACKLOG_DOC = resolve(REPO_ROOT, "docs", "ops", "02-kanban-backlog.md");
const DEFAULT_EFFECTIVITY_DOC = resolve(REPO_ROOT, "docs", "ops", "16-effectivity-audit-2026-05-06.md");
const DEFAULT_ADMIN_AUDIT = resolve(REPO_ROOT, "output", "ops", "effectivity", "admin-effectivity-audit-latest.json");
const DEFAULT_SLICE_LEDGER = resolve(REPO_ROOT, "output", "ops", "effectivity", "slice-ledger-latest.json");
const DEFAULT_TOOL_INVENTORY = resolve(REPO_ROOT, "output", "ops", "effectivity", "installed-tool-inventory-latest.json");
const DEFAULT_TOOL_INSTALL_RECOMMENDATIONS = resolve(REPO_ROOT, "output", "ops", "effectivity", "tool-install-recommendations-latest.json");
const DEFAULT_TOOLING_FINDINGS = resolve(REPO_ROOT, "output", "ops", "tooling-quality", "tooling-findings-latest.json");
const DEFAULT_SWARM_PREFLIGHT = resolve(REPO_ROOT, "output", "ops", "swarm-lane-preflight", "swarm-lane-preflight-latest.json");
const VALID_OUTCOMES = new Set([
  "used",
  "helpful",
  "resolved",
  "not_used",
  "stale",
  "misleading",
  "blocked",
  "superseded",
]);

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function slug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function stableHash(value, length = 12) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function toRepoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function readTextIfExists(path) {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      schema: "invalid-json",
      status: "invalid_json",
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseListValue(block, label) {
  const pattern = new RegExp(`^- ${label}:\\s*(.+)$`, "im");
  return clean(block.match(pattern)?.[1] || "");
}

function parseSectionBlocks(markdown, headingLevel) {
  const escaped = "#".repeat(headingLevel);
  const lines = markdown.split(/\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith(`${escaped} `)) {
      if (current) sections.push(current);
      current = { title: clean(line.slice(headingLevel + 1)), body: "" };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) sections.push(current);
  return sections;
}

function parseRiskRegister(markdown, sourcePath = "docs/ops/01-risk-register.md") {
  const sections = parseSectionBlocks(markdown, 3);
  return sections
    .map((section) => ({
      id: `risk-${slug(section.title) || stableHash(section.title)}`,
      title: section.title,
      sourcePath,
      affectedComponent: parseListValue(section.body, "Affected component"),
      evidence: parseListValue(section.body, "Evidence"),
      likelyImpact: parseListValue(section.body, "Likely impact"),
      recommendedAction: parseListValue(section.body, "Recommended action"),
      safeNextStep: parseListValue(section.body, "Safe next step"),
      prCanAddressIt: parseListValue(section.body, "PR can address it"),
      severity: inferRiskSeverity(markdown, section.title),
    }))
    .filter((entry) => entry.title && entry.safeNextStep);
}

function inferRiskSeverity(markdown, title) {
  const index = markdown.indexOf(`### ${title}`);
  if (index < 0) return "unknown";
  const prefix = markdown.slice(0, index);
  const matches = [...prefix.matchAll(/^## (.+)$/gm)];
  return clean(matches.at(-1)?.[1] || "unknown").toLowerCase();
}

function parseBacklog(markdown, sourcePath = "docs/ops/02-kanban-backlog.md") {
  const sections = parseSectionBlocks(markdown, 3);
  return sections
    .map((section) => ({
      id: `backlog-${slug(section.title) || stableHash(section.title)}`,
      title: section.title,
      sourcePath,
      type: parseListValue(section.body, "Type"),
      priority: parseListValue(section.body, "Priority"),
      effort: parseListValue(section.body, "Effort"),
      risk: parseListValue(section.body, "Risk"),
      status: parseListValue(section.body, "Status"),
      recommendedOwner: parseListValue(section.body, "Recommended owner"),
      suggestedBranchName: parseListValue(section.body, "Suggested branch name"),
      suggestedPrTitle: parseListValue(section.body, "Suggested PR title"),
      acceptanceCriteria: collectBulletsAfter(section.body, "Acceptance criteria"),
      rawBody: section.body,
    }))
    .filter((entry) => entry.title && (entry.priority || entry.status || entry.acceptanceCriteria.length > 0));
}

function collectBulletsAfter(block, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`^- ${escapedLabel}:\\s*\\n((?:\\s+- .+(?:\\n|$))+)`, "m"));
  if (match) {
    return match[1]
      .split(/\n/)
      .map((line) => line.match(/^\s+-\s+(.+)$/)?.[1] || "")
      .map(clean)
      .filter(Boolean);
  }
  const lines = block.split(/\n/);
  const values = [];
  let collecting = false;
  for (const line of lines) {
    if (line.trim() === `- ${label}:`) {
      collecting = true;
      continue;
    }
    if (collecting) {
      const nested = line.match(/^\s+-\s+(.+)$/);
      if (nested && /^\s+/.test(line)) {
        values.push(clean(nested[1]));
        continue;
      }
      if (/^- [A-Z][^:]+:/.test(line.trim())) break;
    }
  }
  return values;
}

function parseEffectivity(markdown, sourcePath = "docs/ops/16-effectivity-audit-2026-05-06.md") {
  const executive = [];
  const remainingApprovalGates = [];
  const nextSafeSlices = [];
  let current = "";
  for (const line of markdown.split(/\n/)) {
    if (line.startsWith("## ")) {
      current = clean(line.slice(3));
      continue;
    }
    if (current === "Executive Result" && line.startsWith("- ")) executive.push(clean(line.slice(2)));
    if (current === "Remaining Approval Gates" && line.startsWith("- ")) remainingApprovalGates.push(clean(line.slice(2)));
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (current === "Next Safe Slices" && numbered) nextSafeSlices.push(clean(numbered[1]));
  }
  return {
    sourcePath,
    executive,
    remainingApprovalGates,
    nextSafeSlices,
  };
}

function priorityRank(priority) {
  const normalized = clean(priority).toUpperCase();
  if (normalized === "P0") return 0;
  if (normalized === "P1") return 1;
  if (normalized === "P2") return 2;
  if (normalized === "P3") return 3;
  return 4;
}

function severityRank(severity) {
  const normalized = clean(severity).toLowerCase();
  if (normalized === "critical") return 0;
  if (normalized === "high") return 1;
  if (normalized === "medium") return 2;
  if (normalized === "low") return 3;
  return 4;
}

function terms(text) {
  return new Set(
    clean(text)
      .toLowerCase()
      .replace(/\[[^\]]+\]/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3),
  );
}

function overlapScore(left, right) {
  const a = terms(left);
  const b = terms(right);
  let score = 0;
  for (const word of a) {
    if (b.has(word)) score += 1;
  }
  return score;
}

function matchingRisk(backlogItem, risks) {
  return risks
    .map((risk) => ({
      risk,
      score:
        overlapScore(backlogItem.title, risk.title) * 3 +
        overlapScore(`${backlogItem.type} ${backlogItem.status}`, `${risk.affectedComponent} ${risk.recommendedAction}`),
    }))
    .sort((left, right) => right.score - left.score || severityRank(left.risk.severity) - severityRank(right.risk.severity))[0]?.risk || null;
}

function makePacket(backlogItem, risk, effectivity, freshEvidence) {
  const title = backlogItem.title;
  const acceptanceCriteria =
    backlogItem.acceptanceCriteria.length > 0
      ? backlogItem.acceptanceCriteria
      : collectAcceptanceFallback(backlogItem.rawBody || "");
  const packetKey = [title, backlogItem.priority, risk?.title || "", risk?.safeNextStep || firstAcceptance(backlogItem)].join("|");
  const approvalGate = effectivity.remainingApprovalGates.find((gate) => overlapScore(gate, title) > 0) || "";
  const preflightGate = freshEvidence?.swarmPreflight?.status === "fail"
    ? freshEvidence.swarmPreflight.summary?.recommendation || "Fix failed swarm lane preflight before delegating this packet."
    : "";
  const humanGate = [approvalGate, preflightGate].filter(Boolean).join(" / ");
  return {
    packetId: `ops-wp-${stableHash(packetKey)}`,
    title,
    status: humanGate ? "approval_gated" : "ready",
    priority: backlogItem.priority || "P?",
    priorityRank: priorityRank(backlogItem.priority),
    risk: backlogItem.risk || risk?.severity || "unknown",
    recommendedOwner: backlogItem.recommendedOwner || "Codex",
    sourceSignals: [
      {
        source: "backlog",
        path: backlogItem.sourcePath,
        id: backlogItem.id,
        status: backlogItem.status,
        acceptanceCriteria,
      },
      risk
        ? {
            source: "risk-register",
            path: risk.sourcePath,
            id: risk.id,
            severity: risk.severity,
            evidence: risk.evidence,
            safeNextStep: risk.safeNextStep,
          }
        : null,
      {
        source: "effectivity",
        path: effectivity.sourcePath,
        relevantNextSafeSlices: effectivity.nextSafeSlices.filter((slice) => overlapScore(slice, title) > 0),
      },
      ...freshSourceSignals(freshEvidence),
    ].filter(Boolean),
    why: risk?.likelyImpact || backlogItem.status || "Issue-ready ops backlog item from current docs evidence.",
    safeNextStep: risk?.safeNextStep || firstAcceptance(backlogItem) || "Refresh the read-only evidence packet and attach it to the ops issue.",
    suggestedBranchName: backlogItem.suggestedBranchName || "",
    suggestedPrTitle: backlogItem.suggestedPrTitle || "",
    verification: buildVerification({ ...backlogItem, acceptanceCriteria }, risk),
    humanGate,
    constraints: {
      readOnlyFirst: true,
      noSecrets: true,
      noServiceRestart: true,
      noDataMutation: true,
      writeScope: ["output/ops/swarm"],
    },
  };
}

function makeToolingFindingPacket(task, freshEvidence) {
  const title = clean(task.title);
  const priority = clean(task.priority) || "P2";
  const packetKey = ["tooling-finding", title, clean(task.suggestedBranchName), clean(task.suggestedPrTitle)].join("|");
  return {
    packetId: `ops-wp-${stableHash(packetKey)}`,
    title,
    status: task.approvalRequired ? "approval_gated" : "ready",
    priority,
    priorityRank: priorityRank(priority),
    risk: "low for scoped code cleanup",
    recommendedOwner: clean(task.owner) || "Codex",
    sourceSignals: [
      freshEvidence?.toolingFindings
        ? {
            source: freshEvidence.toolingFindings.source,
            path: freshEvidence.toolingFindings.path,
            status: freshEvidence.toolingFindings.status,
            generatedAt: freshEvidence.toolingFindings.generatedAt || "",
            signalClass: signalClassForSource(freshEvidence.toolingFindings),
            summary: freshEvidence.toolingFindings.summary,
          }
        : null,
      {
        source: "tooling-findings-task",
        title,
        evidence: Array.isArray(task.evidence) ? task.evidence : [],
        files: Array.isArray(task.files) ? task.files : [],
      },
    ].filter(Boolean),
    why: clean(task.problem) || "Issue-ready tooling finding from the latest report-only validator output.",
    safeNextStep: clean(task.proposedFix) || "Make the smallest safe fix and rerun the targeted validator.",
    suggestedBranchName: clean(task.suggestedBranchName),
    suggestedPrTitle: clean(task.suggestedPrTitle),
    verification: Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0
      ? task.acceptanceCriteria.map(clean)
      : [
          "Rerun the targeted validator and confirm the finding is gone or documented as intentional.",
          "Confirm no generated artifact includes secrets, tokens, keys, or raw environment values.",
        ],
    humanGate: task.approvalRequired ? "Tooling finding task requires human approval before execution." : "",
    constraints: {
      readOnlyFirst: true,
      noSecrets: true,
      noServiceRestart: true,
      noDataMutation: true,
      writeScope: Array.isArray(task.files) && task.files.length > 0 ? task.files.map(clean) : ["scripts/"],
    },
  };
}

function toolingFindingPackets(toolingFindings, freshEvidence) {
  if (!Array.isArray(toolingFindings?.tasks)) return [];
  return toolingFindings.tasks
    .filter((task) => clean(task.title))
    .map((task) => makeToolingFindingPacket(task, freshEvidence));
}

function packetReadinessRank(packet) {
  return clean(packet.status) === "ready" ? 0 : 1;
}

function comparePackets(left, right) {
  return left.priorityRank - right.priorityRank
    || packetReadinessRank(left) - packetReadinessRank(right)
    || left.title.localeCompare(right.title);
}

function freshSourceSignals(freshEvidence) {
  if (!freshEvidence) return [];
  return [
    freshEvidence.adminAudit,
    freshEvidence.sliceLedger,
    freshEvidence.toolInventory,
    freshEvidence.toolInstallRecommendations,
    freshEvidence.toolingFindings,
    freshEvidence.swarmPreflight,
  ]
    .filter((source) => source && !["missing", "invalid_json", "invalid_timestamp", "stale"].includes(source.status))
    .flatMap(sourceSignalsForFreshSource);
}

function sourceSignalsForFreshSource(source) {
  const signal = {
    source: source.source,
    path: source.path,
    status: source.status,
    generatedAt: source.generatedAt || "",
    signalClass: signalClassForSource(source),
    summary: source.summary,
  };
  if (
    source.source === "fresh-tool-install-recommendations" &&
    (source.summary?.installNowCandidates || 0) > 0 &&
    (source.summary?.approvalRequired || 0) > 0
  ) {
    return [
      signal,
      {
        ...signal,
        signalClass: "approval_gate",
      },
    ];
  }
  return [signal];
}

function signalClassForSource(source) {
  if (source.source === "fresh-admin-audit") {
    if ((source.summary?.approvalRequiredEvidenceLanes || 0) > 0) return "approval_gate";
    if ((source.summary?.highSeverityEvidenceLanes || 0) > 0) return "evidence_gap";
  }
  if (source.source === "fresh-tool-inventory" && (source.summary?.coverageGaps || 0) > 0) return "coverage_gap";
  if (source.source === "fresh-tool-install-recommendations") {
    if ((source.summary?.installNowCandidates || 0) > 0) return "tool_install_recommendation";
    if ((source.summary?.approvalRequired || 0) > 0) return "approval_gate";
  }
  if (source.source === "fresh-tooling-findings") {
    if ((source.summary?.issueReadyTasks || 0) > 0) return "issue_ready_task";
    if ((source.summary?.coverageGaps || 0) > 0) return "coverage_gap";
  }
  return "fresh";
}

function collectAcceptanceFallback(body) {
  const lines = body.split(/\n/);
  const start = lines.findIndex((line) => /^-\s+Acceptance criteria:\s*$/i.test(clean(line)));
  if (start < 0) return [];
  const values = [];
  for (const line of lines.slice(start + 1)) {
    if (/^-\s+\S[^:]+:/.test(clean(line))) break;
    const match = line.match(/^\s+-\s+(.+)$/);
    if (match) values.push(clean(match[1]));
  }
  return values;
}

function firstAcceptance(backlogItem) {
  return Array.isArray(backlogItem.acceptanceCriteria) ? backlogItem.acceptanceCriteria[0] || "" : "";
}

function buildVerification(backlogItem, risk) {
  const checks = [
    "Run the relevant read-only ops script and keep unavailable host dependencies as warnings.",
    "Confirm generated artifacts do not include environment values, tokens, keys, or raw secrets.",
  ];
  if (backlogItem.acceptanceCriteria.length > 0) {
    checks.push(`Acceptance: ${backlogItem.acceptanceCriteria.slice(0, 2).join(" / ")}`);
  }
  if (risk?.prCanAddressIt) checks.push(`PR scope: ${risk.prCanAddressIt}`);
  return checks;
}

function buildOutcomeSummary(outcomes) {
  const valid = outcomes.filter((entry) => VALID_OUTCOMES.has(clean(entry.outcome)));
  const helpful = valid.filter((entry) => ["used", "helpful", "resolved"].includes(entry.outcome));
  const staleOrMisleading = valid.filter((entry) => ["stale", "misleading"].includes(entry.outcome));
  const byOutcome = Object.fromEntries(Array.from(VALID_OUTCOMES).map((outcome) => [outcome, 0]));
  for (const entry of valid) byOutcome[entry.outcome] += 1;
  const latestByPacket = new Map();
  for (const entry of valid) {
    const packetId = clean(entry.packetId);
    if (packetId) latestByPacket.set(packetId, entry);
  }
  const latestPacketOutcomes = Array.from(latestByPacket.values());
  const staleOrMisleadingPackets = latestPacketOutcomes.filter((entry) => ["stale", "misleading"].includes(clean(entry.outcome)));
  const blockedPackets = latestPacketOutcomes.filter((entry) => clean(entry.outcome) === "blocked");
  const recent = valid.slice(-10);
  const rate = (count) => (valid.length > 0 ? Number((count / valid.length).toFixed(3)) : 0);
  return {
    total: valid.length,
    uniquePackets: latestByPacket.size,
    byOutcome,
    helpful: helpful.length,
    helpfulRate: rate(helpful.length),
    staleOrMisleading: staleOrMisleading.length,
    staleOrMisleadingRate: rate(staleOrMisleading.length),
    blocked: valid.filter((entry) => entry.outcome === "blocked").length,
    staleOrMisleadingPackets,
    blockedPackets,
    latestByPacket: latestPacketOutcomes.slice(-10),
    recent,
    latest: recent,
  };
}

function outcomeHealthFromSummary(summary) {
  const total = Number(summary?.total) || 0;
  const staleOrMisleadingRate = Number(summary?.staleOrMisleadingRate) || 0;
  const staleOrMisleadingPackets = Array.isArray(summary?.staleOrMisleadingPackets) ? summary.staleOrMisleadingPackets : [];
  const blockedPackets = Array.isArray(summary?.blockedPackets) ? summary.blockedPackets : [];
  const warnings = [];
  if (total >= 3 && staleOrMisleadingRate > 0.25) warnings.push(`staleOrMisleadingRate=${staleOrMisleadingRate}`);
  if (blockedPackets.length > 0) warnings.push(`blockedPackets=${blockedPackets.length}`);
  return {
    status: warnings.length > 0 ? "warn" : "pass",
    maturity: total >= 3 ? "evidence_ready" : "warming_up",
    score: warnings.length === 0 ? 1 : total >= 3 && staleOrMisleadingRate > 0.25 ? 0.4 : 0.6,
    warnings,
    thresholds: {
      matureOutcomeCount: 3,
      staleOrMisleadingRateWarn: 0.25,
      blockedPacketWarn: 1,
    },
    staleOrMisleadingPackets,
    blockedPackets,
  };
}

function freshness(generatedAt, options = {}) {
  const maxAgeHours = Number(options.maxAgeHours ?? 24);
  const now = options.now || nowIso();
  const generatedMs = Date.parse(clean(generatedAt));
  const nowMs = Date.parse(clean(now));
  if (!clean(generatedAt)) return { status: "", ageHours: null, maxAgeHours, stale: false };
  if (Number.isNaN(generatedMs) || Number.isNaN(nowMs)) {
    return { status: "invalid_timestamp", ageHours: null, maxAgeHours, stale: true };
  }
  const ageHours = Number(Math.max(0, (nowMs - generatedMs) / 3_600_000).toFixed(2));
  const stale = maxAgeHours > 0 && ageHours > maxAgeHours;
  return { status: stale ? "stale" : "", ageHours, maxAgeHours, stale };
}

function applyFreshness(source, options = {}) {
  const result = freshness(source.generatedAt, options);
  if (!result.status) {
    return {
      ...source,
      sourceStatus: source.status,
      freshness: result,
    };
  }
  return {
    ...source,
    sourceStatus: source.status,
    status: result.status,
    freshness: result,
  };
}

function applyFreshnessWithUpstream(source, upstreamGeneratedAt, upstreamName, options = {}) {
  const checked = applyFreshness(source, options);
  const upstreamFreshness = freshness(upstreamGeneratedAt, options);
  if (!upstreamFreshness.status) {
    return {
      ...checked,
      upstreamFreshness: {
        [upstreamName]: upstreamFreshness,
      },
    };
  }
  return {
    ...checked,
    status: upstreamFreshness.status,
    upstreamFreshness: {
      [upstreamName]: upstreamFreshness,
    },
    freshness: {
      ...checked.freshness,
      upstream: {
        [upstreamName]: upstreamFreshness,
      },
    },
  };
}

function summarizeFreshEvidence(inputs = {}, options = {}) {
  const adminAudit = inputs.adminAudit || null;
  const sliceLedger = inputs.sliceLedger || null;
  const toolInventory = inputs.toolInventory || null;
  const toolInstallRecommendations = inputs.toolInstallRecommendations || null;
  const toolingFindings = inputs.toolingFindings || null;
  const swarmPreflight = inputs.swarmPreflight || null;
  const unavailable = (source, path, status = "missing", summary = {}) => ({
    source,
    path,
    status,
    generatedAt: "",
    summary,
  });
  const effectivityEvidenceLanes = effectivityLanesFromAdminAudit(adminAudit);
  return {
    adminAudit: adminAudit && adminAudit.status !== "invalid_json"
      ? applyFreshness({
          source: "fresh-admin-audit",
          path: inputs.adminAuditPath || "output/ops/effectivity/admin-effectivity-audit-latest.json",
          status: clean(adminAudit.status) || "unknown",
          generatedAt: clean(adminAudit.generatedAt),
          summary: {
            sliceWindow: adminAudit.sliceWindow || null,
            scores: adminAudit.scores || null,
            privilegedEvidence: adminAudit.sections?.effectivityReport?.report?.sections?.privilegedEvidence?.status || "",
            effectivityEvidenceLanes: effectivityEvidenceLanes.length,
            approvalRequiredEvidenceLanes: effectivityEvidenceLanes.filter((lane) => lane.approvalRequired).length,
            highSeverityEvidenceLanes: effectivityEvidenceLanes.filter((lane) => clean(lane.severity) === "high").length,
            topEvidenceLanes: effectivityEvidenceLanes.slice(0, 5).map((lane) => ({
              id: clean(lane.id),
              status: clean(lane.status),
              severity: clean(lane.severity),
              approvalRequired: Boolean(lane.approvalRequired),
              safeNextStep: clean(lane.safeNextStep),
            })),
          },
        }, options)
      : unavailable(
          "fresh-admin-audit",
          inputs.adminAuditPath || "output/ops/effectivity/admin-effectivity-audit-latest.json",
          adminAudit?.status || "missing",
          adminAudit?.parseError ? { parseError: adminAudit.parseError } : {},
        ),
    sliceLedger: sliceLedger && sliceLedger.status !== "invalid_json"
      ? applyFreshness({
          source: "fresh-slice-ledger",
          path: inputs.sliceLedgerPath || "output/ops/effectivity/slice-ledger-latest.json",
          status: sliceLedger.counts?.failed > 0 ? "fail" : sliceLedger.counts?.blocked > 0 || sliceLedger.counts?.noop > 0 ? "warn" : "pass",
          generatedAt: clean(sliceLedger.generatedAt),
          summary: {
            window: sliceLedger.window || null,
            counts: sliceLedger.counts || null,
            scores: sliceLedger.scores || null,
          },
        }, options)
      : unavailable(
          "fresh-slice-ledger",
          inputs.sliceLedgerPath || "output/ops/effectivity/slice-ledger-latest.json",
          sliceLedger?.status || "missing",
          sliceLedger?.parseError ? { parseError: sliceLedger.parseError } : {},
        ),
    toolInventory: toolInventory && toolInventory.status !== "invalid_json"
      ? applyFreshness({
          source: "fresh-tool-inventory",
          path: inputs.toolInventoryPath || "output/ops/effectivity/installed-tool-inventory-latest.json",
          status: clean(toolInventory.status) || "unknown",
          generatedAt: clean(toolInventory.generatedAt),
          summary: {
            installed: toolInventory.summary?.installed ?? null,
            missingRequired: toolInventory.summary?.missingRequired ?? null,
            missingOptional: toolInventory.summary?.missingOptional ?? null,
            actionableFindings: toolInventory.summary?.actionableFindings ?? null,
            coverageGaps: toolInventory.summary?.coverageGaps ?? null,
            promotionCandidates: toolInventory.summary?.promotionCandidates ?? null,
          },
        }, options)
      : unavailable(
          "fresh-tool-inventory",
          inputs.toolInventoryPath || "output/ops/effectivity/installed-tool-inventory-latest.json",
          toolInventory?.status || "missing",
          toolInventory?.parseError ? { parseError: toolInventory.parseError } : {},
      ),
    toolInstallRecommendations: toolInstallRecommendations && toolInstallRecommendations.status !== "invalid_json"
      ? applyFreshnessWithUpstream({
          source: "fresh-tool-install-recommendations",
          path: inputs.toolInstallRecommendationsPath || "output/ops/effectivity/tool-install-recommendations-latest.json",
          status: clean(toolInstallRecommendations.status) || "unknown",
          generatedAt: clean(toolInstallRecommendations.generatedAt),
          summary: {
            recommendations: toolInstallRecommendations.summary?.recommendations ?? null,
            coverageGaps: toolInstallRecommendations.summary?.coverageGaps ?? null,
            approvalRequired: toolInstallRecommendations.summary?.approvalRequired ?? null,
            installNowCandidates: toolInstallRecommendations.summary?.installNowCandidates ?? null,
            inventoryGeneratedAt: clean(toolInstallRecommendations.source?.inventoryGeneratedAt),
            inventoryStatus: clean(toolInstallRecommendations.source?.inventoryStatus),
            topRecommendations: Array.isArray(toolInstallRecommendations.recommendations)
              ? toolInstallRecommendations.recommendations.slice(0, 3).map((item) => ({
                  tool: clean(item.tool),
                  priority: clean(item.priority),
                  acquisitionClass: clean(item.acquisitionClass),
                  validationCommand: clean(item.validationCommand),
                  approvalRequired: Boolean(item.approvalRequired),
                }))
              : [],
          },
        }, toolInstallRecommendations.source?.inventoryGeneratedAt, "inventory", options)
      : unavailable(
          "fresh-tool-install-recommendations",
          inputs.toolInstallRecommendationsPath || "output/ops/effectivity/tool-install-recommendations-latest.json",
          toolInstallRecommendations?.status || "missing",
          {
            recommendations: null,
            coverageGaps: null,
            approvalRequired: null,
            installNowCandidates: null,
            inventoryGeneratedAt: "",
            inventoryStatus: "",
            topRecommendations: [],
            ...(toolInstallRecommendations?.parseError ? { parseError: toolInstallRecommendations.parseError } : {}),
          },
        ),
    toolingFindings: toolingFindings && toolingFindings.status !== "invalid_json"
      ? applyFreshness({
          source: "fresh-tooling-findings",
          path: inputs.toolingFindingsPath || "output/ops/tooling-quality/tooling-findings-latest.json",
          status: clean(toolingFindings.status) || "unknown",
          generatedAt: clean(toolingFindings.generatedAt),
          summary: {
            findings: toolingFindings.summary?.findings ?? null,
            actionableFindings: toolingFindings.summary?.actionableFindings ?? null,
            coverageGaps: toolingFindings.summary?.coverageGaps ?? null,
            issueReadyTasks: toolingFindings.summary?.issueReadyTasks ?? null,
            topTasks: Array.isArray(toolingFindings.tasks)
              ? toolingFindings.tasks.slice(0, 3).map((task) => ({
                  title: clean(task.title),
                  priority: clean(task.priority),
                  approvalRequired: Boolean(task.approvalRequired),
                  suggestedBranchName: clean(task.suggestedBranchName),
                  suggestedPrTitle: clean(task.suggestedPrTitle),
                }))
              : [],
          },
        }, options)
      : unavailable(
          "fresh-tooling-findings",
          inputs.toolingFindingsPath || "output/ops/tooling-quality/tooling-findings-latest.json",
          toolingFindings?.status || "missing",
          toolingFindings?.parseError ? { parseError: toolingFindings.parseError } : {},
        ),
    swarmPreflight: swarmPreflight && swarmPreflight.status !== "invalid_json"
      ? applyFreshness({
          source: "fresh-swarm-preflight",
          path: inputs.swarmPreflightPath || "output/ops/swarm-lane-preflight/swarm-lane-preflight-latest.json",
          status: clean(swarmPreflight.status) || "unknown",
          generatedAt: clean(swarmPreflight.generatedAt),
          summary: {
            lane: swarmPreflight.lane || "",
            branch: swarmPreflight.branch || "",
            base: swarmPreflight.base || "",
            changedFiles: Array.isArray(swarmPreflight.changedFiles) ? swarmPreflight.changedFiles.length : null,
            dirtyFiles: Array.isArray(swarmPreflight.dirtyFiles) ? swarmPreflight.dirtyFiles.length : null,
            outsideScope: Array.isArray(swarmPreflight.outsideScope) ? swarmPreflight.outsideScope.length : null,
            problems: Array.isArray(swarmPreflight.problems) ? swarmPreflight.problems.length : null,
            warnings: Array.isArray(swarmPreflight.warnings) ? swarmPreflight.warnings.length : null,
            recommendation: swarmPreflight.recommendation || "",
          },
        }, options)
      : unavailable(
          "fresh-swarm-preflight",
          inputs.swarmPreflightPath || "output/ops/swarm-lane-preflight/swarm-lane-preflight-latest.json",
          swarmPreflight?.status || "missing",
          swarmPreflight?.parseError ? { parseError: swarmPreflight.parseError } : {},
        ),
  };
}

function effectivityLanesFromAdminAudit(adminAudit) {
  const lanes = adminAudit?.sections?.effectivityReport?.report?.evidenceLanes;
  return Array.isArray(lanes) ? lanes : [];
}

export function buildOpsWorkPacket(inputs = {}, options = {}) {
  const risks = parseRiskRegister(inputs.riskMarkdown || "");
  const backlog = parseBacklog(inputs.backlogMarkdown || "");
  const effectivity = parseEffectivity(inputs.effectivityMarkdown || "");
  const freshEvidence = summarizeFreshEvidence(inputs, {
    maxAgeHours: options.maxAgeHours,
    now: options.now || options.generatedAt,
  });
  const freshEvidenceSources = [
    freshEvidence.adminAudit,
    freshEvidence.sliceLedger,
    freshEvidence.toolInventory,
    freshEvidence.toolInstallRecommendations,
    freshEvidence.toolingFindings,
    freshEvidence.swarmPreflight,
  ];
  const freshSources = freshEvidenceSources.filter((source) => !["missing", "invalid_json", "invalid_timestamp", "stale"].includes(source.status));
  const staleSources = freshEvidenceSources.filter((source) => ["invalid_timestamp", "stale"].includes(source.status));
  const backlogPackets = backlog
    .filter((item) => priorityRank(item.priority) <= 2)
    .map((item) => makePacket(item, matchingRisk(item, risks), effectivity, freshEvidence));
  const packets = [
    ...backlogPackets,
    ...toolingFindingPackets(inputs.toolingFindings, freshEvidence),
  ]
    .sort(comparePackets)
    .slice(0, Number(options.maxPackets || 8));

  return {
    schema: "studiobrain-ops-work-packet.v1",
    generatedAt: options.generatedAt || nowIso(),
    runId: options.runId || "",
    purpose: "Convert current ops risk, backlog, and effectivity evidence into bounded read-only work packets.",
    sources: {
      riskRegister: "docs/ops/01-risk-register.md",
      backlog: "docs/ops/02-kanban-backlog.md",
      effectivity: "docs/ops/16-effectivity-audit-2026-05-06.md",
      adminAudit: freshEvidence.adminAudit.path,
      sliceLedger: freshEvidence.sliceLedger.path,
      toolInventory: freshEvidence.toolInventory.path,
      toolInstallRecommendations: freshEvidence.toolInstallRecommendations.path,
      toolingFindings: freshEvidence.toolingFindings.path,
      swarmPreflight: freshEvidence.swarmPreflight.path,
    },
    constraints: {
      readOnlyFirst: true,
      noSecrets: true,
      noServiceRestart: true,
      noDataMutation: true,
      defaultOutputRoot: "output/ops/swarm",
    },
    evidenceSummary: {
      risks: risks.length,
      backlogItems: backlog.length,
      effectivityNextSafeSlices: effectivity.nextSafeSlices.length,
      remainingApprovalGates: effectivity.remainingApprovalGates.length,
      freshSources: freshSources.length,
      staleSources: staleSources.length,
      toolPromotionCandidates: freshEvidence.toolInventory.summary.promotionCandidates ?? null,
      toolActionableFindings: freshEvidence.toolInventory.summary.actionableFindings ?? null,
      toolCoverageGaps: freshEvidence.toolInventory.summary.coverageGaps ?? null,
      toolInstallRecommendations: freshEvidence.toolInstallRecommendations.summary.recommendations ?? null,
      toolInstallApprovalRequired: freshEvidence.toolInstallRecommendations.summary.approvalRequired ?? null,
      toolInstallNowCandidates: freshEvidence.toolInstallRecommendations.summary.installNowCandidates ?? null,
      toolingFindings: freshEvidence.toolingFindings.summary.findings ?? null,
      toolingActionableFindings: freshEvidence.toolingFindings.summary.actionableFindings ?? null,
      toolingIssueReadyTasks: freshEvidence.toolingFindings.summary.issueReadyTasks ?? null,
      effectivityEvidenceLanes: freshEvidence.adminAudit.summary.effectivityEvidenceLanes ?? null,
      effectivityApprovalRequiredLanes: freshEvidence.adminAudit.summary.approvalRequiredEvidenceLanes ?? null,
      effectivityHighSeverityLanes: freshEvidence.adminAudit.summary.highSeverityEvidenceLanes ?? null,
      swarmPreflightStatus: freshEvidence.swarmPreflight.status,
      swarmPreflightOutsideScope: freshEvidence.swarmPreflight.summary.outsideScope ?? null,
      swarmPreflightProblems: freshEvidence.swarmPreflight.summary.problems ?? null,
    },
    freshEvidence,
    packets,
  };
}

function parseArgs(argv) {
  const args = {
    json: false,
    write: false,
    runId: "",
    outputRoot: DEFAULT_OUTPUT_ROOT,
    artifact: "",
    latest: "",
    outcomes: "",
    adminAudit: DEFAULT_ADMIN_AUDIT,
    sliceLedger: DEFAULT_SLICE_LEDGER,
    toolInventory: DEFAULT_TOOL_INVENTORY,
    toolInstallRecommendations: DEFAULT_TOOL_INSTALL_RECOMMENDATIONS,
    toolingFindings: DEFAULT_TOOLING_FINDINGS,
    swarmPreflight: DEFAULT_SWARM_PREFLIGHT,
    maxAgeHours: 24,
    maxPackets: 8,
    recordOutcome: "",
    outcome: "",
    usedBy: "codex",
    notes: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--write") {
      args.write = true;
      continue;
    }
    const next = clean(argv[index + 1]);
    const read = (flag) => {
      if (arg === flag) {
        if (!next) throw new Error(`${flag} requires a value.`);
        index += 1;
        return next;
      }
      if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
      return null;
    };
    const stringOptions = {
      "--run-id": "runId",
      "--output-root": "outputRoot",
      "--artifact": "artifact",
      "--latest": "latest",
      "--outcomes": "outcomes",
      "--admin-audit": "adminAudit",
      "--slice-ledger": "sliceLedger",
      "--tool-inventory": "toolInventory",
      "--tool-install-recommendations": "toolInstallRecommendations",
      "--tooling-findings": "toolingFindings",
      "--swarm-preflight": "swarmPreflight",
      "--record-outcome": "recordOutcome",
      "--outcome": "outcome",
      "--used-by": "usedBy",
      "--notes": "notes",
      "--note": "notes",
    };
    let matched = false;
    for (const [flag, key] of Object.entries(stringOptions)) {
      const value = read(flag);
      if (value !== null) {
        args[key] = key === "outputRoot" || key === "artifact" || key === "latest" || key === "outcomes" || key === "adminAudit" || key === "sliceLedger" || key === "toolInventory" || key === "toolInstallRecommendations" || key === "toolingFindings" || key === "swarmPreflight"
          ? resolve(REPO_ROOT, value)
          : value;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const maxPackets = read("--max-packets");
    if (maxPackets !== null) {
      args.maxPackets = Math.max(1, Number(maxPackets) || args.maxPackets);
      continue;
    }
    const maxAgeHours = read("--max-age-hours");
    if (maxAgeHours !== null) {
      args.maxAgeHours = Math.max(0, Number(maxAgeHours) || 0);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  args.runId ||= `ops-work-packet-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  args.artifact ||= resolve(args.outputRoot, `${args.runId}.json`);
  args.latest ||= resolve(args.outputRoot, "latest-work-packet.json");
  args.outcomes ||= resolve(args.outputRoot, "outcomes.jsonl");
  return args;
}

function printUsage() {
  process.stdout.write(
    [
      "Studio Brain ops work-packet generator",
      "",
      "Usage:",
      "  node scripts/studiobrain-ops-work-packet.mjs --write [--json]",
      "  node scripts/studiobrain-ops-work-packet.mjs --record-outcome <packetId> --outcome helpful --notes \"used\" [--json]",
      "",
      "Options:",
      "  --write                 Write timestamped and latest JSON packet artifacts.",
      "  --json                  Print JSON report.",
      "  --output-root <path>    Default: output/ops/swarm.",
      "  --admin-audit <path>    Default: output/ops/effectivity/admin-effectivity-audit-latest.json.",
      "  --slice-ledger <path>   Default: output/ops/effectivity/slice-ledger-latest.json.",
      "  --tool-inventory <path> Default: output/ops/effectivity/installed-tool-inventory-latest.json.",
      "  --tool-install-recommendations <path> Default: output/ops/effectivity/tool-install-recommendations-latest.json.",
      "  --tooling-findings <path> Default: output/ops/tooling-quality/tooling-findings-latest.json.",
      "  --swarm-preflight <path> Default: output/ops/swarm-lane-preflight/swarm-lane-preflight-latest.json.",
      "  --max-age-hours <n>     Warn when fresh-input artifacts are older than this. Default: 24.",
      "  --max-packets <n>       Default: 8.",
      "  --record-outcome <id>   Append an outcome ledger entry.",
      "  --outcome <value>       used | helpful | resolved | not_used | stale | misleading | blocked | superseded",
      "",
    ].join("\n"),
  );
}

function recordOutcome(options) {
  if (!options.recordOutcome) throw new Error("--record-outcome requires a packet id.");
  if (!VALID_OUTCOMES.has(options.outcome)) {
    throw new Error(`--outcome must be one of: ${Array.from(VALID_OUTCOMES).join(", ")}`);
  }
  const entry = {
    schema: "studiobrain-ops-work-packet-outcome.v1",
    recordedAt: nowIso(),
    packetId: options.recordOutcome,
    outcome: options.outcome,
    usedBy: options.usedBy,
    notes: options.notes,
  };
  appendJsonl(options.outcomes, entry);
  const outcomeSummary = buildOutcomeSummary(readJsonl(options.outcomes));
  return {
    schema: "studiobrain-ops-work-packet-outcome-report.v1",
    generatedAt: nowIso(),
    appended: toRepoRelative(options.outcomes),
    entry,
    outcomeSummary,
    outcomeHealth: outcomeHealthFromSummary(outcomeSummary),
  };
}

function workPacketReportStatus(packet, outcomeHealth = { status: "pass" }) {
  if (packet.packets.length === 0) return "warn";
  const preflightStatus = packet.freshEvidence?.swarmPreflight?.status;
  if (preflightStatus === "fail") return "fail";
  if (["missing", "invalid_json", "warn"].includes(preflightStatus)) return "warn";
  const toolInstallStatus = packet.freshEvidence?.toolInstallRecommendations?.status;
  if (["missing", "invalid_json", "invalid_timestamp", "stale"].includes(toolInstallStatus)) return "warn";
  if ((packet.evidenceSummary?.staleSources ?? 0) > 0) return "warn";
  if ((packet.evidenceSummary?.freshSources ?? 0) === 0) return "warn";
  if (outcomeHealth.status === "warn") return "warn";
  return "pass";
}

export function runOpsWorkPacket(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  if (options.recordOutcome) {
    const outcomeReport = recordOutcome(options);
    if (options.json) process.stdout.write(`${JSON.stringify(outcomeReport, null, 2)}\n`);
    else process.stdout.write(`ops work-packet outcome recorded: ${outcomeReport.entry.packetId} ${outcomeReport.entry.outcome}\n`);
    return outcomeReport;
  }

  const packet = buildOpsWorkPacket(
    {
      riskMarkdown: readTextIfExists(DEFAULT_RISK_DOC),
      backlogMarkdown: readTextIfExists(DEFAULT_BACKLOG_DOC),
      effectivityMarkdown: readTextIfExists(DEFAULT_EFFECTIVITY_DOC),
      adminAudit: readJsonIfExists(options.adminAudit),
      sliceLedger: readJsonIfExists(options.sliceLedger),
      toolInventory: readJsonIfExists(options.toolInventory),
      toolInstallRecommendations: readJsonIfExists(options.toolInstallRecommendations),
      toolingFindings: readJsonIfExists(options.toolingFindings),
      swarmPreflight: readJsonIfExists(options.swarmPreflight),
      adminAuditPath: toRepoRelative(options.adminAudit),
      sliceLedgerPath: toRepoRelative(options.sliceLedger),
      toolInventoryPath: toRepoRelative(options.toolInventory),
      toolInstallRecommendationsPath: toRepoRelative(options.toolInstallRecommendations),
      toolingFindingsPath: toRepoRelative(options.toolingFindings),
      swarmPreflightPath: toRepoRelative(options.swarmPreflight),
    },
    {
      runId: options.runId,
      maxPackets: options.maxPackets,
      maxAgeHours: options.maxAgeHours,
    },
  );
  const outcomes = readJsonl(options.outcomes);
  const outcomeSummary = buildOutcomeSummary(outcomes);
  const outcomeHealth = outcomeHealthFromSummary(outcomeSummary);
  const report = {
    schema: "studiobrain-ops-work-packet-report.v1",
    generatedAt: packet.generatedAt,
    runId: options.runId,
    status: workPacketReportStatus(packet, outcomeHealth),
    written: options.write
      ? {
          artifact: toRepoRelative(options.artifact),
          latest: toRepoRelative(options.latest),
          outcomes: toRepoRelative(options.outcomes),
        }
      : null,
    packet,
    outcomeSummary,
    outcomeHealth,
  };

  if (options.write) {
    writeJson(options.artifact, packet);
    writeJson(options.latest, packet);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`ops work packet: ${report.status}\n`);
    process.stdout.write(`packets: ${packet.packets.length}\n`);
    if (options.write) process.stdout.write(`artifact: ${toRepoRelative(options.artifact)}\n`);
  }
  return report;
}

export { comparePackets, outcomeHealthFromSummary, summarizeFreshEvidence, workPacketReportStatus };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    runOpsWorkPacket();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
