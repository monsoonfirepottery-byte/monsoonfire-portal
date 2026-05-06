#!/usr/bin/env bash
set -u

# Read-only Studio Brain application status review.
# It checks public health/status surfaces and Mission Control pressure without printing env vars or secrets.

# Studio Brain's HTTP API is currently LAN-addressed; override for tunnels or local dev.
STUDIO_BRAIN_BASE_URL="${STUDIO_BRAIN_BASE_URL:-http://192.168.1.226:8787}"
MISSION_CONTROL_BASE_URL="${MISSION_CONTROL_BASE_URL:-http://127.0.0.1:4100}"
CURL_TIMEOUT_SECONDS="${CURL_TIMEOUT_SECONDS:-5}"

section() {
  printf '\n## %s\n' "$1"
}

warn() {
  printf 'WARN: %s\n' "$1"
}

fetch_url() {
  local label="$1"
  local url="$2"

  printf '\n### %s\n' "${label}"
  printf 'url: %s\n' "${url}"

  if ! command -v curl >/dev/null 2>&1; then
    printf 'status: curl_unavailable\n'
    return 0
  fi

  local body
  body="$(curl -fsS --max-time "${CURL_TIMEOUT_SECONDS}" "${url}" 2>&1)" || {
    printf 'status: unavailable\n'
    printf 'error: %s\n' "$(printf '%s' "${body}" | sanitize_stream | head -c 500)"
    return 0
  }

  printf 'status: reachable\n'
  printf '%s' "${body}" | summarize_json "${label}"
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
function print(key, value) {
  const rendered = value === undefined || value === null || value === "" ? "<missing>" : value;
  console.log(`${key}: ${rendered}`);
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
  print("ok", json.ok);
  print("status", json.status || json.overallStatus || (json.overseer && json.overseer.overallStatus));
  print("storage", json.storage);
  print("generatedAt", json.generatedAt);
  print("version", json.version);
  print("clients", json.clients);
  if (json.metrics) console.log(`metrics: ${JSON.stringify(redact(json.metrics))}`);
  if (json.stateCache) console.log(`stateCache: ${JSON.stringify(redact(json.stateCache))}`);
  if (json.codexIngest) console.log(`codexIngest: ${JSON.stringify(redact(json.codexIngest))}`);
  if (json.requests) {
    const requests = Object.entries(json.requests)
      .sort(([, a], [, b]) => Number((b && b.active) || 0) - Number((a && a.active) || 0) || Number((b && b.lastMs) || 0) - Number((a && a.lastMs) || 0))
      .slice(0, 8);
    console.log(`requests_top: ${JSON.stringify(redact(Object.fromEntries(requests)))}`);
  }
  if (json.overseer) console.log(`overseer: ${JSON.stringify(redact(json.overseer))}`);
  if (!json.metrics && !json.stateCache && !json.codexIngest && !json.overseer) {
    console.log(`payload_preview: ${JSON.stringify(redact(json)).slice(0, 1200)}`);
  }
} catch {
  console.log(`${label}_preview: ${input.replace(/\s+/g, " ").slice(0, 1200)}`);
}
' "${label}"
  else
    printf '%s' "${payload}" | sanitize_stream | head -c 1200
    printf '\n'
  fi
}

sanitize_stream() {
  sed -E \
    -e 's/([Aa]uthorization:?[[:space:]]*Bearer[[:space:]]+)[^[:space:]]+/\1[redacted]/g' \
    -e 's/([Tt]oken["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Pp]assword["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Ss]ecret["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g'
}

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'scope: read_only_application_status_review\n'
printf 'studio_brain_base_url: %s\n' "${STUDIO_BRAIN_BASE_URL}"
printf 'mission_control_base_url: %s\n' "${MISSION_CONTROL_BASE_URL}"
printf 'redaction: key_name_redaction_no_env_dump\n'

section "Studio Brain Application Surfaces"
fetch_url "studio brain healthz" "${STUDIO_BRAIN_BASE_URL}/healthz"
fetch_url "studio brain api status" "${STUDIO_BRAIN_BASE_URL}/api/status"

section "Mission Control Surfaces"
fetch_url "mission control health" "${MISSION_CONTROL_BASE_URL}/api/mission-control/health"

section "Operator Reading Guide"
cat <<'EOF'
- Treat a passing health endpoint as liveness only; review `/api/status`, Mission Control request pressure, and Codex ingest pressure for operator truth.
- Rising `codexIngest.rateLimitedRequests` with stable CPU means the ingest governor is protecting the host.
- High `requests_top` `active` or `lastMs` values should be paired with process CPU, socket, and app log evidence before restarting anything.
- This report is safe to attach to tickets after checking local paths for sensitivity.
EOF
