#!/usr/bin/env bash
set -u

# Build a read-only Studio Brain incident evidence bundle.
# Default behavior avoids raw journals and environment dumps. Set INCIDENT_INCLUDE_LOGS=1
# to include short, redacted journal excerpts for known Studio Brain units.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${1:-${REPO_ROOT}/output/ops/incidents/${STAMP}}"
PG_CONTAINER="${PG_CONTAINER:-studiobrain_postgres}"
PGDATABASE="${PGDATABASE:-monsoonfire_studio_os}"
INCIDENT_INCLUDE_LOGS="${INCIDENT_INCLUDE_LOGS:-0}"

mkdir -p "${OUT_DIR}"
chmod 700 "${OUT_DIR}" 2>/dev/null || true

sanitize_stream() {
  sed -E \
    -e 's/([Aa]uthorization:?[[:space:]]*Bearer[[:space:]]+)[^[:space:]]+/\1[redacted]/g' \
    -e 's/([Tt]oken["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Pp]assword["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Ss]ecret["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/(api[_-]?key["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/Ig'
}

run_to_file() {
  local label="$1"
  shift
  printf 'writing %s\n' "${OUT_DIR}/${label}.txt"
  {
    printf '# %s\n' "${label}"
    printf '# generated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# scope=read_only_incident_evidence\n\n'
    "$@" 2>&1
  } | sanitize_stream >"${OUT_DIR}/${label}.txt" 2>&1
}

write_command_file() {
  local label="$1"
  local command_text="$2"
  run_to_file "${label}" bash -lc "${command_text}"
}

run_to_file system_inventory bash "${SCRIPT_DIR}/system_inventory.sh"
run_to_file app_status_review bash "${SCRIPT_DIR}/app_status_review.sh"
run_to_file docker_inventory bash "${SCRIPT_DIR}/docker_inventory.sh"
run_to_file disk_pressure bash "${SCRIPT_DIR}/disk_pressure.sh"
run_to_file log_pressure bash "${SCRIPT_DIR}/log_pressure.sh"
run_to_file dependency_inventory bash "${SCRIPT_DIR}/dependency_inventory.sh"
run_to_file backup_evidence bash "${SCRIPT_DIR}/backup_evidence.sh"
run_to_file ubuntu_failed_units bash "${SCRIPT_DIR}/ubuntu_failed_units.sh"
run_to_file network_exposure_review bash "${SCRIPT_DIR}/network_exposure_review.sh"
run_to_file host_drift_inventory bash "${SCRIPT_DIR}/host_drift_inventory.sh"

write_command_file versions "printf 'hostname='; hostname; printf 'date='; date -Is; printf 'kernel='; uname -a; command -v docker >/dev/null 2>&1 && docker version || true; command -v node >/dev/null 2>&1 && node --version || true; command -v npm >/dev/null 2>&1 && npm --version || true; command -v psql >/dev/null 2>&1 && psql --version || true"
write_command_file process_pressure "ps -eo pid,ppid,pcpu,pmem,etime,args --sort=-pcpu | head -40"
write_command_file socket_pressure "(ss -tanp 2>/dev/null || ss -tan 2>/dev/null || true) | sed -n '1,180p'"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
  run_to_file postgres_readonly_review docker exec -i -u postgres "${PG_CONTAINER}" psql -d "${PGDATABASE}" -X -v ON_ERROR_STOP=1 -f - <"${SCRIPT_DIR}/postgres_readonly_review.sql"
else
  {
    echo "PostgreSQL docker container ${PG_CONTAINER} was not available."
    echo "Run manually with: psql -X -v ON_ERROR_STOP=1 -f scripts/ops/postgres_readonly_review.sql"
  } >"${OUT_DIR}/postgres_readonly_review.txt"
fi

if [ "${INCIDENT_INCLUDE_LOGS}" = "1" ]; then
  write_command_file journal_studio_brain "for unit in studio-brain-mission-control.service studio-brain-backup.service studio-brain-healthcheck.service studio-brain-idle-worker.service docker.service; do echo \"## \$unit\"; journalctl -u \"\$unit\" -n 120 --no-pager -l 2>/dev/null || true; done"
else
  {
    echo "journal_status: skipped"
    echo "reason: raw logs can contain sensitive application details"
    echo "to_include_short_redacted_journals: INCIDENT_INCLUDE_LOGS=1 scripts/ops/incident_bundle.sh"
  } >"${OUT_DIR}/journal_studio_brain.txt"
fi

cat >"${OUT_DIR}/README.md" <<EOF
# Studio Brain Incident Evidence Bundle

Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Scope: read-only diagnostics. This bundle should not contain environment dumps or secret values, but review it before sharing outside the ops team.

Suggested reading order:

1. app_status_review.txt
2. process_pressure.txt
3. socket_pressure.txt
4. ubuntu_failed_units.txt
5. docker_inventory.txt
6. postgres_readonly_review.txt
7. backup_evidence.txt
8. network_exposure_review.txt
9. host_drift_inventory.txt

Unsafe actions still requiring approval:

- restarting services
- pruning Docker images, containers, or volumes
- rotating secrets
- changing firewall, SSH, package, or PostgreSQL configuration
- deleting logs, temp files, backups, or database data
EOF

printf 'incident bundle written to %s\n' "${OUT_DIR}"
