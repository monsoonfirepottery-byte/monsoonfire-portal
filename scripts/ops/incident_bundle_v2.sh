#!/usr/bin/env bash
set -u

# Build a redacted, read-only Studio Brain incident bundle.
# This v2 bundle keeps raw logs opt-in, records per-check status, and avoids
# environment dumps or host mutation.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${1:-${REPO_ROOT}/output/ops/incidents-v2/${STAMP}}"
PG_CONTAINER="${PG_CONTAINER:-studiobrain_postgres}"
PGDATABASE="${PGDATABASE:-monsoonfire_studio_os}"
INCIDENT_INCLUDE_LOGS="${INCIDENT_INCLUDE_LOGS:-0}"
INCIDENT_INCLUDE_POST_DEPLOY="${INCIDENT_INCLUDE_POST_DEPLOY:-1}"
INCIDENT_BUNDLE_V2_SMOKE="${INCIDENT_BUNDLE_V2_SMOKE:-0}"
INCIDENT_WRITE_LATEST="${INCIDENT_WRITE_LATEST:-1}"
LATEST_SUMMARY="${REPO_ROOT}/output/ops/incidents-v2/incident-bundle-v2-latest.json"
SUMMARY_ROWS=()

mkdir -p "${OUT_DIR}"
chmod 700 "${OUT_DIR}" 2>/dev/null || true

json_string() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '"%s"' "${value}"
}

sanitize_stream() {
  sed -E \
    -e 's/([Aa]uthorization:?[[:space:]]*Bearer[[:space:]]+)[^[:space:]]+/\1[redacted]/g' \
    -e 's/([Cc]ookie:?[[:space:]]*)[^[:space:]]+/\1[redacted]/g' \
    -e 's/([Tt]oken["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Pp]assword["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Ss]ecret["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/(api[_-]?key["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/Ig' \
    -e 's/([A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+/[jwt-redacted]/g'
}

append_summary_row() {
  local label="$1"
  local file="$2"
  local exit_code="$3"
  local status="$4"
  local bytes="0"

  if [ -f "${OUT_DIR}/${file}" ]; then
    bytes="$(wc -c <"${OUT_DIR}/${file}" | tr -d '[:space:]')"
  fi

  SUMMARY_ROWS+=("$(printf '{"label":%s,"file":%s,"status":%s,"exitCode":%s,"bytes":%s}' \
    "$(json_string "${label}")" \
    "$(json_string "${file}")" \
    "$(json_string "${status}")" \
    "${exit_code}" \
    "${bytes}")")
}

run_to_file() {
  local label="$1"
  shift
  local exit_code=0
  local raw_file="${OUT_DIR}/.${label}.raw"
  printf 'writing %s\n' "${OUT_DIR}/${label}.txt"
  {
    printf '# %s\n' "${label}"
    printf '# generated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# scope=read_only_redacted_incident_evidence_v2\n\n'
    "$@" 2>&1
    exit_code="$?"
    printf '\n# exit_code=%s\n' "${exit_code}"
  } >"${raw_file}" 2>&1
  sanitize_stream <"${raw_file}" >"${OUT_DIR}/${label}.txt" 2>&1
  rm -f "${raw_file}" 2>/dev/null || true

  if [ "${exit_code}" -eq 0 ]; then
    append_summary_row "${label}" "${label}.txt" "${exit_code}" "ok"
  else
    append_summary_row "${label}" "${label}.txt" "${exit_code}" "check_failed"
  fi
}

write_command_file() {
  local label="$1"
  local command_text="$2"
  run_to_file "${label}" bash -lc "${command_text}"
}

write_skipped_report() {
  local label="$1"
  shift
  printf 'writing %s\n' "${OUT_DIR}/${label}.txt"
  {
    printf '# %s\n' "${label}"
    printf '# generated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# scope=read_only_redacted_incident_evidence_v2\n\n'
    printf '%s\n' "$@"
    printf '\n# exit_code=0\n'
  } | sanitize_stream >"${OUT_DIR}/${label}.txt" 2>&1
  append_summary_row "${label}" "${label}.txt" "0" "skipped"
}

write_summary_json() {
  local summary_path="${OUT_DIR}/summary.json"
  local mode="full"
  if [ "${INCIDENT_BUNDLE_V2_SMOKE}" = "1" ]; then
    mode="smoke"
  fi
  printf 'writing %s\n' "${summary_path}"
  {
    printf '{\n'
    printf '  "schema": "studio-brain-incident-bundle-v2.summary.v1",\n'
    printf '  "generatedAt": %s,\n' "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
    printf '  "scope": "read_only_redacted_incident_evidence_v2",\n'
    printf '  "mode": %s,\n' "$(json_string "${mode}")"
    printf '  "outputDir": %s,\n' "$(json_string "${OUT_DIR}")"
    printf '  "postgresContainer": %s,\n' "$(json_string "${PG_CONTAINER}")"
    printf '  "postgresDatabase": %s,\n' "$(json_string "${PGDATABASE}")"
    printf '  "includeLogs": %s,\n' "$(json_string "${INCIDENT_INCLUDE_LOGS}")"
    printf '  "reports": [\n'
    local idx
    for idx in "${!SUMMARY_ROWS[@]}"; do
      if [ "${idx}" -gt 0 ]; then
        printf ',\n'
      fi
      printf '    %s' "${SUMMARY_ROWS[$idx]}"
    done
    printf '\n  ]\n'
    printf '}\n'
  } >"${summary_path}"
  if [ "${INCIDENT_WRITE_LATEST}" = "1" ]; then
    mkdir -p "$(dirname "${LATEST_SUMMARY}")"
    cp "${summary_path}" "${LATEST_SUMMARY}"
  fi
}

run_script_if_present() {
  local label="$1"
  local script_path="$2"
  if [ -f "${script_path}" ]; then
    run_to_file "${label}" bash "${script_path}"
  else
    write_skipped_report "${label}" "Missing script: ${script_path}"
  fi
}

if [ "${INCIDENT_BUNDLE_V2_SMOKE}" = "1" ]; then
  write_command_file versions "printf 'hostname='; hostname 2>/dev/null || true; printf 'date='; date -Is 2>/dev/null || date -u; command -v node >/dev/null 2>&1 && node --version || true; command -v npm >/dev/null 2>&1 && npm --version || true"
  write_skipped_report full_inventory "smoke mode enabled; full inventory checks skipped"
  write_skipped_report journal_studio_brain "smoke mode enabled; journals skipped"
  write_summary_json
  cat >"${OUT_DIR}/README.md" <<EOF
# Studio Brain Incident Evidence Bundle v2 Smoke

Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Scope: fast CI smoke for bundle creation, summary writing, and redaction plumbing.
EOF
  printf 'incident bundle v2 smoke written to %s\n' "${OUT_DIR}"
  exit 0
fi

run_script_if_present system_inventory "${SCRIPT_DIR}/system_inventory.sh"
run_script_if_present app_status_review "${SCRIPT_DIR}/app_status_review.sh"
run_script_if_present docker_inventory "${SCRIPT_DIR}/docker_inventory.sh"
run_script_if_present disk_pressure "${SCRIPT_DIR}/disk_pressure.sh"
run_script_if_present log_pressure "${SCRIPT_DIR}/log_pressure.sh"
run_script_if_present dependency_inventory "${SCRIPT_DIR}/dependency_inventory.sh"
run_script_if_present backup_evidence "${SCRIPT_DIR}/backup_evidence.sh"
run_script_if_present ubuntu_failed_units "${SCRIPT_DIR}/ubuntu_failed_units.sh"
run_script_if_present network_exposure_review "${SCRIPT_DIR}/network_exposure_review.sh"
run_script_if_present host_drift_inventory "${SCRIPT_DIR}/host_drift_inventory.sh"
run_script_if_present systemd_drift_review "${SCRIPT_DIR}/systemd_drift_review.sh"
run_script_if_present portal_bridge_review "${SCRIPT_DIR}/portal_bridge_review.sh"

write_command_file versions "printf 'hostname='; hostname 2>/dev/null || true; printf 'date='; date -Is 2>/dev/null || date -u; printf 'kernel='; uname -a 2>/dev/null || true; command -v docker >/dev/null 2>&1 && docker version || true; command -v node >/dev/null 2>&1 && node --version || true; command -v npm >/dev/null 2>&1 && npm --version || true; command -v psql >/dev/null 2>&1 && psql --version || true"
write_command_file process_pressure "ps -eo pid,ppid,pcpu,pmem,etime,args --sort=-pcpu 2>/dev/null | head -40 || true"
write_command_file socket_pressure "(ss -tanp 2>/dev/null || ss -tan 2>/dev/null || netstat -ano 2>/dev/null || true) | sed -n '1,180p'"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "${PG_CONTAINER}"; then
  run_to_file postgres_readonly_review docker exec -i -u postgres "${PG_CONTAINER}" psql -d "${PGDATABASE}" -X -v ON_ERROR_STOP=1 -f - <"${SCRIPT_DIR}/postgres_readonly_review.sql"
else
  write_skipped_report postgres_readonly_review \
    "PostgreSQL docker container ${PG_CONTAINER} was not available." \
    "Run manually with: psql -X -v ON_ERROR_STOP=1 -f scripts/ops/postgres_readonly_review.sql"
fi

if [ "${INCIDENT_INCLUDE_POST_DEPLOY}" = "1" ] && [ -f "${SCRIPT_DIR}/post_deploy_verify.sh" ]; then
  POST_DEPLOY_VERIFY_STRICT=0 run_to_file post_deploy_verify bash "${SCRIPT_DIR}/post_deploy_verify.sh" --skip-harness
else
  write_skipped_report post_deploy_verify "Post-deploy verification was skipped."
fi

if [ "${INCIDENT_INCLUDE_LOGS}" = "1" ]; then
  write_command_file journal_studio_brain "for unit in studio-brain-mission-control.service studio-brain-backup.service studio-brain-healthcheck.service studio-brain-idle-worker.service studio-brain-idle-worker-overnight.service docker.service; do echo \"## \$unit\"; journalctl -u \"\$unit\" -n 120 --no-pager -l 2>/dev/null || true; done"
else
  write_skipped_report journal_studio_brain \
    "journal_status: skipped" \
    "reason: raw logs can contain sensitive application details" \
    "to_include_short_redacted_journals: INCIDENT_INCLUDE_LOGS=1 bash scripts/ops/incident_bundle_v2.sh"
fi

write_summary_json

cat >"${OUT_DIR}/README.md" <<EOF
# Studio Brain Incident Evidence Bundle v2

Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Scope: read-only diagnostics with stream redaction. This bundle should not contain environment dumps, bearer tokens, cookies, JWTs, passwords, or API keys, but review it before sharing outside the ops team.

Machine-readable summary: \`summary.json\`

Suggested reading order:

1. summary.json
2. app_status_review.txt
3. post_deploy_verify.txt
4. process_pressure.txt
5. socket_pressure.txt
6. ubuntu_failed_units.txt
7. docker_inventory.txt
8. postgres_readonly_review.txt
9. backup_evidence.txt
10. network_exposure_review.txt
11. host_drift_inventory.txt

Unsafe actions still requiring approval:

- restarting services
- deploying or changing systemd units
- pruning Docker images, containers, or volumes
- rotating secrets
- changing firewall, SSH, package, or PostgreSQL configuration
- deleting logs, temp files, backups, imports, or database data
EOF

printf 'incident bundle v2 written to %s\n' "${OUT_DIR}"
