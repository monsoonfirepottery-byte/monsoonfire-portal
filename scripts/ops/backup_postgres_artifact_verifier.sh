#!/usr/bin/env bash
set -u

# Read-only PostgreSQL backup artifact verifier.
# Emits metadata and tool readiness only. It does not create dumps, restore data,
# read secrets, or inspect dump contents.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="${REPO_ROOT:-${DEFAULT_REPO_ROOT}}"

SYSTEM_BACKUP_ROOT="${SYSTEM_BACKUP_ROOT:-/var/backups/studio-brain}"
POSTGRES_BACKUP_ROOT="${POSTGRES_BACKUP_ROOT:-${SYSTEM_BACKUP_ROOT}/postgres}"
APP_BACKUP_ROOT="${APP_BACKUP_ROOT:-${REPO_ROOT}/output/backups}"
PG_CONTAINER="${PG_CONTAINER:-studiobrain_postgres}"
PGDATABASE="${PGDATABASE:-monsoonfire_studio_os}"
MAX_AGE_HOURS="${STUDIO_BRAIN_POSTGRES_BACKUP_MAX_AGE_HOURS:-24}"

section() {
  printf '\n## %s\n' "$1"
}

warn() {
  printf 'WARN: %s\n' "$1"
}

list_artifacts() {
  local label="$1"
  local dir="$2"
  local pattern="$3"
  local limit="${4:-10}"

  printf '\n### %s\n' "${label}"
  printf 'directory: %s\n' "${dir}"
  printf 'pattern: %s\n' "${pattern}"

  if [ ! -d "${dir}" ]; then
    printf 'status: missing_directory\n'
    return 0
  fi

  local command
  command="find \"${dir}\" -type f -name \"${pattern}\" -printf '%T@ %TY-%Tm-%TdT%TH:%TM:%SZ %s %p\n' 2>/dev/null | sort -nr | head -n ${limit}"
  local output
  output="$(bash -lc "${command}" 2>/dev/null || true)"

  if [ -z "${output}" ] && command -v sudo >/dev/null 2>&1; then
    output="$(sudo -n bash -lc "${command}" 2>/dev/null || true)"
  fi

  if [ -z "${output}" ]; then
    printf 'status: no_matching_files_or_permission_denied\n'
    return 0
  fi

  printf 'status: found\n'
  printf '%s\n' "${output}" | awk '{epoch=$1; time=$2; size=$3; $1=""; $2=""; $3=""; sub(/^   /, ""); printf "- mtime=%s bytes=%s path=%s\n", time, size, $0}'
}

freshest_artifact() {
  local dir="$1"

  if [ ! -d "${dir}" ]; then
    printf 'freshest_status: missing_directory\n'
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    printf 'freshest_status: skipped_node_unavailable\n'
    return 0
  fi

  node - "${dir}" "${MAX_AGE_HOURS}" <<'NODE'
const fs = require("fs");
const path = require("path");

const root = process.argv[2];
const maxAgeHours = Number(process.argv[3] || 24);
const patterns = [/\.dump$/i, /\.sql($|\.)/i, /\.backup$/i, /\.pgdump$/i, /\.tar($|\.)/i];
const now = Date.now();

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && patterns.some((pattern) => pattern.test(entry.name))) {
      const stat = fs.statSync(full);
      out.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }
  return out;
}

const files = walk(root).sort((a, b) => b.mtimeMs - a.mtimeMs);
if (files.length === 0) {
  console.log("freshest_status: no_matching_artifacts");
  process.exit(0);
}

const newest = files[0];
const ageHours = Math.max(0, (now - newest.mtimeMs) / 3600000);
console.log("freshest_status: found");
console.log(`freshest_path: ${newest.path}`);
console.log(`freshest_mtime: ${new Date(newest.mtimeMs).toISOString()}`);
console.log(`freshest_size_bytes: ${newest.size}`);
console.log(`freshest_age_hours: ${ageHours.toFixed(2)}`);
console.log(`freshest_freshness: ${ageHours <= maxAgeHours ? "fresh" : "stale"}`);
NODE
}

freshest_artifact_path() {
  local dir="$1"

  if [ ! -d "${dir}" ] || ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  node - "${dir}" <<'NODE'
const fs = require("fs");
const path = require("path");

const root = process.argv[2];
const patterns = [/\.dump$/i, /\.backup$/i, /\.pgdump$/i, /\.tar$/i];

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && patterns.some((pattern) => pattern.test(entry.name))) {
      try {
        const stat = fs.statSync(full);
        out.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // Ignore files that disappear or cannot be statted during the read-only walk.
      }
    }
  }
  return out;
}

const files = walk(root).sort((a, b) => b.mtimeMs - a.mtimeMs);
if (files[0]) console.log(files[0].path);
NODE
}

pg_restore_list_metadata() {
  section "PostgreSQL Dump List Metadata"

  local artifact_path
  artifact_path="$(freshest_artifact_path "${POSTGRES_BACKUP_ROOT}" | head -n 1)"
  printf 'artifact_root: %s\n' "${POSTGRES_BACKUP_ROOT}"

  if [ -z "${artifact_path}" ]; then
    printf 'list_check_status: no_custom_format_artifact\n'
    printf 'notes: pg_restore --list supports custom, directory, and tar archives; plain SQL archives need separate restore-drill handling.\n'
    return 0
  fi

  printf 'artifact_path: %s\n' "${artifact_path}"

  if [ ! -r "${artifact_path}" ]; then
    printf 'list_check_status: unreadable_or_permission_denied\n'
    printf 'notes: artifact metadata exists but current user cannot read it without an approved privileged capture.\n'
    return 0
  fi

  if ! command -v pg_restore >/dev/null 2>&1; then
    printf 'list_check_status: skipped_pg_restore_unavailable\n'
    printf 'notes: install or expose pg_restore on the inspection host, or capture this check from the PostgreSQL container if the artifact is mounted there.\n'
    return 0
  fi

  local list_output
  local list_status
  list_output="$(pg_restore --list "${artifact_path}" 2>&1)"
  list_status=$?

  printf 'list_check_status: %s\n' "$([ "${list_status}" -eq 0 ] && printf readable || printf failed)"
  printf 'pg_restore_list_exit_status: %s\n' "${list_status}"

  if [ "${list_status}" -ne 0 ]; then
    printf 'pg_restore_list_error: %s\n' "$(printf '%s\n' "${list_output}" | head -n 3 | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g')"
    return 0
  fi

  local toc_total
  local toc_schema
  local toc_table_all
  local toc_index
  local toc_data
  local toc_table
  toc_total="$(printf '%s\n' "${list_output}" | wc -l | awk '{print $1}')"
  toc_schema="$(printf '%s\n' "${list_output}" | grep -Ec '^[0-9]+; [0-9]+ [0-9]+ SCHEMA ' || true)"
  toc_table_all="$(printf '%s\n' "${list_output}" | grep -Ec '^[0-9]+; [0-9]+ [0-9]+ TABLE ' || true)"
  toc_index="$(printf '%s\n' "${list_output}" | grep -Ec '^[0-9]+; [0-9]+ [0-9]+ INDEX ' || true)"
  toc_data="$(printf '%s\n' "${list_output}" | grep -Ec '^[0-9]+; [0-9]+ [0-9]+ TABLE DATA ' || true)"
  toc_table=$((toc_table_all - toc_data))
  if [ "${toc_table}" -lt 0 ]; then
    toc_table=0
  fi

  printf 'toc_total_lines: %s\n' "${toc_total}"
  printf 'toc_schema_lines: %s\n' "${toc_schema}"
  printf 'toc_table_lines: %s\n' "${toc_table}"
  printf 'toc_index_lines: %s\n' "${toc_index}"
  printf 'toc_data_lines: %s\n' "${toc_data}"
  printf 'notes: metadata-only pg_restore --list check; object names and row contents are not printed.\n'
}

container_readiness() {
  section "Container And Tool Readiness"
  printf 'container: %s\n' "${PG_CONTAINER}"
  printf 'database: %s\n' "${PGDATABASE}"

  if ! command -v docker >/dev/null 2>&1; then
    printf 'docker_status: unavailable\n'
    return 0
  fi

  if ! docker ps -a --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
    printf 'container_status: missing\n'
    return 0
  fi

  docker inspect -f 'container_status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} image={{.Config.Image}} mounts={{len .Mounts}}' "${PG_CONTAINER}" 2>&1 || true

  if docker ps --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
    docker exec -u postgres "${PG_CONTAINER}" pg_isready -d "${PGDATABASE}" 2>&1 || warn "pg_isready failed"
    docker exec -u postgres "${PG_CONTAINER}" pg_dump --version 2>&1 || warn "pg_dump version check failed"
    docker exec -u postgres "${PG_CONTAINER}" pg_restore --version 2>&1 || warn "pg_restore version check failed"
  else
    printf 'tool_status: unavailable_without_running_container\n'
  fi
}

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'repo_root: %s\n' "${REPO_ROOT}"
printf 'redaction: metadata_only_no_dump_content_no_secret_values\n'
printf 'freshness_threshold_hours: %s\n' "${MAX_AGE_HOURS}"

section "Freshest PostgreSQL Artifact"
freshest_artifact "${POSTGRES_BACKUP_ROOT}"

pg_restore_list_metadata

section "Artifact Inventory"
list_artifacts "custom-format dumps" "${POSTGRES_BACKUP_ROOT}" "*.dump" 10
list_artifacts "sql archives" "${POSTGRES_BACKUP_ROOT}" "*.sql*" 10
list_artifacts "backup archives" "${POSTGRES_BACKUP_ROOT}" "*.backup" 10
list_artifacts "app restore drill summaries" "${APP_BACKUP_ROOT}" "restore-drill-summary.json" 5

container_readiness

section "Verifier Result Interpretation"
printf -- '- PASS candidate: a fresh non-empty PostgreSQL artifact plus pg_dump and pg_restore tool readiness.\n'
printf -- '- STRONGER PASS candidate: a fresh artifact with readable pg_restore --list metadata plus pg_dump and pg_restore tool readiness.\n'
printf -- '- GAP: missing or stale artifacts, missing or failed pg_restore list metadata, missing container/tool readiness, or no restore drill summary.\n'
printf -- '- This verifier does not prove restore correctness; pair it with the restore-prerequisite drill packet.\n'
