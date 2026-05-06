#!/usr/bin/env bash
set -u

# Read-only restore-prerequisite drill packet.
# Checks whether restore tooling, artifact metadata, and disposable-target inputs
# are present. It never runs pg_restore or writes to any database.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="${REPO_ROOT:-${DEFAULT_REPO_ROOT}}"

SYSTEM_BACKUP_ROOT="${SYSTEM_BACKUP_ROOT:-/var/backups/studio-brain}"
POSTGRES_BACKUP_ROOT="${POSTGRES_BACKUP_ROOT:-${SYSTEM_BACKUP_ROOT}/postgres}"
APP_BACKUP_ROOT="${APP_BACKUP_ROOT:-${REPO_ROOT}/output/backups}"
PG_CONTAINER="${PG_CONTAINER:-studiobrain_postgres}"
PGDATABASE="${PGDATABASE:-monsoonfire_studio_os}"
DRILL_TARGET_HINT="${DRILL_TARGET_HINT:-disposable_restore_target_required}"

section() {
  printf '\n## %s\n' "$1"
}

tool_status() {
  local tool="$1"
  if command -v "${tool}" >/dev/null 2>&1; then
    printf '%s: available\n' "${tool}"
  else
    printf '%s: unavailable\n' "${tool}"
  fi
}

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'repo_root: %s\n' "${REPO_ROOT}"
printf 'redaction: metadata_only_no_env_or_secret_values\n'
printf 'scope: prerequisite_only_no_restore_no_schema_changes\n'

section "Host Tool Prerequisites"
tool_status bash
tool_status docker
tool_status node
tool_status find
tool_status sha256sum

section "PostgreSQL Container Prerequisites"
printf 'container: %s\n' "${PG_CONTAINER}"
printf 'source_database: %s\n' "${PGDATABASE}"
if command -v docker >/dev/null 2>&1 && docker ps -a --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
  docker inspect -f 'container_status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} image={{.Config.Image}} mounts={{len .Mounts}}' "${PG_CONTAINER}" 2>&1 || true
  if docker ps --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
    docker exec -u postgres "${PG_CONTAINER}" pg_restore --version 2>&1 || true
    docker exec -u postgres "${PG_CONTAINER}" psql --version 2>&1 || true
  else
    printf 'container_tool_status: unavailable_without_running_container\n'
  fi
else
  printf 'container_status: missing_or_docker_unavailable\n'
fi

section "Artifact Prerequisites"
printf 'postgres_backup_root: %s\n' "${POSTGRES_BACKUP_ROOT}"
if [ -d "${POSTGRES_BACKUP_ROOT}" ]; then
  find "${POSTGRES_BACKUP_ROOT}" -type f \( -name '*.dump' -o -name '*.backup' -o -name '*.sql' -o -name '*.sql.gz' \) -printf '%T@ %TY-%Tm-%TdT%TH:%TM:%TSZ %s %p\n' 2>/dev/null | sort -nr | head -n 10 | awk '{epoch=$1; time=$2; size=$3; $1=""; $2=""; $3=""; sub(/^   /, ""); printf "- mtime=%s bytes=%s path=%s\n", time, size, $0}'
else
  printf 'artifact_status: missing_directory\n'
fi

section "Existing Drill Evidence"
printf 'app_backup_root: %s\n' "${APP_BACKUP_ROOT}"
if [ -d "${APP_BACKUP_ROOT}" ]; then
  find "${APP_BACKUP_ROOT}" -type f -name 'restore-drill-summary.json' -printf '%T@ %TY-%Tm-%TdT%TH:%TM:%TSZ %s %p\n' 2>/dev/null | sort -nr | head -n 5 | awk '{epoch=$1; time=$2; size=$3; $1=""; $2=""; $3=""; sub(/^   /, ""); printf "- mtime=%s bytes=%s path=%s\n", time, size, $0}'
else
  printf 'drill_summary_status: missing_app_backup_directory\n'
fi

section "Issue-Ready Drill Checklist"
printf 'target_requirement: %s\n' "${DRILL_TARGET_HINT}"
printf -- '- Confirm the chosen dump artifact path and checksum in a private operator note.\n'
printf -- '- Provision a disposable PostgreSQL target that is isolated from production data paths.\n'
printf -- '- Verify pg_restore/psql versions are compatible with the source server major version.\n'
printf -- '- Run restore only in the disposable target, then record row-count and extension checks.\n'
printf -- '- Do not paste credentials, connection strings, dump contents, or raw env files into tickets.\n'

section "Packet Result"
printf 'status: prerequisite_packet_generated\n'
printf 'next_action: attach this packet to a restore-drill ticket and execute restore only after a disposable target is named\n'
