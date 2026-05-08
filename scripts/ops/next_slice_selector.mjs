#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_RADAR = resolve(REPO_ROOT, "output", "ops", "proactive-radar", "latest.json");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "next-slice-selector");

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

function buildReport(options) {
  const generatedAt = nowIso();
  const radar = options.refresh ? refreshRadar() : readJson(options.radar);
  const radarReport = radar.value || {};
  const allTasks = Array.isArray(radarReport.producerRefreshTasks) ? radarReport.producerRefreshTasks : [];
  const tasks = allTasks.filter((task) => !String(task.title || "").includes("next-slice-selector"));
  const nextTask = radarReport.nextProducerRefreshTask || tasks[0] || null;
  const selectedTask = nextTask && String(nextTask.title || "").includes("next-slice-selector") ? tasks[0] || null : nextTask;
  const staleProducerCount = Array.isArray(radarReport.sources?.producerArtifactFreshness)
    ? radarReport.sources.producerArtifactFreshness.filter((entry) => entry.stale).length
    : null;

  return {
    schema: "studio-brain.ops.next-slice-selector.v1",
    generatedAt,
    readOnly: true,
    status: radar.ok ? nextTask ? "action_ready" : "ok" : "blocked",
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
    rankedPreview: tasks.slice(0, 5),
    staleProducerCount,
    safeNextStep: selectedTask
      ? selectedTask.proposedFix || selectedTask.title
      : radar.ok
        ? "No producer refresh task is currently selected."
        : "Run make ops-proactive-radar, then rerun this selector.",
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
    lines.push(`- Problem: ${report.nextTask.problem}`);
    lines.push(`- Proposed fix: ${report.nextTask.proposedFix}`);
    lines.push(`- Safety notes: ${report.nextTask.safetyNotes}`);
  }
  lines.push("");
  lines.push("## Ranked Preview");
  lines.push("");
  if (!report.rankedPreview.length) lines.push("- No ranked producer refresh tasks.");
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
