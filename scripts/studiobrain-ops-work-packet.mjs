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

function makePacket(backlogItem, risk, effectivity) {
  const title = backlogItem.title;
  const acceptanceCriteria =
    backlogItem.acceptanceCriteria.length > 0
      ? backlogItem.acceptanceCriteria
      : collectAcceptanceFallback(backlogItem.rawBody || "");
  const packetKey = [title, backlogItem.priority, risk?.title || "", risk?.safeNextStep || firstAcceptance(backlogItem)].join("|");
  const approvalGate = effectivity.remainingApprovalGates.find((gate) => overlapScore(gate, title) > 0) || "";
  return {
    packetId: `ops-wp-${stableHash(packetKey)}`,
    title,
    status: approvalGate ? "approval_gated" : "ready",
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
    ].filter(Boolean),
    why: risk?.likelyImpact || backlogItem.status || "Issue-ready ops backlog item from current docs evidence.",
    safeNextStep: risk?.safeNextStep || firstAcceptance(backlogItem) || "Refresh the read-only evidence packet and attach it to the ops issue.",
    suggestedBranchName: backlogItem.suggestedBranchName || "",
    suggestedPrTitle: backlogItem.suggestedPrTitle || "",
    verification: buildVerification({ ...backlogItem, acceptanceCriteria }, risk),
    humanGate: approvalGate,
    constraints: {
      readOnlyFirst: true,
      noSecrets: true,
      noServiceRestart: true,
      noDataMutation: true,
      writeScope: ["output/ops/swarm"],
    },
  };
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
  return {
    total: valid.length,
    helpful: helpful.length,
    staleOrMisleading: staleOrMisleading.length,
    blocked: valid.filter((entry) => entry.outcome === "blocked").length,
    latest: valid.slice(-10),
  };
}

export function buildOpsWorkPacket(inputs = {}, options = {}) {
  const risks = parseRiskRegister(inputs.riskMarkdown || "");
  const backlog = parseBacklog(inputs.backlogMarkdown || "");
  const effectivity = parseEffectivity(inputs.effectivityMarkdown || "");
  const packets = backlog
    .filter((item) => priorityRank(item.priority) <= 2)
    .map((item) => makePacket(item, matchingRisk(item, risks), effectivity))
    .sort((left, right) => left.priorityRank - right.priorityRank || left.title.localeCompare(right.title))
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
    },
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
        args[key] = key === "outputRoot" || key === "artifact" || key === "latest" || key === "outcomes"
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
  return {
    schema: "studiobrain-ops-work-packet-outcome-report.v1",
    generatedAt: nowIso(),
    appended: toRepoRelative(options.outcomes),
    entry,
    outcomeSummary: buildOutcomeSummary(readJsonl(options.outcomes)),
  };
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
    },
    {
      runId: options.runId,
      maxPackets: options.maxPackets,
    },
  );
  const outcomes = readJsonl(options.outcomes);
  const report = {
    schema: "studiobrain-ops-work-packet-report.v1",
    generatedAt: packet.generatedAt,
    runId: options.runId,
    status: packet.packets.length > 0 ? "pass" : "warn",
    written: options.write
      ? {
          artifact: toRepoRelative(options.artifact),
          latest: toRepoRelative(options.latest),
          outcomes: toRepoRelative(options.outcomes),
        }
      : null,
    packet,
    outcomeSummary: buildOutcomeSummary(outcomes),
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

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    runOpsWorkPacket();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
