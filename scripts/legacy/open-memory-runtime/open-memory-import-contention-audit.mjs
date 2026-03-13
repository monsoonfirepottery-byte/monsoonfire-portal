#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_REPORT_PATH = resolve(process.cwd(), "output", "open-memory", "import-contention-latest.json");

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim().toLowerCase();
    if (!key) continue;
    if (key.includes("=")) {
      const [rawKey, ...rest] = key.split("=");
      flags[rawKey.trim().toLowerCase()] = rest.join("=");
      continue;
    }
    const next = argv[i + 1];
    if (next && !String(next).startsWith("--")) {
      flags[key] = String(next);
      i += 1;
    } else {
      flags[key] = "true";
    }
  }
  return flags;
}

function readBool(flags, key, fallback = false) {
  const raw = String(flags[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readString(flags, key, fallback = "") {
  const raw = String(flags[key] ?? "").trim();
  return raw || fallback;
}

function readInt(flags, key, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function run(cmd) {
  return spawnSync("bash", ["-lc", cmd], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });
}

function parsePgrepOutput(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      const pid = Number.parseInt(match[1], 10);
      if (!Number.isFinite(pid) || pid <= 1) return null;
      const command = String(match[2] || "").trim();
      if (!command) return null;
      return { pid, command };
    })
    .filter((row) => row && row.pid !== process.pid);
}

function extractNamedArg(command, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const equals = command.match(new RegExp(`--${escaped}=([^\\s"']+)`, "i"));
  if (equals?.[1]) return String(equals[1]).trim();
  const spaced = command.match(new RegExp(`--${escaped}\\s+([^\\s"']+)`, "i"));
  if (spaced?.[1]) return String(spaced[1]).trim();
  return "";
}

function extractImportRunRoot(command) {
  const fromArgs = [
    extractNamedArg(command, "run-root"),
    extractNamedArg(command, "output-root"),
    extractNamedArg(command, "report"),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (fromArgs.length > 0) return fromArgs[0];
  const pathMatch = command.match(/\/imports\/mail\/runs\/[^\s"']+/i);
  if (pathMatch?.[0]) return String(pathMatch[0]).trim();
  return "";
}

function extractRunId(command) {
  return extractNamedArg(command, "run-id");
}

function classifyProcess(command) {
  const text = String(command || "");
  if (text.includes("mail-import-watchdog.sh")) return "watchdog";
  if (text.includes("open-memory-ingest-guard.mjs")) return "guard";
  if (text.includes("open-memory-ops-supervisor.mjs")) return "supervisor";
  if (text.includes("open-memory-context-experimental-index.mjs")) return "experimental-index";
  if (text.includes("open-memory-context-experimental-capture.mjs")) return "experimental-capture";
  if (
    text.includes("open-memory-mail-import.mjs")
    || text.includes("mail-office365-import-ssh.mjs")
    || text.includes("mail-office365-deep-import.mjs")
    || text.includes("mail-office-import-ssh.mjs")
    || text.includes("run-office-imap-import.mjs")
    || text.includes("run-office-imap-import")
    || text.includes("mail:office:import")
  ) {
    return "importer";
  }
  return "other";
}

function severityRank(status) {
  if (status === "fail") return 3;
  if (status === "warn") return 2;
  return 1;
}

function pickWorseStatus(current, next) {
  return severityRank(next) > severityRank(current) ? next : current;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (readBool(flags, "help", false)) {
    process.stdout.write(
      [
        "Open Memory Import Contention Audit",
        "",
        "Usage:",
        "  node ./scripts/open-memory-import-contention-audit.mjs --json true",
        "",
        "Options:",
        "  --strict true|false                     Exit non-zero on warn/fail (default: false)",
        "  --json true|false                       Emit JSON output (default: true)",
        "  --report <path|false>                   Optional report output path",
        "  --max-importers <n>                     Soft cap for concurrent importer processes (default: 40)",
        "  --max-watchdogs-per-root <n>            Soft cap for watchdogs per run root (default: 1)",
        "  --max-guards <n>                        Soft cap for ingest guard processes (default: 1)",
        "  --max-supervisors <n>                   Soft cap for supervisor processes (default: 1)",
      ].join("\n") + "\n"
    );
    return;
  }

  const strict = readBool(flags, "strict", false);
  const outputJson = readBool(flags, "json", true);
  const reportArg = readString(flags, "report", DEFAULT_REPORT_PATH);
  const reportEnabled = !["false", "0", "no", "off"].includes(String(reportArg).toLowerCase());
  const reportPath = reportEnabled ? resolve(process.cwd(), reportArg || DEFAULT_REPORT_PATH) : "";
  const maxImporters = readInt(flags, "max-importers", 40, { min: 1, max: 200 });
  const maxWatchdogsPerRoot = readInt(flags, "max-watchdogs-per-root", 1, { min: 1, max: 200 });
  const maxGuards = readInt(flags, "max-guards", 1, { min: 1, max: 50 });
  const maxSupervisors = readInt(flags, "max-supervisors", 1, { min: 1, max: 50 });

  const pattern = [
    "open-memory-mail-import\\.mjs",
    "mail-office365-import-ssh\\.mjs",
    "mail-office365-deep-import\\.mjs",
    "mail-office-import-ssh\\.mjs",
    "run-office-imap-import\\.mjs",
    "mail-import-watchdog\\.sh",
    "open-memory-ingest-guard\\.mjs",
    "open-memory-ops-supervisor\\.mjs",
    "open-memory-context-experimental-index\\.mjs",
    "open-memory-context-experimental-capture\\.mjs",
  ].join("|");

  const pgrep = run(`pgrep -af '${pattern}'`);
  const rows = parsePgrepOutput(pgrep.stdout)
    .filter((row) => !/\bpgrep -af\b/.test(row.command))
    .map((row) => {
      const role = classifyProcess(row.command);
      return {
        ...row,
        role,
        runId: extractRunId(row.command) || null,
        runRoot: extractImportRunRoot(row.command) || null,
      };
    })
    .filter((row) => {
      if (row.role === "watchdog") return true;
      return /^node\b/i.test(String(row.command || "").trim());
    });

  const importers = rows.filter((row) => row.role === "importer");
  const watchdogs = rows.filter((row) => row.role === "watchdog");
  const guards = rows.filter((row) => row.role === "guard");
  const supervisors = rows.filter((row) => row.role === "supervisor");
  const experimentalIndexers = rows.filter((row) => row.role === "experimental-index");
  const experimentalCaptures = rows.filter((row) => row.role === "experimental-capture");

  const watchdogByRootMap = new Map();
  for (const row of watchdogs) {
    const key = String(row.runRoot || "<unspecified>");
    const list = watchdogByRootMap.get(key) || [];
    list.push(row);
    watchdogByRootMap.set(key, list);
  }
  const watchdogByRoot = [...watchdogByRootMap.entries()].map(([runRoot, list]) => ({
    runRoot,
    count: list.length,
    pids: list.map((row) => row.pid),
  }));

  let status = "pass";
  const findings = [];
  const recommendations = [];

  if (importers.length > maxImporters) {
    const severity = importers.length >= Math.max(2, maxImporters + 2) ? "fail" : "warn";
    status = pickWorseStatus(status, severity);
    findings.push({
      severity,
      code: "importer_concurrency_high",
      message: `Detected ${importers.length} importer processes (limit ${maxImporters}).`,
      pids: importers.map((row) => row.pid),
    });
    recommendations.push(
      "Reduce importer concurrency and keep one primary ingest stream while indexing catches up."
    );
  }

  if (guards.length > maxGuards) {
    status = pickWorseStatus(status, "fail");
    findings.push({
      severity: "fail",
      code: "multiple_ingest_guards",
      message: `Detected ${guards.length} ingest guard processes (limit ${maxGuards}).`,
      pids: guards.map((row) => row.pid),
    });
    recommendations.push("Keep exactly one ingest guard. Recycle the Open Memory stack to clear duplicate guard workers.");
  }

  if (supervisors.length > maxSupervisors) {
    status = pickWorseStatus(status, "warn");
    findings.push({
      severity: "warn",
      code: "multiple_supervisors",
      message: `Detected ${supervisors.length} ops supervisor processes (limit ${maxSupervisors}).`,
      pids: supervisors.map((row) => row.pid),
    });
    recommendations.push("Keep one supervisor watcher to avoid conflicting profile remediations.");
  }

  for (const root of watchdogByRoot) {
    if (root.count <= maxWatchdogsPerRoot) continue;
    status = pickWorseStatus(status, root.count >= maxWatchdogsPerRoot + 2 ? "fail" : "warn");
    findings.push({
      severity: root.count >= maxWatchdogsPerRoot + 2 ? "fail" : "warn",
      code: "watchdog_duplication",
      message: `Run root ${root.runRoot} has ${root.count} watchdogs (limit ${maxWatchdogsPerRoot}).`,
      pids: root.pids,
    });
    recommendations.push("Deduplicate watchdog sessions per run root; duplicate restarts can thrash import throughput.");
  }

  if (experimentalIndexers.length > 1) {
    status = pickWorseStatus(status, "warn");
    findings.push({
      severity: "warn",
      code: "parallel_experimental_indexers",
      message: `Detected ${experimentalIndexers.length} parallel experimental context index processes.`,
      pids: experimentalIndexers.map((row) => row.pid),
    });
    recommendations.push(
      "Prefer one experimental context index worker during ingest storms to reduce query contention."
    );
  }

  if (experimentalCaptures.length > 1) {
    status = pickWorseStatus(status, "warn");
    findings.push({
      severity: "warn",
      code: "parallel_experimental_captures",
      message: `Detected ${experimentalCaptures.length} parallel experimental context capture processes.`,
      pids: experimentalCaptures.map((row) => row.pid),
    });
    recommendations.push("Limit synthetic capture writers to one process to avoid duplicate context rows.");
  }

  if (findings.length === 0) {
    recommendations.push("No obvious contention signatures detected. Keep current topology and continue monitoring.");
  }

  const report = {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    status,
    limits: {
      maxImporters,
      maxWatchdogsPerRoot,
      maxGuards,
      maxSupervisors,
    },
    counts: {
      total: rows.length,
      importers: importers.length,
      watchdogs: watchdogs.length,
      guards: guards.length,
      supervisors: supervisors.length,
      experimentalIndexers: experimentalIndexers.length,
      experimentalCaptures: experimentalCaptures.length,
    },
    watchdogByRoot,
    findings,
    recommendations: Array.from(new Set(recommendations)),
    processes: rows.map((row) => ({
      pid: row.pid,
      role: row.role,
      runId: row.runId,
      runRoot: row.runRoot,
      command: row.command,
    })),
  };

  if (reportEnabled) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (outputJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const lines = [];
    lines.push("Open Memory Import Contention Audit");
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push(`Status: ${report.status}`);
    lines.push(
      `Counts: importers=${report.counts.importers} watchdogs=${report.counts.watchdogs} guards=${report.counts.guards} supervisors=${report.counts.supervisors}`
    );
    if (report.findings.length > 0) {
      lines.push("Findings:");
      for (const finding of report.findings) {
        lines.push(`- [${String(finding.severity).toUpperCase()}] ${finding.message}`);
      }
    }
    lines.push("Recommendations:");
    for (const recommendation of report.recommendations) {
      lines.push(`- ${recommendation}`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (strict && report.status !== "pass") {
    process.exit(1);
  }
}

main();
