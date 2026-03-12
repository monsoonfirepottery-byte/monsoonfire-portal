#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

SESSION_TAG="${SESSION_TAG:-$(date -u +%Y-%m-%d)}"
SESSION_ID="${SESSION_ID:-overnight-${SESSION_TAG}}"
MAX_HOURS="${MAX_HOURS:-10}"
SLEEP_SECONDS="${SLEEP_SECONDS:-300}"
COMMAND_TIMEOUT_MS="${COMMAND_TIMEOUT_MS:-1800000}"
CODEX_PROC_ENABLED="${CODEX_PROC_ENABLED:-0}"
CODEX_PROC_TIMEOUT_MS="${CODEX_PROC_TIMEOUT_MS:-2700000}"
CODEX_PROC_MODEL="${CODEX_PROC_MODEL:-}"
CODEX_PROC_REASONING_EFFORT="${CODEX_PROC_REASONING_EFFORT:-xhigh}"
CODEX_FULL_PERMISSIONS="${CODEX_FULL_PERMISSIONS:-1}"
CODEX_AUTOMATION_LAUNCHER="${CODEX_AUTOMATION_LAUNCHER:-monsoonfire-overnight.service}"
WORKFLOW_FOLDIN_ENABLED="${WORKFLOW_FOLDIN_ENABLED:-1}"
WORKFLOW_FOLDIN_CODEX_HOURS="${WORKFLOW_FOLDIN_CODEX_HOURS:-8}"
WORKFLOW_FOLDIN_FRICTION_HOURS="${WORKFLOW_FOLDIN_FRICTION_HOURS:-24}"
WORKFLOW_FOLDIN_PORTAL_HOURS="${WORKFLOW_FOLDIN_PORTAL_HOURS:-6}"
WORKFLOW_FOLDIN_WEEKLY_HOURS="${WORKFLOW_FOLDIN_WEEKLY_HOURS:-168}"
WORKFLOW_FOLDIN_INTEL_HOURS="${WORKFLOW_FOLDIN_INTEL_HOURS:-168}"
WORKFLOW_FOLDIN_BRANCH="${WORKFLOW_FOLDIN_BRANCH:-main}"
WORKFLOW_FOLDIN_EPIC_SELECTION="${WORKFLOW_FOLDIN_EPIC_SELECTION:-1-20}"
WORKFLOW_FOLDIN_EPIC_LIMIT="${WORKFLOW_FOLDIN_EPIC_LIMIT:-48}"
WORKFLOW_FOLDIN_MAX_ISSUES="${WORKFLOW_FOLDIN_MAX_ISSUES:-8}"

OUTPUT_ROOT="${OUTPUT_ROOT:-${REPO_ROOT}/output/overnight/${SESSION_ID}}"
LOG_DIR="${OUTPUT_ROOT}/logs"
INTENT_OUTPUT_DIR="${OUTPUT_ROOT}/intent"
FOLDIN_STAMP_DIR="${INTENT_OUTPUT_DIR}/foldin-stamps"
LOCK_PATH="${LOCK_PATH:-${REPO_ROOT}/output/overnight/.overnight.lock}"
HEARTBEAT_PATH="${OUTPUT_ROOT}/heartbeat.json"

mkdir -p "${LOG_DIR}" "${INTENT_OUTPUT_DIR}" "${FOLDIN_STAMP_DIR}"
mkdir -p "$(dirname "${LOCK_PATH}")"

exec 9>"${LOCK_PATH}"
if ! flock -n 9; then
  echo "Another overnight loop is already running (${LOCK_PATH})."
  exit 0
fi

LOG_FILE="${LOG_DIR}/loop-$(date -u +%Y%m%dT%H%M%SZ).log"
touch "${LOG_FILE}"
ln -sfn "${LOG_FILE}" "${LOG_DIR}/latest.log"

log() {
  local message="$*"
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${message}" | tee -a "${LOG_FILE}"
}

load_env_file() {
  local env_file="$1"
  if [[ -f "${env_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
  fi
}

run_step() {
  local label="$1"
  shift
  log "START ${label} :: $*"
  set +e
  "$@" >>"${LOG_FILE}" 2>&1
  local exit_code=$?
  set -e
  log "END   ${label} :: exit=${exit_code}"
  return "${exit_code}"
}

resolve_json_field() {
  local json_payload="$1"
  local field_path="$2"
  node --input-type=module - "${json_payload}" "${field_path}" <<'NODE'
const [payloadRaw, fieldPath] = process.argv.slice(2);
const payload = JSON.parse(payloadRaw);
const value = String(fieldPath || "")
  .split(".")
  .filter(Boolean)
  .reduce((current, key) => (current && typeof current === "object" ? current[key] : undefined), payload);
if (value === undefined || value === null) {
  process.stdout.write("");
} else {
  process.stdout.write(String(value));
}
NODE
}

resolve_codex_automation_gate() {
  export CODEX_AUTOMATION_GATE_ALLOW="0"
  export CODEX_AUTOMATION_GATE_REASON="proc_disabled"
  export CODEX_AUTOMATION_GATE_SOURCE="local_toggle"

  if [[ "${CODEX_PROC_ENABLED}" == "0" ]]; then
    log "Codex automation gate blocked :: reason=proc_disabled source=local_toggle launcher=${CODEX_AUTOMATION_LAUNCHER}"
    return 0
  fi

  local gate_args=(node ./scripts/codex-automation-control.mjs gate --launcher "${CODEX_AUTOMATION_LAUNCHER}" --json)
  if [[ -n "${CODEX_PROC_MODEL}" ]]; then
    gate_args+=(--model "${CODEX_PROC_MODEL}")
  fi

  local gate_output=""
  local gate_exit=0
  set +e
  gate_output="$("${gate_args[@]}" 2>>"${LOG_FILE}")"
  gate_exit=$?
  set -e

  if [[ "${gate_exit}" -ne 0 && "${gate_exit}" -ne 20 ]]; then
    log "Codex automation gate failed; failing closed for launcher=${CODEX_AUTOMATION_LAUNCHER}."
    export CODEX_AUTOMATION_GATE_REASON="gate_error"
    export CODEX_AUTOMATION_GATE_SOURCE="guard_script"
    return 0
  fi

  printf '%s\n' "${gate_output}" >>"${LOG_FILE}"

  local allowed_raw
  allowed_raw="$(resolve_json_field "${gate_output}" "allowed")"
  if [[ "${allowed_raw}" == "true" ]]; then
    export CODEX_AUTOMATION_GATE_ALLOW="1"
  fi
  export CODEX_AUTOMATION_GATE_REASON="$(resolve_json_field "${gate_output}" "reason")"
  export CODEX_AUTOMATION_GATE_SOURCE="$(resolve_json_field "${gate_output}" "source")"

  if [[ "${CODEX_AUTOMATION_GATE_ALLOW}" == "1" ]]; then
    log "Codex automation gate allow :: launcher=${CODEX_AUTOMATION_LAUNCHER} model=${CODEX_PROC_MODEL:-"(default)"}"
  else
    log "Codex automation gate blocked :: launcher=${CODEX_AUTOMATION_LAUNCHER} reason=${CODEX_AUTOMATION_GATE_REASON:-blocked} source=${CODEX_AUTOMATION_GATE_SOURCE:-unknown}"
  fi
}

stamp_path_for_key() {
  local key="$1"
  local safe_key
  safe_key="$(echo "${key}" | tr -c 'A-Za-z0-9._-' '_')"
  printf '%s/%s.last-attempt-epoch' "${FOLDIN_STAMP_DIR}" "${safe_key}"
}

should_run_cadence() {
  local key="$1"
  local cadence_hours="$2"
  local now_epoch
  local last_epoch=0
  local stamp_path

  if ! [[ "${cadence_hours}" =~ ^[0-9]+$ ]] || (( cadence_hours <= 0 )); then
    return 0
  fi

  now_epoch="$(date +%s)"
  stamp_path="$(stamp_path_for_key "${key}")"

  if [[ -f "${stamp_path}" ]]; then
    local raw_last
    raw_last="$(cat "${stamp_path}" 2>/dev/null || true)"
    if [[ "${raw_last}" =~ ^[0-9]+$ ]]; then
      last_epoch="${raw_last}"
    fi
  fi

  if (( (now_epoch - last_epoch) >= (cadence_hours * 3600) )); then
    return 0
  fi
  return 1
}

mark_cadence_attempt() {
  local key="$1"
  local stamp_path
  stamp_path="$(stamp_path_for_key "${key}")"
  date +%s >"${stamp_path}"
}

run_cadenced_step() {
  local key="$1"
  local cadence_hours="$2"
  local label="$3"
  shift 3

  if ! should_run_cadence "${key}" "${cadence_hours}"; then
    log "SKIP ${label} :: cadence_hold=${cadence_hours}h"
    return 0
  fi

  if run_step "${label}" "$@"; then
    mark_cadence_attempt "${key}"
    return 0
  fi

  local exit_code=$?
  mark_cadence_attempt "${key}"
  return "${exit_code}"
}

build_overlay_plan() {
  local base_plan="$1"
  local output_plan="$2"
  node --input-type=module - "${base_plan}" "${output_plan}" >>"${LOG_FILE}" 2>&1 <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const [basePlanPath, outputPlanPath] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(basePlanPath, "utf8"));
const codexProcEnabled =
  String(process.env.CODEX_PROC_ENABLED || "0") !== "0" &&
  String(process.env.CODEX_AUTOMATION_GATE_ALLOW || "0") !== "0";
const codexProcTimeoutMs = String(process.env.CODEX_PROC_TIMEOUT_MS || "2700000").trim();
const codexProcModel = String(process.env.CODEX_PROC_MODEL || "").trim();

const nonExecutionScopes = new Set([
  "none",
  "artifact-only",
  "codex-artifacts-only",
  "issues-and-bot-pr-branch",
  "external-api-readwrite-bounded",
  "events-source-ingest",
]);

function shellQuote(value) {
  const raw = String(value ?? "");
  return `'${raw.replace(/'/g, `'\"'\"'`)}'`;
}

function shouldAppendCodexProc(scope) {
  const normalized = String(scope || "").trim().toLowerCase();
  if (!normalized) return false;
  return !nonExecutionScopes.has(normalized);
}

for (const task of Array.isArray(plan.tasks) ? plan.tasks : []) {
  task.checks = (Array.isArray(task.checks) ? task.checks : []).map((rawCheck) => {
    const check = String(rawCheck ?? "").trim();

    if (check === "npm run codex:improve:daily -- --apply --json") {
      return "npm run codex:improve:daily -- --apply --allow-dirty --json";
    }
    if (check === "npm run codex:interaction:apply -- --json") {
      return "npm run codex:interaction:apply -- --allow-dirty --no-github --json";
    }
    if (check === "npm run codex:interaction:apply -- --allow-dirty --json") {
      return "npm run codex:interaction:apply -- --allow-dirty --no-github --json";
    }
    if (check === "npm run codex:rubric:strict") {
      return "npm run codex:rubric:daily:write";
    }
    if (check === "npm run studio:check:safe") {
      return "npm run studio:check:safe -- --no-evidence";
    }
    return check;
  });

  if (codexProcEnabled && shouldAppendCodexProc(task.writeScope)) {
    const command = [
      "node ./scripts/intent-codex-proc.mjs",
      `--intent-id ${shellQuote(task.intentId || "")}`,
      `--task-id ${shellQuote(task.taskId || "")}`,
      `--title ${shellQuote(task.title || "")}`,
      `--write-scope ${shellQuote(task.writeScope || "")}`,
      `--risk-tier ${shellQuote(task.riskTier || "")}`,
      `--reasoning-effort ${shellQuote(process.env.CODEX_PROC_REASONING_EFFORT || "xhigh")}`,
      `--launcher ${shellQuote(process.env.CODEX_AUTOMATION_LAUNCHER || "monsoonfire-overnight.service")}`,
      `--timeout-ms ${codexProcTimeoutMs}`,
    ].join(" ");
    const modelArg = codexProcModel ? `${command} --model ${shellQuote(codexProcModel)}` : command;
    task.checks.unshift(modelArg);
  }
}

writeFileSync(outputPlanPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
NODE
}

write_heartbeat() {
  local iteration_dir="$1"
  local iteration="$2"
  local run_id="$3"

  node --input-type=module - "${iteration_dir}" "${HEARTBEAT_PATH}" "${iteration}" "${SESSION_ID}" "${run_id}" >>"${LOG_FILE}" 2>&1 <<'NODE'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const [iterationDir, heartbeatPath, iterationRaw, sessionId, runId] = process.argv.slice(2);
const reportPath = `${iterationDir}/intent-run-report.json`;
const reliabilityPath = `${iterationDir}/stability/heartbeat-summary.json`;

let summary = null;
if (existsSync(reportPath)) {
  try {
    const parsed = JSON.parse(readFileSync(reportPath, "utf8"));
    summary = parsed.summary || null;
  } catch {
    summary = null;
  }
}

let reliabilityStatus = null;
if (existsSync(reliabilityPath)) {
  try {
    const parsed = JSON.parse(readFileSync(reliabilityPath, "utf8"));
    reliabilityStatus = parsed.status || null;
  } catch {
    reliabilityStatus = null;
  }
}

const payload = {
  updatedAt: new Date().toISOString(),
  sessionId,
  runId,
  iteration: Number(iterationRaw),
  reportPath,
  reliabilityPath,
  reliabilityStatus,
  summary,
};

writeFileSync(heartbeatPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
appendFileSync(`${heartbeatPath}.jsonl`, `${JSON.stringify(payload)}\n`, "utf8");
NODE
}

load_env_file "${REPO_ROOT}/secrets/portal/portal-automation.env"
load_env_file "${REPO_ROOT}/secrets/studio-brain/studio-brain-automation.env"
load_env_file "${REPO_ROOT}/studio-brain/.env"
load_env_file "${REPO_ROOT}/studio-brain/.env.local"

export SESSION_TAG
export SESSION_ID
export CODEX_PROC_ENABLED
export CODEX_PROC_TIMEOUT_MS
export CODEX_PROC_MODEL
export CODEX_PROC_REASONING_EFFORT
export CODEX_FULL_PERMISSIONS
export CODEX_AUTOMATION_LAUNCHER
export WORKFLOW_FOLDIN_ENABLED
export WORKFLOW_FOLDIN_CODEX_HOURS
export WORKFLOW_FOLDIN_PORTAL_HOURS
export WORKFLOW_FOLDIN_WEEKLY_HOURS
export WORKFLOW_FOLDIN_BRANCH
export WORKFLOW_FOLDIN_EPIC_SELECTION
export WORKFLOW_FOLDIN_EPIC_LIMIT
export WORKFLOW_FOLDIN_MAX_ISSUES

export PATH="${HOME}/.local/jre21-portable/bin:${HOME}/.nvm/versions/node/v25.6.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

if ! command -v node >/dev/null 2>&1; then
  log "Node.js is required but was not found on PATH."
  exit 1
fi

if [[ -x "${REPO_ROOT}/scripts/use-java.sh" ]]; then
  if source "${REPO_ROOT}/scripts/use-java.sh" >>"${LOG_FILE}" 2>&1; then
    log "Java runtime configured."
  else
    log "Java runtime setup failed; Java-dependent checks may fail."
  fi
fi

START_TS="$(date +%s)"
DEADLINE_TS="$((START_TS + (MAX_HOURS * 3600)))"
ITERATION=0

log "Overnight loop started: session=${SESSION_ID} maxHours=${MAX_HOURS} sleepSeconds=${SLEEP_SECONDS}"

while (( $(date +%s) < DEADLINE_TS )); do
  ITERATION="$((ITERATION + 1))"
  ITERATION_DIR="${OUTPUT_ROOT}/iter-$(printf '%03d' "${ITERATION}")"
  mkdir -p "${ITERATION_DIR}"

  log "Iteration ${ITERATION} started."
  run_step "intent.validate" npm run intent:validate:strict || true
  run_step "intent.compile" npm run intent:compile || true
  run_step "intent.drift" npm run intent:drift:strict || true
  resolve_codex_automation_gate

  BASE_PLAN="${REPO_ROOT}/artifacts/intent-plan.generated.json"
  OVERLAY_PLAN="${ITERATION_DIR}/intent-plan.overnight.generated.json"
  RUN_ID="intent-run-overnight-${SESSION_TAG}-unknown"

  if [[ -f "${BASE_PLAN}" ]]; then
    if build_overlay_plan "${BASE_PLAN}" "${OVERLAY_PLAN}"; then
      DIGEST="$(sha256sum "${OVERLAY_PLAN}" | awk '{print $1}')"
      DIGEST_SHORT="${DIGEST:0:12}"
      RUN_ID="intent-run-overnight-${SESSION_TAG}-${DIGEST_SHORT}"
      LEDGER_PATH="${INTENT_OUTPUT_DIR}/intent-run-ledger-${DIGEST_SHORT}.jsonl"
      REPORT_PATH="${ITERATION_DIR}/intent-run-report.json"

      RUNNER_ARGS=(
        node ./scripts/intent-runner.mjs
        --json
        --execute
        --continue-on-error
        --enable-scoring
        --run-id "${RUN_ID}"
        --plan "${OVERLAY_PLAN}"
        --report "${REPORT_PATH}"
        --ledger "${LEDGER_PATH}"
        --run-artifacts-root "${ITERATION_DIR}/runs"
        --dead-letter "${INTENT_OUTPUT_DIR}/intent-dead-letter.jsonl"
        --command-timeout-ms "${COMMAND_TIMEOUT_MS}"
      )

      if [[ -f "${LEDGER_PATH}" ]] && grep -q "\"runId\":\"${RUN_ID}\"" "${LEDGER_PATH}"; then
        RUNNER_ARGS+=(--resume)
      fi

      run_step \
        "intent.execute.resume" \
        "${RUNNER_ARGS[@]}" || true
    else
      log "Overlay plan generation failed; skipping intent execute for this iteration."
    fi
  else
    log "Compiled plan missing at ${BASE_PLAN}; skipping intent execute."
  fi

  if [[ "${WORKFLOW_FOLDIN_ENABLED}" != "0" ]]; then
    run_cadenced_step \
      "codex-backlog-autopilot" \
      "${WORKFLOW_FOLDIN_CODEX_HOURS}" \
      "workflow.codex.backlog.autopilot" \
      node ./scripts/codex/backlog-autopilot.mjs \
        --apply \
        --write \
        --json \
        --epic "${WORKFLOW_FOLDIN_EPIC_SELECTION}" \
        --limit "${WORKFLOW_FOLDIN_EPIC_LIMIT}" \
        --max-issues "${WORKFLOW_FOLDIN_MAX_ISSUES}" || true

    run_cadenced_step \
      "codex-findings-summary" \
      "${WORKFLOW_FOLDIN_CODEX_HOURS}" \
      "workflow.codex.findings.summary" \
      node ./scripts/codex/automation-findings-summary.mjs \
        --apply \
        --json || true

    run_cadenced_step \
      "codex-friction-feedback-loop" \
      "${WORKFLOW_FOLDIN_FRICTION_HOURS}" \
      "workflow.codex.friction.feedback.loop" \
      node ./scripts/codex/friction-feedback-loop.mjs \
        --apply \
        --lookback-hours 168 \
        --max-entries 1200 \
        --max-recommendations 10 \
        --max-proposals 8 \
        --report-json output/qa/codex-friction-feedback-loop.json \
        --report-markdown output/qa/codex-friction-feedback-loop.md \
        --json || true

    run_cadenced_step \
      "portal-automation-dashboard" \
      "${WORKFLOW_FOLDIN_PORTAL_HOURS}" \
      "workflow.portal.automation.dashboard" \
      node ./scripts/portal-automation-health-dashboard.mjs \
        --branch "${WORKFLOW_FOLDIN_BRANCH}" \
        --lookback-hours 48 \
        --run-limit 30 \
        --report-json output/qa/portal-automation-health-dashboard.json \
        --report-markdown output/qa/portal-automation-health-dashboard.md \
        --threshold-report output/qa/portal-loop-threshold-tuning.json \
        --json || true

    run_cadenced_step \
      "portal-automation-issues" \
      "${WORKFLOW_FOLDIN_PORTAL_HOURS}" \
      "workflow.portal.automation.issues" \
      node ./scripts/portal-automation-issue-loop.mjs \
        --apply \
        --dashboard output/qa/portal-automation-health-dashboard.json \
        --repeated-threshold 2 \
        --max-issues 6 \
        --max-per-workflow 2 \
        --report-json output/qa/portal-automation-issue-loop.json \
        --report-markdown output/qa/portal-automation-issue-loop.md \
        --json || true

    run_cadenced_step \
      "portal-automation-weekly-digest" \
      "${WORKFLOW_FOLDIN_WEEKLY_HOURS}" \
      "workflow.portal.automation.weekly.digest" \
      node ./scripts/portal-automation-weekly-digest.mjs \
        --apply \
        --workflow-name "Portal Automation Health Daily" \
        --branch "${WORKFLOW_FOLDIN_BRANCH}" \
        --lookback-days 7 \
        --run-limit 25 \
        --report-json output/qa/portal-automation-weekly-digest.json \
        --report-markdown output/qa/portal-automation-weekly-digest.md \
        --json || true

    run_cadenced_step \
      "codex-external-intel-weekly" \
      "${WORKFLOW_FOLDIN_INTEL_HOURS}" \
      "workflow.codex.external.intel.weekly" \
      node ./scripts/codex/weekly-external-intelligence.mjs \
        --apply \
        --lookback-days 7 \
        --max-results 12 \
        --max-fetch 24 \
        --output "imports/weekly-external-intelligence-${SESSION_TAG}.jsonl" \
        --report-json output/intel/weekly-external-intelligence-latest.json \
        --report-markdown output/intel/weekly-external-intelligence-latest.md \
        --json || true
  fi

  run_step "reliability.once" node ./scripts/reliability-hub.mjs once --json --artifact-dir "${ITERATION_DIR}/stability" || true

  write_heartbeat "${ITERATION_DIR}" "${ITERATION}" "${RUN_ID}"

  NOW_TS="$(date +%s)"
  REMAINING="$((DEADLINE_TS - NOW_TS))"
  if (( REMAINING <= 0 )); then
    break
  fi

  SLEEP_FOR="${SLEEP_SECONDS}"
  if (( SLEEP_FOR > REMAINING )); then
    SLEEP_FOR="${REMAINING}"
  fi

  log "Iteration ${ITERATION} complete. Sleeping ${SLEEP_FOR}s (${REMAINING}s remaining)."
  sleep "${SLEEP_FOR}"
done

log "Overnight loop finished (max hours reached)."
