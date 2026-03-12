#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REPORT_DIR,
  REPO_ROOT,
  isQuotaFailureText,
  listCodexProcReports,
} from "./lib/codex-automation-control.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const defaultOutputDir = resolve(REPO_ROOT, "output", "qa");
const defaultJsonPath = resolve(defaultOutputDir, "codex-automation-audit.json");
const defaultMarkdownPath = resolve(defaultOutputDir, "codex-automation-audit.md");
const defaultToolcallPath = resolve(REPO_ROOT, ".codex", "toolcalls.ndjson");
const defaultSystemdDir = resolve(os.homedir(), ".config", "systemd", "user");

function printUsage() {
  process.stdout.write(
    [
      "Codex automation audit",
      "",
      "Usage:",
      "  node ./scripts/codex-automation-audit.mjs [options]",
      "",
      "Options:",
      "  --report-dir <path>         Codex proc report directory",
      "  --toolcalls <path>          Toolcall NDJSON path",
      "  --systemd-dir <path>        User systemd directory",
      "  --report-json <path>        Output JSON report",
      "  --report-markdown <path>    Output markdown report",
      "  --write                     Write artifacts",
      "  --json                      Print JSON",
      "  --help                      Show help",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = {
    reportDir: DEFAULT_REPORT_DIR,
    toolcallPath: defaultToolcallPath,
    systemdDir: defaultSystemdDir,
    reportJsonPath: defaultJsonPath,
    reportMarkdownPath: defaultMarkdownPath,
    writeArtifacts: false,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--write") {
      options.writeArtifacts = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--report-dir") {
      options.reportDir = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--toolcalls") {
      options.toolcallPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--systemd-dir") {
      options.systemdDir = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--report-json") {
      options.reportJsonPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--report-markdown") {
      options.reportMarkdownPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
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

function scanRepoForAutomationCallers() {
  const ignoredFiles = new Set(["scripts/codex-automation-audit.mjs", "scripts/lib/codex-automation-control.mjs"]);
  const rgArgs = [
    "-n",
    "spawnSync\\(\"codex\"|/v1/responses|OPENAI_API_KEY|gpt-5\\.3-codex-spark|intent-codex-proc\\.mjs|codex-shell\\.mjs",
    "scripts",
    ".github",
    "package.json",
  ];

  let output = "";
  try {
    output = execFileSync("rg", rgArgs, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    output = error?.stdout ? String(error.stdout) : "";
  }

  const rows = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!match) continue;
    const [, filePath, lineNumberRaw, snippetRaw] = match;
    if (ignoredFiles.has(filePath)) continue;
    const snippet = snippetRaw.trim();
    const signal =
      /spawnSync\("codex"/.test(snippet) ? "codex-spawn" :
      /\/v1\/responses/.test(snippet) ? "openai-responses" :
      /gpt-5\.3-codex-spark/.test(snippet) ? "spark-default" :
      /intent-codex-proc\.mjs/.test(snippet) ? "intent-proc-launch" :
      /codex-shell\.mjs/.test(snippet) ? "codex-shell-launch" :
      /OPENAI_API_KEY/.test(snippet) ? "openai-key-path" :
      "automation-signal";
    rows.push({
      file: filePath,
      line: Number(lineNumberRaw),
      signal,
      snippet,
    });
  }
  return rows;
}

function inspectSystemdUnits(systemdDir) {
  const absoluteDir = resolve(systemdDir);
  if (!existsSync(absoluteDir)) {
    return {
      available: false,
      path: absoluteDir,
      units: [],
    };
  }

  const units = [];
  for (const name of readdirSync(absoluteDir).filter((entry) => entry.endsWith(".service") || entry.endsWith(".timer")).sort()) {
    const absolutePath = resolve(absoluteDir, name);
    const content = readFileSync(absolutePath, "utf8");
    if (!/(overnight-automation-loop\.sh|intent-codex-proc|codex-shell|gpt-5\.3-codex-spark|friction-sweep)/i.test(content)) {
      continue;
    }

    const environment = content
      .split(/\r?\n/)
      .filter((line) => line.startsWith("Environment="))
      .map((line) => line.slice("Environment=".length));

    let recommendedKillSwitch = "";
    if (name === "monsoonfire-overnight.service" || content.includes("overnight-automation-loop.sh")) {
      recommendedKillSwitch = "systemctl --user disable --now monsoonfire-overnight.timer monsoonfire-overnight.service";
    } else if (name === "monsoonfire-daily.service") {
      recommendedKillSwitch = "systemctl --user disable --now monsoonfire-daily.timer";
    }

    units.push({
      name,
      path: absolutePath,
      execStart:
        content
          .split(/\r?\n/)
          .find((line) => line.startsWith("ExecStart="))
          ?.slice("ExecStart=".length) || "",
      environment,
      referencesSpark: /gpt-5\.3-codex-spark/.test(content),
      referencesCodexProc: /intent-codex-proc|overnight-automation-loop\.sh/.test(content),
      recommendedKillSwitch,
    });
  }

  return {
    available: true,
    path: absoluteDir,
    units,
  };
}

function summarizeReports(reportDir) {
  const reports = listCodexProcReports(reportDir);
  const grouped = new Map();

  for (const report of reports) {
    const launcher = String(report?.automation?.launcher || report?.launcher || "intent-codex-proc").trim() || "intent-codex-proc";
    const model = String(report?.model || "(default)").trim() || "(default)";
    const key = `${launcher}::${model}`;
    const entry =
      grouped.get(key) ||
      {
        launcher,
        model,
        reportCount: 0,
        quotaFailures: 0,
        lastSeen: null,
        days: {},
        sampleReports: [],
        recommendedKillSwitch:
          launcher === "monsoonfire-overnight.service" || launcher === "intent-codex-proc"
            ? "systemctl --user disable --now monsoonfire-overnight.timer monsoonfire-overnight.service"
            : "",
      };

    entry.reportCount += 1;
    const stamp = new Date(report.generatedAt || Date.now()).toISOString();
    entry.lastSeen = !entry.lastSeen || stamp > entry.lastSeen ? stamp : entry.lastSeen;
    const day = stamp.slice(0, 10);
    entry.days[day] = (entry.days[day] || 0) + 1;
    const combined = `${report?.result?.stderrPreview || ""}\n${report?.result?.stdoutPreview || ""}`;
    if (isQuotaFailureText(combined)) {
      entry.quotaFailures += 1;
    }
    if (entry.sampleReports.length < 3) {
      entry.sampleReports.push({
        path: report._relativePath,
        status: report.status,
        generatedAt: stamp,
      });
    }

    grouped.set(key, entry);
  }

  return Array.from(grouped.values()).sort((left, right) => {
    if (right.reportCount !== left.reportCount) return right.reportCount - left.reportCount;
    return String(right.lastSeen || "").localeCompare(String(left.lastSeen || ""));
  });
}

function summarizeToolcalls(toolcallPath) {
  const entries = readJsonl(toolcallPath);
  const totals = new Map();
  let entriesWithModel = 0;

  for (const entry of entries) {
    const tool = String(entry?.tool || "unknown");
    totals.set(tool, (totals.get(tool) || 0) + 1);
    if (String(entry?.model || "").trim()) {
      entriesWithModel += 1;
    }
  }

  const topTools = Array.from(totals.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);

  return {
    path: relative(REPO_ROOT, toolcallPath).replaceAll("\\", "/"),
    entryCount: entries.length,
    entriesWithModel,
    modelCoverage: entries.length > 0 ? Number((entriesWithModel / entries.length).toFixed(4)) : 0,
    topTools,
  };
}

function buildMarkdown(report) {
  const lines = [
    "# Codex Automation Audit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Top automated callers",
  ];

  if (report.reportSummary.length === 0) {
    lines.push("", "- No codex proc reports found.");
  } else {
    for (const entry of report.reportSummary.slice(0, 8)) {
      lines.push(
        `- ${entry.launcher} :: ${entry.model} :: reports=${entry.reportCount} quotaFailures=${entry.quotaFailures} lastSeen=${entry.lastSeen}${
          entry.recommendedKillSwitch ? ` :: kill=${entry.recommendedKillSwitch}` : ""
        }`
      );
    }
  }

  lines.push("", "## Systemd units");
  if (!report.systemd.available || report.systemd.units.length === 0) {
    lines.push("", "- No matching user systemd units found.");
  } else {
    for (const unit of report.systemd.units) {
      lines.push(
        `- ${unit.name} :: spark=${unit.referencesSpark} codexProc=${unit.referencesCodexProc}${
          unit.recommendedKillSwitch ? ` :: kill=${unit.recommendedKillSwitch}` : ""
        }`
      );
    }
  }

  lines.push("", "## Repo caller scan");
  if (report.repoSignals.length === 0) {
    lines.push("", "- No Codex/OpenAI automation callsites found.");
  } else {
    for (const signal of report.repoSignals.slice(0, 12)) {
      lines.push(`- ${signal.file}:${signal.line} :: ${signal.signal} :: ${signal.snippet}`);
    }
  }

  lines.push("", "## Toolcall telemetry", "");
  lines.push(
    `- entries=${report.toolcalls.entryCount} modelCoverage=${report.toolcalls.modelCoverage} path=${report.toolcalls.path}`
  );

  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = {
    schema: "codex-automation-audit.v1",
    generatedAt: new Date().toISOString(),
    reportDir: options.reportDir,
    repoSignals: scanRepoForAutomationCallers(),
    reportSummary: summarizeReports(options.reportDir),
    toolcalls: summarizeToolcalls(options.toolcallPath),
    systemd: inspectSystemdUnits(options.systemdDir),
  };

  if (options.writeArtifacts) {
    mkdirSync(dirname(options.reportJsonPath), { recursive: true });
    mkdirSync(dirname(options.reportMarkdownPath), { recursive: true });
    writeFileSync(options.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    writeFileSync(options.reportMarkdownPath, buildMarkdown(report), "utf8");
  }

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`codex-automation-audit reportSummary=${report.reportSummary.length}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`codex-automation-audit failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
