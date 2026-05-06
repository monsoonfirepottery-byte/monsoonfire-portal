#!/usr/bin/env bash
set -u

# Read-only post-deploy verification for Studio Brain and Mission Control.
# Defaults are safe: no deploys, no restarts, no secret reads, no destructive actions.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STUDIO_BRAIN_BASE_URL="${STUDIO_BRAIN_BASE_URL:-http://192.168.1.226:8787}"
MISSION_CONTROL_BASE_URL="${MISSION_CONTROL_BASE_URL:-http://127.0.0.1:14100}"
CURL_TIMEOUT_SECONDS="${CURL_TIMEOUT_SECONDS:-8}"
POST_DEPLOY_VERIFY_STRICT="${POST_DEPLOY_VERIFY_STRICT:-0}"
SKIP_HARNESS=0
SKIP_IDLE_WORKER=0
FAILURES=0
WARNINGS=0

for arg in "$@"; do
  case "${arg}" in
    --strict)
      POST_DEPLOY_VERIFY_STRICT=1
      ;;
    --skip-harness)
      SKIP_HARNESS=1
      ;;
    --skip-idle-worker)
      SKIP_IDLE_WORKER=1
      ;;
    --help|-h)
      cat <<'EOF'
Usage: bash scripts/ops/post_deploy_verify.sh [--strict] [--skip-harness] [--skip-idle-worker]

Environment:
  STUDIO_BRAIN_BASE_URL       default http://192.168.1.226:8787
  MISSION_CONTROL_BASE_URL    default http://127.0.0.1:14100
  CURL_TIMEOUT_SECONDS        default 8
  POST_DEPLOY_VERIFY_STRICT   set 1 to exit nonzero on warnings
EOF
      exit 0
      ;;
  esac
done

sanitize_stream() {
  sed -E \
    -e 's/([Aa]uthorization:?[[:space:]]*Bearer[[:space:]]+)[^[:space:]]+/\1[redacted]/g' \
    -e 's/([Cc]ookie:?[[:space:]]*)[^[:space:]]+/\1[redacted]/g' \
    -e 's/([Tt]oken["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Pp]assword["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Ss]ecret["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+/[jwt-redacted]/g'
}

section() {
  printf '\n## %s\n' "$1"
}

record_ok() {
  printf 'status: ok\n'
}

record_warn() {
  WARNINGS=$((WARNINGS + 1))
  printf 'status: warn\n'
  printf 'warning: %s\n' "$1"
}

record_fail() {
  FAILURES=$((FAILURES + 1))
  printf 'status: fail\n'
  printf 'error: %s\n' "$1"
}

summarize_json() {
  local label="$1"
  local payload
  payload="$(cat)"

  if command -v node >/dev/null 2>&1; then
    printf '%s' "${payload}" | node -e '
const fs = require("fs");
const label = process.argv[1] || "payload";
const input = fs.readFileSync(0, "utf8");
function clean(value) {
  return value === undefined || value === null || value === "" ? "<missing>" : value;
}
function redact(value) {
  if (Array.isArray(value)) return value.slice(0, 12).map(redact);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = /token|secret|password|cookie|authorization|credential|private/i.test(key) ? "[redacted]" : redact(nested);
  }
  return out;
}
try {
  const json = JSON.parse(input);
  console.log(`ok: ${clean(json.ok)}`);
  console.log(`status: ${clean(json.status || json.overallStatus || (json.overseer && json.overseer.overallStatus))}`);
  console.log(`storage: ${clean(json.storage)}`);
  console.log(`ready: ${clean(json.ready || json.isReady)}`);
  console.log(`generatedAt: ${clean(json.generatedAt)}`);
  if (json.checks) console.log(`checks: ${JSON.stringify(redact(json.checks)).slice(0, 1000)}`);
  if (json.dependencies) console.log(`dependencies: ${JSON.stringify(redact(json.dependencies)).slice(0, 1000)}`);
  if (json.codexIngest) console.log(`codexIngest: ${JSON.stringify(redact(json.codexIngest)).slice(0, 1000)}`);
  if (json.requests) console.log(`requests: ${JSON.stringify(redact(json.requests)).slice(0, 1000)}`);
} catch {
  console.log(`${label}_preview: ${input.replace(/\s+/g, " ").slice(0, 1000)}`);
}
' "${label}"
  else
    printf '%s' "${payload}" | sanitize_stream | head -c 1000
    printf '\n'
  fi
}

fetch_jsonish() {
  local label="$1"
  local url="$2"
  local require_ok="${3:-0}"
  local body

  printf '\n### %s\n' "${label}"
  printf 'url: %s\n' "${url}"

  if ! command -v curl >/dev/null 2>&1; then
    record_warn "curl unavailable; skipped ${label}"
    return 0
  fi

  body="$(curl -fsS --max-time "${CURL_TIMEOUT_SECONDS}" "${url}" 2>&1)" || {
    record_fail "$(printf '%s' "${body}" | sanitize_stream | head -c 500)"
    return 0
  }

  if [ "${require_ok}" = "1" ] && command -v node >/dev/null 2>&1; then
    if ! printf '%s' "${body}" | node -e 'const fs=require("fs"); const input=fs.readFileSync(0,"utf8"); const json=JSON.parse(input); if (json.ok === false || json.ready === false || json.isReady === false) process.exit(1);' >/dev/null 2>&1; then
      record_fail "${label} returned JSON but did not report ok/ready"
      printf '%s' "${body}" | summarize_json "${label}"
      return 0
    fi
  fi

  record_ok
  printf '%s' "${body}" | summarize_json "${label}"
}

admin_dom_smoke() {
  local url="${MISSION_CONTROL_BASE_URL}/mission-control/admin"
  local body
  printf '\n### mission control admin dom smoke\n'
  printf 'url: %s\n' "${url}"

  if ! command -v curl >/dev/null 2>&1; then
    record_warn "curl unavailable; skipped Mission Control admin DOM smoke"
    return 0
  fi

  body="$(curl -fsS --max-time "${CURL_TIMEOUT_SECONDS}" "${url}" 2>&1)" || {
    record_fail "$(printf '%s' "${body}" | sanitize_stream | head -c 500)"
    return 0
  }

  if printf '%s' "${body}" | grep -Eiq 'mission[ -]?control|admin|root|<!doctype html|<html'; then
    record_ok
    printf 'dom_signal: present\n'
  else
    record_fail "admin page loaded but expected DOM signal was missing"
  fi
}

npm_script_exists() {
  local script_name="$1"
  node -e 'const fs=require("fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1);' "${script_name}" >/dev/null 2>&1
}

run_and_echo_sanitized() {
  local tmp_file="$1"
  shift
  "$@" >"${tmp_file}" 2>&1
  local code="$?"
  sanitize_stream <"${tmp_file}"
  return "${code}"
}

output_reports_status() {
  local tmp_file="$1"
  local status="$2"
  grep -Eq "\"status\"[[:space:]]*:[[:space:]]*\"${status}\"" "${tmp_file}" 2>/dev/null
}

run_harness_check() {
  printf '\n### harness verification\n'
  if [ "${SKIP_HARNESS}" = "1" ]; then
    record_warn "harness verification skipped by --skip-harness"
    return 0
  fi
  if ! command -v npm >/dev/null 2>&1; then
    record_warn "npm unavailable; skipped harness verification"
    return 0
  fi

  if npm_script_exists "mission:harness-learn"; then
    local code=0
    local tmp_file="${TMPDIR:-/tmp}/post-deploy-harness.$$.log"
    printf 'command: npm run mission:harness-learn -- --api-url %s\n' "${MISSION_CONTROL_BASE_URL}"
    run_and_echo_sanitized "${tmp_file}" npm run mission:harness-learn -- --api-url "${MISSION_CONTROL_BASE_URL}"
    code="$?"
    if [ "${code}" -ne 0 ]; then
      record_fail "mission:harness-learn exited ${code}"
    elif output_reports_status "${tmp_file}" "fail"; then
      record_fail "mission:harness-learn reported status fail"
    elif output_reports_status "${tmp_file}" "warn"; then
      record_warn "mission:harness-learn reported status warn"
    else
      record_ok
    fi
    rm -f "${tmp_file}" 2>/dev/null || true
    return 0
  fi

  if npm_script_exists "studio:ops:agent-harness:json"; then
    local code=0
    local tmp_file="${TMPDIR:-/tmp}/post-deploy-agent-harness.$$.log"
    printf 'command: npm run studio:ops:agent-harness:json\n'
    run_and_echo_sanitized "${tmp_file}" npm run studio:ops:agent-harness:json
    code="$?"
    if [ "${code}" -ne 0 ]; then
      record_warn "agent harness packet exited ${code}; review output"
    elif output_reports_status "${tmp_file}" "fail"; then
      record_warn "agent harness packet reported status fail"
    elif output_reports_status "${tmp_file}" "warn"; then
      record_warn "agent harness packet reported status warn"
    else
      record_ok
    fi
    rm -f "${tmp_file}" 2>/dev/null || true
    return 0
  fi

  record_warn "no known harness verification npm script is available"
}

run_idle_worker_audit() {
  printf '\n### idle-worker effectivity audit\n'
  if [ "${SKIP_IDLE_WORKER}" = "1" ]; then
    record_warn "idle-worker audit skipped by --skip-idle-worker"
    return 0
  fi
  if ! command -v npm >/dev/null 2>&1; then
    record_warn "npm unavailable; skipped idle-worker audit"
    return 0
  fi
  if npm_script_exists "studio:ops:idle-worker:effectivity:audit:current"; then
    local code=0
    local tmp_file="${TMPDIR:-/tmp}/post-deploy-idle-worker.$$.log"
    printf 'command: npm run studio:ops:idle-worker:effectivity:audit:current\n'
    run_and_echo_sanitized "${tmp_file}" npm run studio:ops:idle-worker:effectivity:audit:current
    code="$?"
    if [ "${code}" -ne 0 ]; then
      record_warn "idle-worker audit exited ${code}; review artifact"
    elif output_reports_status "${tmp_file}" "fail"; then
      record_warn "idle-worker audit reported status fail"
    elif output_reports_status "${tmp_file}" "warn"; then
      record_warn "idle-worker audit reported status warn"
    else
      record_ok
    fi
    rm -f "${tmp_file}" 2>/dev/null || true
    return 0
  fi
  record_warn "studio:ops:idle-worker:effectivity:audit:current npm script is unavailable"
}

section "Post-Deploy Verification Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'repo_root: %s\n' "${REPO_ROOT}"
printf 'studio_brain_base_url: %s\n' "${STUDIO_BRAIN_BASE_URL}"
printf 'mission_control_base_url: %s\n' "${MISSION_CONTROL_BASE_URL}"
printf 'strict: %s\n' "${POST_DEPLOY_VERIFY_STRICT}"
printf 'scope: read_only_post_deploy_verification\n'

section "Studio Brain"
fetch_jsonish "studio brain healthz" "${STUDIO_BRAIN_BASE_URL}/healthz" "1"
fetch_jsonish "studio brain readyz" "${STUDIO_BRAIN_BASE_URL}/readyz" "1"
fetch_jsonish "studio brain dependencies" "${STUDIO_BRAIN_BASE_URL}/health/dependencies" "0"

section "Mission Control"
fetch_jsonish "mission control health" "${MISSION_CONTROL_BASE_URL}/api/mission-control/health" "1"
admin_dom_smoke

section "Harness"
run_harness_check

section "Idle Worker"
run_idle_worker_audit

section "Summary"
printf 'failures: %s\n' "${FAILURES}"
printf 'warnings: %s\n' "${WARNINGS}"

if [ "${FAILURES}" -gt 0 ]; then
  exit 1
fi

if [ "${POST_DEPLOY_VERIFY_STRICT}" = "1" ] && [ "${WARNINGS}" -gt 0 ]; then
  exit 1
fi

exit 0
