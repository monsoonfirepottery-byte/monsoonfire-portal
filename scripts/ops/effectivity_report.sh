#!/usr/bin/env bash
set -u

# Read-only Studio Brain ops effectivity report.
# Writes timestamped Markdown and JSON artifacts under output/ops/effectivity by
# default. It avoids environment dumps and degrades to warnings when local/live
# dependencies are unavailable.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="${REPO_ROOT:-${DEFAULT_REPO_ROOT}}"
OUTPUT_DIR="${OUTPUT_DIR:-${REPO_ROOT}/output/ops/effectivity}"
RUN_ID=""
JSON_ONLY=0
WRITE=1
MISSION_CONTROL_URL="${MISSION_CONTROL_URL:-http://127.0.0.1:14100}"
STUDIO_BRAIN_URL="${STUDIO_BRAIN_URL:-http://192.168.1.226:8787}"

usage() {
  cat <<'EOF'
Studio Brain ops effectivity report

Usage:
  bash scripts/ops/effectivity_report.sh [--json] [--output-dir <path>] [--run-id <id>]

Options:
  --json                 Print JSON summary to stdout.
  --output-dir <path>    Artifact directory. Default: output/ops/effectivity.
  --run-id <id>          Stable run id. Default: effectivity timestamp.
  --no-write             Do not write artifacts; still prints a summary.
  -h, --help             Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --json)
      JSON_ONLY=1
      shift
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --output-dir=*)
      OUTPUT_DIR="${1#*=}"
      shift
      ;;
    --run-id)
      RUN_ID="$2"
      shift 2
      ;;
    --run-id=*)
      RUN_ID="${1#*=}"
      shift
      ;;
    --no-write)
      WRITE=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${RUN_ID:-effectivity-${timestamp}}"
OUTPUT_DIR="$(cd "${REPO_ROOT}" && mkdir -p "${OUTPUT_DIR}" && cd "${OUTPUT_DIR}" && pwd)"
JSON_PATH="${OUTPUT_DIR}/${RUN_ID}.json"
MARKDOWN_PATH="${OUTPUT_DIR}/${RUN_ID}.md"

if ! command -v node >/dev/null 2>&1; then
  printf 'node is required to render the effectivity report JSON.\n' >&2
  exit 1
fi

node - "${REPO_ROOT}" "${RUN_ID}" "${JSON_PATH}" "${MARKDOWN_PATH}" "${WRITE}" "${MISSION_CONTROL_URL}" "${STUDIO_BRAIN_URL}" "${JSON_ONLY}" <<'NODE'
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, relative, resolve } = require("node:path");

const repoRoot = process.argv[2];
const runId = process.argv[3];
const jsonPath = process.argv[4];
const markdownPath = process.argv[5];
const shouldWrite = process.argv[6] !== "0";
const missionControlUrl = process.argv[7];
const studioBrainUrl = process.argv[8];
const printJson = process.argv[9] === "1";

function nowIso() {
  return new Date().toISOString();
}

function rel(path) {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

function clean(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function commandExists(command) {
  const probe = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [command] : ["-v", command], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform !== "win32",
  });
  return probe.status === 0;
}

function runCommand(id, command, args, options = {}) {
  const useShell = process.platform === "win32" && command === "npm";
  const executable = useShell ? "npm" : command;
  const startedAt = nowIso();
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: options.timeoutMs || 20000,
    stdio: ["ignore", "pipe", "pipe"],
    shell: useShell,
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
  });
  return {
    id,
    command: [command, ...args].join(" "),
    startedAt,
    completedAt: nowIso(),
    ok: result.status === 0,
    status: result.status,
    signal: result.signal || "",
    skipped: false,
    stdout: clean(result.stdout).slice(0, options.maxOutput || 12000),
    stderr: clean(result.stderr).slice(0, 1200),
    error: result.error ? clean(result.error.message) : "",
  };
}

function skippedCommand(id, reason) {
  return {
    id,
    command: "",
    startedAt: nowIso(),
    completedAt: nowIso(),
    ok: false,
    status: null,
    signal: "",
    skipped: true,
    stdout: "",
    stderr: "",
    error: reason,
  };
}

function httpProbe(id, url) {
  if (!commandExists("curl")) return skippedCommand(id, "curl unavailable");
  return runCommand(id, "curl", ["-fsS", "--max-time", "5", url], { timeoutMs: 8000, maxOutput: 4000 });
}

function hasNpmScript(name) {
  const pkg = readJson(resolve(repoRoot, "package.json"));
  return Boolean(pkg?.scripts?.[name]);
}

function parseJsonFromOutput(commandResult) {
  if (!commandResult?.stdout) return null;
  const text = commandResult.stdout;
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function parseKeyValueOutput(commandResult) {
  const fields = {};
  const text = commandResult?.stdout || "";
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (match) fields[match[1]] = clean(match[2]);
  }
  const keys = ["status", "reason", "evidence_root", "safe_next_step", "run_dir", "run"];
  const pattern = new RegExp(`(?:^|\\s)(${keys.join("|")}):\\s*([\\s\\S]*?)(?=\\s(?:${keys.join("|")}):|$)`, "g");
  for (const match of text.matchAll(pattern)) {
    fields[match[1]] = clean(match[2]);
  }
  return fields;
}

function fileRef(label, path, maxAgeMinutes = 24 * 60) {
  const abs = resolve(repoRoot, path);
  const exists = existsSync(abs);
  const parsed = exists ? readJson(abs) : null;
  const generatedAt = parsed?.generatedAt || parsed?.completedAt || parsed?.finishedAt || "";
  const ageMinutes = Number.isFinite(Date.parse(generatedAt))
    ? Math.max(0, Math.round((Date.now() - Date.parse(generatedAt)) / 60000))
    : null;
  return {
    label,
    path,
    exists,
    status: clean(parsed?.status || parsed?.overallStatus || parsed?.candidateStatus || ""),
    generatedAt,
    ageMinutes,
    stale: !exists || ageMinutes === null || ageMinutes > maxAgeMinutes,
  };
}

function statusFromCommand(commandResult) {
  if (commandResult.skipped) return "unavailable";
  return commandResult.ok ? "pass" : "warn";
}

function privilegedEvidenceSection(commandResult) {
  const parsed = parseJsonFromOutput(commandResult);
  const fields = parseKeyValueOutput(commandResult);
  const rawStatus = clean(fields.status || parsed?.status || "");
  const absent = commandResult.skipped
    || rawStatus === "unavailable"
    || rawStatus === "missing"
    || rawStatus === "missing_summary"
    || /no privileged evidence run was found|privileged evidence directory is not readable/i.test(commandResult.stdout || commandResult.error || "");

  if (absent) {
    return {
      status: "sudo_unavailable",
      commandStatus: statusFromCommand(commandResult),
      evidenceRoot: clean(fields.evidence_root || ""),
      runDir: clean(fields.run_dir || ""),
      generatedAt: "",
      summaryPresent: false,
      safeNextStep: clean(fields.safe_next_step || "run the approval-gated collector or install the root-owned timer"),
      note: "Privileged host capture evidence is absent; no sudo attempt was made by this report.",
    };
  }

  return {
    status: parsed ? "pass" : statusFromCommand(commandResult),
    commandStatus: statusFromCommand(commandResult),
    evidenceRoot: clean(fields.evidence_root || parsed?.evidenceRoot || ""),
    runDir: clean(fields.run_dir || parsed?.runDir || ""),
    generatedAt: clean(parsed?.generatedAt || parsed?.completedAt || parsed?.createdAt || ""),
    summaryPresent: Boolean(parsed),
    safeNextStep: "",
    note: parsed ? "Latest privileged evidence summary was readable." : "Privileged evidence reader returned output but no JSON summary was parsed.",
  };
}

function buildSections(commands, refs) {
  const idleParsed = parseJsonFromOutput(commands.idleWorkerAudit);
  const harnessParsed = parseJsonFromOutput(commands.harnessLearn);
  const backupText = commands.backupEvidence.stdout || "";
  const failedUnitsText = commands.failedUnits.stdout || "";
  const studioHealth = parseJsonFromOutput(commands.studioHealth);
  const missionHealth = parseJsonFromOutput(commands.missionHealth);

  const backupGaps = [
    /postgres dump artifacts[\s\S]*?status: (missing_directory|no_matching_files_or_permission_denied)/i.test(backupText) ? "PostgreSQL dump artifacts not proven" : "",
    /redis backup artifacts[\s\S]*?status: (missing_directory|no_matching_files_or_permission_denied)/i.test(backupText) ? "Redis backup artifacts not proven" : "",
    /minio backup artifacts[\s\S]*?status: (missing_directory|no_matching_files_or_permission_denied)/i.test(backupText) ? "MinIO backup artifacts not proven" : "",
  ].filter(Boolean);

  const trueFailedUnits = [...failedUnitsText.matchAll(/failed_requires_triage/g)].length;
  const missingTickets = Number(harnessParsed?.summary?.missingTickets ?? harnessParsed?.missingTickets ?? 0);
  const openTickets = Number(harnessParsed?.summary?.openTickets ?? harnessParsed?.openTickets ?? 0);
  const idleMissingArtifact = (Array.isArray(idleParsed?.findings) ? idleParsed.findings : []).some(
    (finding) => clean(finding?.code) === "missing-idle-worker-artifacts",
  );
  const idleStatus = idleMissingArtifact
    ? "unavailable"
    : clean(idleParsed?.status || idleParsed?.health?.current?.status || refs.idleAudit.status || "");

  return {
    live: {
      status: commands.studioHealth.ok || commands.missionHealth.ok ? "pass" : "warn",
      studioBrain: {
        url: `${studioBrainUrl}/healthz`,
        commandStatus: statusFromCommand(commands.studioHealth),
        ok: Boolean(studioHealth?.ok) || commands.studioHealth.ok,
      },
      missionControl: {
        url: `${missionControlUrl}/api/mission-control/health`,
        commandStatus: statusFromCommand(commands.missionHealth),
        ok: Boolean(missionHealth?.ok) || commands.missionHealth.ok,
        storage: clean(missionHealth?.storage || ""),
      },
    },
    idleWorker: {
      status: idleStatus || statusFromCommand(commands.idleWorkerAudit),
      score: idleParsed?.score ?? idleParsed?.completeScore ?? null,
      current: idleParsed?.health?.current || null,
      history: idleParsed?.health?.history || null,
      findings: idleParsed?.findings || [],
      commandStatus: statusFromCommand(commands.idleWorkerAudit),
    },
    harness: {
      status: commands.harnessLearn.skipped ? "unavailable" : missingTickets === 0 && commands.harnessLearn.ok ? "pass" : "warn",
      missingTickets,
      openTickets,
      commandStatus: statusFromCommand(commands.harnessLearn),
      parsed: harnessParsed ? true : false,
    },
    backup: {
      status: backupGaps.length === 0 && commands.backupEvidence.ok ? "pass" : "warn",
      commandStatus: statusFromCommand(commands.backupEvidence),
      gaps: backupGaps,
    },
    failedUnits: {
      status: trueFailedUnits === 0 && commands.failedUnits.ok ? "pass" : "warn",
      commandStatus: statusFromCommand(commands.failedUnits),
      trueFailedUnits,
    },
    privilegedEvidence: privilegedEvidenceSection(commands.privilegedEvidence),
  };
}

function rollupStatus(sections) {
  const statuses = [
    sections.live.status,
    sections.idleWorker.status,
    sections.harness.status,
    sections.backup.status,
    sections.failedUnits.status,
    sections.privilegedEvidence.status,
  ].map((status) => clean(status).toLowerCase());
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn") || statuses.includes("unavailable") || statuses.includes("sudo_unavailable")) return "warn";
  return "pass";
}

function renderMarkdown(report) {
  const lines = [
    "# Studio Brain Ops Effectivity Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Run ID: ${report.runId}`,
    `Status: ${report.status}`,
    "Scope: read-only metadata report; unavailable live dependencies are warnings, not hard failures.",
    "",
    "## Summary",
    "",
    `- Live health: ${report.sections.live.status}`,
    `- Idle-worker effectivity: ${report.sections.idleWorker.status}${report.sections.idleWorker.score === null ? "" : `, score ${report.sections.idleWorker.score}`}`,
    `- Mission Control harness coverage: ${report.sections.harness.status}, missing tickets ${report.sections.harness.missingTickets}, open tickets ${report.sections.harness.openTickets}`,
    `- Backup confidence: ${report.sections.backup.status}`,
    `- Failed-unit classifier: ${report.sections.failedUnits.status}, true failed units ${report.sections.failedUnits.trueFailedUnits}`,
    `- Privileged capture: ${report.sections.privilegedEvidence.status}`,
    "",
    "## Operator Summary",
    "",
    `- Overall effectivity is ${report.status}; warnings and unavailable dependencies are surfaced as follow-up work, not hidden.`,
    `- The latest report artifacts are timestamped under ${rel(dirname(jsonPath))}; this path is ignored by git.`,
    `- Privileged evidence status is ${report.sections.privilegedEvidence.status}, so host-only reads remain approval-gated when absent.`,
    "",
    "## Evidence",
    "",
  ];
  for (const ref of Object.values(report.sources)) {
    lines.push(`- ${ref.label}: ${ref.exists ? "present" : "missing"}${ref.status ? `, status ${ref.status}` : ""}${ref.generatedAt ? `, generated ${ref.generatedAt}` : ""}`);
  }
  lines.push("", "## Backup Gaps", "");
  if (report.sections.backup.gaps.length === 0) {
    lines.push("- None detected by this report.");
  } else {
    for (const gap of report.sections.backup.gaps) lines.push(`- ${gap}`);
  }
  lines.push("", "## Privileged Capture", "");
  lines.push(`- Status: ${report.sections.privilegedEvidence.status}`);
  if (report.sections.privilegedEvidence.generatedAt) {
    lines.push(`- Generated: ${report.sections.privilegedEvidence.generatedAt}`);
  }
  if (report.sections.privilegedEvidence.evidenceRoot) {
    lines.push(`- Evidence root: ${report.sections.privilegedEvidence.evidenceRoot}`);
  }
  if (report.sections.privilegedEvidence.runDir) {
    lines.push(`- Run dir: ${report.sections.privilegedEvidence.runDir}`);
  }
  lines.push(`- Note: ${report.sections.privilegedEvidence.note}`);
  if (report.sections.privilegedEvidence.safeNextStep) {
    lines.push(`- Safe next step: ${report.sections.privilegedEvidence.safeNextStep}`);
  }
  lines.push("", "## Commands", "");
  for (const command of Object.values(report.commands)) {
    lines.push(`- ${command.id}: ${command.skipped ? "skipped" : command.ok ? "ok" : "warn"}${command.error ? ` (${command.error})` : ""}`);
  }
  lines.push("", "## Artifacts", "");
  lines.push(`- JSON: ${rel(jsonPath)}`);
  lines.push(`- Markdown: ${rel(markdownPath)}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const sources = {
  idleAudit: fileRef("idle-worker effectivity latest", "output/studio-brain/audits/idle-worker-effectivity-latest.json", 24 * 60),
  agentHarness: fileRef("agent harness next work", "output/studio-brain/agent-harness/next-work.json", 24 * 60),
  backupLatest: fileRef("backup latest manifest", "output/backups/latest.json", 24 * 60),
  opsWorkPacket: fileRef("ops work packet latest", "output/ops/swarm/latest-work-packet.json", 24 * 60),
};

const commands = {
  studioHealth: httpProbe("studio-brain-health", `${studioBrainUrl}/healthz`),
  missionHealth: httpProbe("mission-control-health", `${missionControlUrl}/api/mission-control/health`),
  idleWorkerAudit: existsSync(resolve(repoRoot, "scripts/studiobrain-idle-worker-effectivity-audit.mjs"))
    ? runCommand("idle-worker-effectivity-audit", "node", ["scripts/studiobrain-idle-worker-effectivity-audit.mjs", "--json"], { timeoutMs: 30000 })
    : skippedCommand("idle-worker-effectivity-audit", "script unavailable"),
  harnessLearn: hasNpmScript("mission:harness-learn")
    ? runCommand("mission-harness-learn", "npm", ["run", "--silent", "mission:harness-learn", "--", "--api-url", missionControlUrl, "--json"], { timeoutMs: 30000 })
    : skippedCommand("mission-harness-learn", "npm script mission:harness-learn unavailable"),
  backupEvidence: existsSync(resolve(repoRoot, "scripts/ops/backup_evidence.sh"))
    ? runCommand("backup-evidence", "bash", ["scripts/ops/backup_evidence.sh"], { timeoutMs: 30000, maxOutput: 20000 })
    : skippedCommand("backup-evidence", "script unavailable"),
  failedUnits: existsSync(resolve(repoRoot, "scripts/ops/ubuntu_failed_units.sh"))
    ? runCommand("ubuntu-failed-units", "bash", ["scripts/ops/ubuntu_failed_units.sh"], { timeoutMs: 30000, maxOutput: 12000 })
    : skippedCommand("ubuntu-failed-units", "script unavailable"),
  privilegedEvidence: existsSync(resolve(repoRoot, "scripts/ops/privileged_evidence_read.sh"))
    ? runCommand("privileged-evidence-read", "bash", ["scripts/ops/privileged_evidence_read.sh", "--summary"], { timeoutMs: 15000, maxOutput: 12000 })
    : skippedCommand("privileged-evidence-read", "script unavailable"),
};

const sections = buildSections(commands, sources);
const report = {
  schema: "studiobrain-ops-effectivity-report.v1",
  generatedAt: nowIso(),
  runId,
  status: rollupStatus(sections),
  readOnly: true,
  redaction: "metadata_only_no_env_or_secret_values",
  repoRoot,
  paths: {
    json: jsonPath,
    markdown: markdownPath,
  },
  sources,
  sections,
  commands,
};

report.markdown = renderMarkdown(report);

if (shouldWrite) {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify({ ...report, markdown: undefined }, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, report.markdown, "utf8");
}

if (printJson) process.stdout.write(`${JSON.stringify({ ...report, markdown: undefined }, null, 2)}\n`);
NODE

status=$?
if [ "$status" -ne 0 ]; then
  exit "$status"
fi

if [ "$JSON_ONLY" -eq 0 ]; then
  printf 'effectivity report written:\n'
  printf '  json: %s\n' "${JSON_PATH}"
  printf '  markdown: %s\n' "${MARKDOWN_PATH}"
fi
