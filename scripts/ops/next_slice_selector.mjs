#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_RADAR = resolve(REPO_ROOT, "output", "ops", "proactive-radar", "latest.json");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "next-slice-selector");
const SOURCE_SKEW_TOLERANCE_MS = 60_000;

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/") || ".";
}

function usage() {
  return `Studio Brain next safe slice selector

Usage:
  node scripts/ops/next_slice_selector.mjs [--refresh] [--json] [--write]

Options:
  --refresh              Run the proactive radar before selecting.
  --json                 Print JSON to stdout.
  --write                Write latest JSON and Markdown artifacts.
  --radar <path>         Radar JSON path. Default: output/ops/proactive-radar/latest.json.
  --output-dir <path>    Artifact directory. Default: output/ops/next-slice-selector.

This selector is read-only except for optional report writes. It never executes the selected refresh command.
`;
}

function readFlagValue(argv, index, name) {
  const arg = argv[index];
  if (arg === name) {
    if (!argv[index + 1]) throw new Error(`${name} requires a value.`);
    return { matched: true, value: argv[index + 1], nextIndex: index + 1 };
  }
  if (arg.startsWith(`${name}=`)) {
    return { matched: true, value: arg.slice(name.length + 1), nextIndex: index };
  }
  return { matched: false, value: "", nextIndex: index };
}

function parseArgs(argv) {
  const options = {
    refresh: false,
    json: false,
    write: false,
    radar: DEFAULT_RADAR,
    outputDir: DEFAULT_OUTPUT_DIR
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--refresh") {
      options.refresh = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    const mappings = [
      ["--radar", "radar"],
      ["--output-dir", "outputDir"]
    ];
    let consumed = false;
    for (const [flag, key] of mappings) {
      const parsed = readFlagValue(argv, index, flag);
      if (!parsed.matched) continue;
      options[key] = parsed.value;
      index = parsed.nextIndex;
      consumed = true;
      break;
    }
    if (consumed) continue;
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.radar = resolve(REPO_ROOT, options.radar);
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function readJson(path) {
  if (!existsSync(path)) return { ok: false, error: `${repoRelative(path)} is missing`, value: null };
  try {
    return { ok: true, error: "", value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { ok: false, error: `${repoRelative(path)} is invalid JSON: ${error.message}`, value: null };
  }
}

function refreshRadar() {
  const result = spawnSync(process.execPath, ["scripts/ops/proactive_issue_radar.mjs", "--write", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    env: { ...process.env }
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      error: result.error?.message || clean(result.stderr) || `proactive radar exited ${result.status}`,
      value: null
    };
  }
  try {
    return { ok: true, error: "", value: JSON.parse(result.stdout || "null") };
  } catch (error) {
    return { ok: false, error: `proactive radar emitted invalid JSON: ${error.message}`, value: null };
  }
}

function timeValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function producerFreshnessFor(radarReport, producer) {
  const entries = Array.isArray(radarReport.sources?.producerArtifactFreshness)
    ? radarReport.sources.producerArtifactFreshness
    : [];
  return entries.find((entry) => entry.producer === producer) || null;
}

function consistencyForPacket(id, value, radarReport) {
  const sourceProducerMap = {
    "non-draft-prs-not-mergeable": "pr-stack",
    "large-stacked-draft-pr-backlog": "pr-stack"
  };
  const sourceProducer = sourceProducerMap[id] || "";
  if (!sourceProducer) return { ok: true, severity: "none", warnings: [] };
  const sourceFreshness = producerFreshnessFor(radarReport, sourceProducer);
  const packetSourceGeneratedAt = value?.source?.generatedAt || "";
  const packetSourceTime = timeValue(packetSourceGeneratedAt);
  const sourceNewestAt = sourceFreshness?.newestAt || "";
  const sourceNewestTime = timeValue(sourceNewestAt);
  const warnings = [];
  if (sourceFreshness?.stale) {
    warnings.push(`${sourceProducer} producer is stale; packet may not reflect current PR state.`);
  }
  if (packetSourceTime !== null && sourceNewestTime !== null && packetSourceTime + SOURCE_SKEW_TOLERANCE_MS < sourceNewestTime) {
    warnings.push(`packet source ${packetSourceGeneratedAt} is older than ${sourceProducer} latest ${sourceNewestAt}.`);
  }
  return {
    ok: warnings.length === 0,
    severity: warnings.length ? "medium" : "none",
    sourceProducer,
    packetSourceGeneratedAt,
    sourceNewestAt,
    warnings
  };
}

function packetArtifactFor(id, radarReport) {
  const map = {
    "non-draft-prs-not-mergeable": resolve(REPO_ROOT, "output", "ops", "pr-conflict-packets", "latest.json"),
    "large-stacked-draft-pr-backlog": resolve(REPO_ROOT, "output", "ops", "pr-backlog-decision-packets", "latest.json")
  };
  const path = map[id] || "";
  if (!path) return null;
  const artifact = readJson(path);
  if (!artifact.ok) {
    return {
      ok: false,
      path: repoRelative(path),
      status: "missing",
      packets: 0,
      generatedAt: "",
      error: artifact.error
    };
  }
  const value = artifact.value || {};
  const packetRows = Array.isArray(value.packets) ? value.packets : [];
  const packets = packetRows.length ? packetRows.length : Number(value.summary?.packets || 0);
  const approvalRequiredPackets = packetRows.filter((packet) => packet.approvalRequired).length;
  const allPacketsRequireApproval = packets > 0 && packetRows.length > 0 && approvalRequiredPackets === packetRows.length;
  const consistency = consistencyForPacket(id, value, radarReport);
  return {
    ok: true,
    path: repoRelative(path),
    status: value.status || "unknown",
    packets,
    approvalRequiredPackets,
    allPacketsRequireApproval,
    generatedAt: value.generatedAt || "",
    sourceGeneratedAt: value.source?.generatedAt || "",
    error: "",
    consistency
  };
}

function taskFromRecommendation(recommendation, finding, rank, radarReport) {
  const title = recommendation.title || finding?.title || "Investigate proactive radar finding";
  const commandMap = {
    "non-draft-prs-not-mergeable": "npm run ops:pr-conflict:packets",
    "large-stacked-draft-pr-backlog": "npm run ops:pr-backlog:packets",
    "stale-ops-producer-artifacts": "npm run ops:producer:refresh -- --execute --json",
    "stale-ops-artifacts": "npm run ops:report",
    "ops-scripts-without-make-targets": "npm run ops:command-manifest:check"
  };
  const id = finding?.id || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const packetArtifact = packetArtifactFor(id, radarReport);
  const packetReady = packetArtifact?.ok && packetArtifact.packets > 0 && packetArtifact.status === "action_needed" && packetArtifact.consistency?.ok !== false;
  const packetApprovalGate = packetReady && packetArtifact.allPacketsRequireApproval;
  const command = commandMap[id] || "";
  const priorityScore = { P0: 100, P1: 80, P2: 60, P3: 40 };
  const severityScore = { critical: 100, high: 80, medium: 60, low: 40 };
  const score = Math.max(
    priorityScore[recommendation.priority] || 0,
    severityScore[finding?.severity] || 0,
    10
  );
  return {
    rank,
    score,
    id,
    source: "proactive-radar-recommendation",
    title,
    type: recommendation.type || "ops",
    priority: recommendation.priority || "P2",
    effort: recommendation.effort || "",
    risk: recommendation.risk || "low",
    command: packetReady ? "" : command,
    commandSafetyClass: packetApprovalGate ? "human-approval-review" : packetReady ? "review-existing-packet" : command ? "read-only-report" : "manual-planning",
    problem: finding?.impact || finding?.title || "Radar reported an actionable operational issue.",
    evidence: finding?.evidence || "",
    proposedFix: packetReady
      ? `Review ${packetArtifact.path}; it already contains ${packetArtifact.packets} current packet(s) generated at ${packetArtifact.generatedAt || "unknown time"}${packetApprovalGate ? ", and every packet is approval-gated" : ""}.`
      : packetArtifact?.ok && packetArtifact.consistency?.ok === false && command
        ? `Refresh ${packetArtifact.path} with \`${command}\`; ${packetArtifact.consistency.warnings.join(" ")}`
      : finding?.safeNextStep || recommendation.acceptanceCriteria?.[0] || title,
    safetyNotes: finding?.rollback || "No destructive action is authorized by this selector.",
    packetArtifact,
    suggestedBranchName: recommendation.suggestedBranchName || "",
    suggestedPrTitle: recommendation.suggestedPrTitle || "",
    acceptanceCriteria: recommendation.acceptanceCriteria || []
  };
}

function semanticTasksFromRadar(radarReport) {
  const findings = Array.isArray(radarReport.findings) ? radarReport.findings : [];
  const recommendations = Array.isArray(radarReport.recommendations) ? radarReport.recommendations : [];
  const findingsByTitle = new Map(findings.map((finding) => [finding.title, finding]));
  const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
  return recommendations
    .map((recommendation, index) => {
      const id = recommendation.suggestedBranchName?.replace(/^codex\/ops-/, "") || "";
      const finding = findingsByTitle.get(recommendation.title)
        || findingsById.get(id)
        || findings[index]
        || null;
      return taskFromRecommendation(recommendation, finding, index + 1, radarReport);
    })
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .map((task, index) => ({ ...task, rank: index + 1 }));
}

function fallbackTasksFromRadar(radarReport) {
  const tasks = Array.isArray(radarReport.approvalFallbackTasks) ? radarReport.approvalFallbackTasks : [];
  return tasks.map((task, index) => ({
    rank: index + 1,
    score: task.score || 30,
    id: `approval-fallback-${index + 1}`,
    source: "proactive-radar-approval-fallback",
    title: task.title || "Refresh fallback ops evidence",
    type: "ops",
    priority: task.priority || "P3",
    effort: "S",
    risk: "low",
    command: task.command || "",
    commandSafetyClass: task.commandSafetyClass || (task.command ? "read-only-report" : "manual-planning"),
    problem: task.problem || "Primary radar findings are approval-gated.",
    evidence: task.evidence || "",
    proposedFix: task.proposedFix || task.title || "Refresh fallback evidence.",
    safetyNotes: task.safetyNotes || "No destructive action is authorized by this selector.",
    packetArtifact: null,
    suggestedBranchName: "",
    suggestedPrTitle: "",
    acceptanceCriteria: task.acceptanceCriteria || []
  }));
}

function buildReport(options) {
  const generatedAt = nowIso();
  const radar = options.refresh ? refreshRadar() : readJson(options.radar);
  const radarReport = radar.value || {};
  const allTasks = Array.isArray(radarReport.producerRefreshTasks) ? radarReport.producerRefreshTasks : [];
  const tasks = allTasks.filter((task) => !String(task.title || "").includes("next-slice-selector"));
  const nextProducerTask = radarReport.nextProducerRefreshTask || tasks[0] || null;
  const selectedProducerTask = nextProducerTask && String(nextProducerTask.title || "").includes("next-slice-selector") ? tasks[0] || null : nextProducerTask;
  const semanticTasks = semanticTasksFromRadar(radarReport);
  const fallbackTasks = fallbackTasksFromRadar(radarReport);
  const artifactConsistencyWarnings = semanticTasks
    .filter((task) => task.packetArtifact?.consistency?.ok === false)
    .map((task) => ({
      id: task.id,
      title: task.title,
      packetPath: task.packetArtifact.path,
      severity: task.packetArtifact.consistency.severity,
      warnings: task.packetArtifact.consistency.warnings,
      safeNextStep: task.command ? `Run ${task.command}` : "Refresh packet evidence before review."
    }));
  const approvalGates = semanticTasks
    .filter((task) => task.commandSafetyClass === "human-approval-review")
    .map((task) => ({
      id: task.id,
      title: task.title,
      packetPath: task.packetArtifact.path,
      packets: task.packetArtifact.packets,
      approvalRequiredPackets: task.packetArtifact.approvalRequiredPackets,
      safeNextStep: task.proposedFix
    }));
  const selectedTask = selectedProducerTask || fallbackTasks[0] || semanticTasks[0] || null;
  const actionableTasks = [...tasks, ...fallbackTasks, ...semanticTasks].filter((task) => task.command || !["human-approval-review", "review-existing-packet"].includes(task.commandSafetyClass));
  const staleProducerCount = Array.isArray(radarReport.sources?.producerArtifactFreshness)
    ? radarReport.sources.producerArtifactFreshness.filter((entry) => entry.stale).length
    : null;

  return {
    schema: "studio-brain.ops.next-slice-selector.v1",
    generatedAt,
    readOnly: true,
    status: radar.ok
      ? selectedTask
        ? selectedTask.commandSafetyClass === "human-approval-review" && !actionableTasks.length
          ? "blocked_on_approval"
          : "action_ready"
        : "ok"
      : "blocked",
    source: {
      refreshedRadar: options.refresh,
      radarPath: repoRelative(options.radar),
      radarOk: radar.ok,
      radarError: radar.error,
      radarGeneratedAt: radarReport.generatedAt || "",
      radarStatus: radarReport.status || "unknown"
    },
    ignoredSelfTasks: allTasks.length - tasks.length,
    nextTask: selectedTask,
    rankedPreview: [...tasks, ...fallbackTasks, ...semanticTasks].slice(0, 5),
    semanticTaskCount: semanticTasks.length,
    fallbackTaskCount: fallbackTasks.length,
    actionableTaskCount: actionableTasks.length,
    artifactConsistencyWarnings,
    approvalGates,
    staleProducerCount,
    safeNextStep: selectedTask
      ? selectedTask.proposedFix || selectedTask.title
      : radar.ok
        ? "No producer refresh or radar recommendation task is currently selected."
        : "Run npm run ops:proactive:radar, then rerun this selector.",
    rollback: "No rollback needed; selector writes only ignored output artifacts when --write is used."
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Studio Brain Next Slice Selector",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Status: ${report.status}`,
    `- Read-only: ${report.readOnly ? "yes" : "no"}`,
    `- Radar source: ${report.source.radarPath}`,
    `- Radar refreshed: ${report.source.refreshedRadar ? "yes" : "no"}`,
    `- Radar status: ${report.source.radarStatus}`,
    `- Stale producer count: ${report.staleProducerCount ?? "unknown"}`,
    `- Semantic radar tasks: ${report.semanticTaskCount ?? 0}`,
    `- Approval fallback tasks: ${report.fallbackTaskCount ?? 0}`,
    `- Actionable task count: ${report.actionableTaskCount ?? 0}`,
    `- Artifact consistency warnings: ${report.artifactConsistencyWarnings?.length ?? 0}`,
    `- Approval gates: ${report.approvalGates?.length ?? 0}`,
    `- Ignored selector self-tasks: ${report.ignoredSelfTasks}`,
    "",
    "## Next Task",
    ""
  ];
  if (!report.nextTask) {
    lines.push(`- ${report.safeNextStep}`);
  } else {
    lines.push(`- Title: ${report.nextTask.title}`);
    lines.push(`- Rank: ${report.nextTask.rank}`);
    lines.push(`- Score: ${report.nextTask.score}`);
    lines.push(`- Priority: ${report.nextTask.priority}`);
    lines.push(`- Command safety: ${report.nextTask.commandSafetyClass}`);
    if (report.nextTask.command) lines.push(`- Suggested command: \`${report.nextTask.command}\``);
    if (report.nextTask.packetArtifact?.path) {
      lines.push(`- Existing packet: ${report.nextTask.packetArtifact.path} (${report.nextTask.packetArtifact.status}; ${report.nextTask.packetArtifact.packets} packet(s); ${report.nextTask.packetArtifact.approvalRequiredPackets || 0} approval-gated)`);
    }
    lines.push(`- Problem: ${report.nextTask.problem}`);
    if (report.nextTask.evidence) lines.push(`- Evidence: ${report.nextTask.evidence}`);
    lines.push(`- Proposed fix: ${report.nextTask.proposedFix}`);
    lines.push(`- Safety notes: ${report.nextTask.safetyNotes}`);
  }
  lines.push("");
  lines.push("## Approval Gates");
  lines.push("");
  if (!report.approvalGates?.length) {
    lines.push("- No approval-gated packet reviews.");
  } else {
    for (const gate of report.approvalGates) {
      lines.push(`- ${gate.title}: ${gate.approvalRequiredPackets}/${gate.packets} packet(s) require approval. Packet: ${gate.packetPath}.`);
    }
  }
  lines.push("");
  lines.push("## Artifact Consistency Warnings");
  lines.push("");
  if (!report.artifactConsistencyWarnings?.length) {
    lines.push("- No artifact consistency warnings.");
  } else {
    for (const warning of report.artifactConsistencyWarnings) {
      lines.push(`- ${warning.title}: ${warning.warnings.join(" ")} Safe next step: ${warning.safeNextStep}.`);
    }
  }
  lines.push("");
  lines.push("## Ranked Preview");
  lines.push("");
  if (!report.rankedPreview.length) lines.push("- No ranked producer refresh or semantic radar tasks.");
  for (const task of report.rankedPreview) {
    lines.push(`- #${task.rank} score ${task.score}: ${task.title} (${task.commandSafetyClass})`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push(`- Safe next step: ${report.safeNextStep}`);
  lines.push(`- Rollback: ${report.rollback}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(report, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = resolve(outputDir, "latest.json");
  const markdownPath = resolve(outputDir, "latest.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return { json: repoRelative(jsonPath), markdown: repoRelative(markdownPath) };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = buildReport(options);
    if (options.write) report.paths = writeArtifacts(report, options.outputDir);
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  } catch (error) {
    process.stderr.write(`next_slice_selector: ${error.message}\n`);
    process.exit(1);
  }
}

main();
