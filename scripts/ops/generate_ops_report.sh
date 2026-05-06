#!/usr/bin/env bash
set -u

# Generate a local read-only ops evidence bundle.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${1:-${REPO_ROOT}/output/ops/${STAMP}}"
PG_CONTAINER="${PG_CONTAINER:-studiobrain_postgres}"
PGDATABASE="${PGDATABASE:-monsoonfire_studio_os}"
SUMMARY_ROWS=()

mkdir -p "${OUT_DIR}"

json_string() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '"%s"' "${value}"
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
  label="$1"
  shift
  printf 'writing %s\n' "${OUT_DIR}/${label}.txt"
  {
    printf '# %s\n' "${label}"
    printf '# generated_at=%s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    "$@"
    exit_code="$?"
    printf '\n# exit_code=%s\n' "${exit_code}"
  } >"${OUT_DIR}/${label}.txt" 2>&1

  if [ "${exit_code:-1}" -eq 0 ]; then
    append_summary_row "${label}" "${label}.txt" "${exit_code}" "ok"
  else
    append_summary_row "${label}" "${label}.txt" "${exit_code:-1}" "check_failed"
  fi
}

write_skipped_report() {
  label="$1"
  shift
  printf 'writing %s\n' "${OUT_DIR}/${label}.txt"
  {
    printf '# %s\n' "${label}"
    printf '# generated_at=%s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s\n' "$@"
    printf '\n# exit_code=0\n'
  } >"${OUT_DIR}/${label}.txt" 2>&1
  append_summary_row "${label}" "${label}.txt" "0" "skipped"
}

write_summary_json() {
  local summary_path="${OUT_DIR}/summary.json"
  printf 'writing %s\n' "${summary_path}"
  {
    printf '{\n'
    printf '  "generatedAt": %s,\n' "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
    printf '  "scope": "read_only_ops_report",\n'
    printf '  "outputDir": %s,\n' "$(json_string "${OUT_DIR}")"
    printf '  "postgresContainer": %s,\n' "$(json_string "${PG_CONTAINER}")"
    printf '  "postgresDatabase": %s,\n' "$(json_string "${PGDATABASE}")"
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
}

run_to_file system_inventory bash "${SCRIPT_DIR}/system_inventory.sh"
run_to_file docker_inventory bash "${SCRIPT_DIR}/docker_inventory.sh"
run_to_file disk_pressure bash "${SCRIPT_DIR}/disk_pressure.sh"
run_to_file log_pressure bash "${SCRIPT_DIR}/log_pressure.sh"
run_to_file import_pressure bash "${SCRIPT_DIR}/import_pressure.sh"
run_to_file dependency_inventory bash "${SCRIPT_DIR}/dependency_inventory.sh"
run_to_file backup_evidence bash "${SCRIPT_DIR}/backup_evidence.sh"
run_to_file ubuntu_failed_units bash "${SCRIPT_DIR}/ubuntu_failed_units.sh"
run_to_file network_exposure_review bash "${SCRIPT_DIR}/network_exposure_review.sh"
run_to_file host_drift_inventory bash "${SCRIPT_DIR}/host_drift_inventory.sh"
run_to_file app_status_review bash "${SCRIPT_DIR}/app_status_review.sh"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
  run_to_file postgres_readonly_review docker exec -i -u postgres "${PG_CONTAINER}" psql -d "${PGDATABASE}" -X -v ON_ERROR_STOP=1 -f - <"${SCRIPT_DIR}/postgres_readonly_review.sql"
else
  write_skipped_report postgres_readonly_review \
    "PostgreSQL docker container ${PG_CONTAINER} was not available." \
    "Run manually with: psql -X -v ON_ERROR_STOP=1 -f scripts/ops/postgres_readonly_review.sql"
fi

write_summary_json

cat >"${OUT_DIR}/README.md" <<EOF
# Studio Brain Ops Evidence Bundle

Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

This bundle is read-only and should not contain secrets. Review before sharing outside the ops team.

Machine-readable summary: \`summary.json\`
EOF

printf 'ops report written to %s\n' "${OUT_DIR}"
