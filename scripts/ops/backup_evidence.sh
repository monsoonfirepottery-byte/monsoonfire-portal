#!/usr/bin/env bash
set -u

# Read-only Studio Brain backup evidence report.
# Prints metadata only: paths, timestamps, sizes, service readiness, and restore-drill evidence.
# It does not run backups, restore data, print environment variables, or read secret files.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="${REPO_ROOT:-${DEFAULT_REPO_ROOT}}"

APP_BACKUP_ROOT="${APP_BACKUP_ROOT:-${REPO_ROOT}/output/backups}"
SYSTEM_BACKUP_ROOT="${SYSTEM_BACKUP_ROOT:-/var/backups/studio-brain}"
SYSTEM_DAILY_ROOT="${SYSTEM_DAILY_ROOT:-${SYSTEM_BACKUP_ROOT}/daily}"
SYSTEM_METADATA_PATH="${SYSTEM_METADATA_PATH:-${SYSTEM_BACKUP_ROOT}/latest-metadata.json}"
POSTGRES_BACKUP_ROOT="${POSTGRES_BACKUP_ROOT:-${SYSTEM_BACKUP_ROOT}/postgres}"
HOST_BACKUP_ROOT="${HOST_BACKUP_ROOT:-/home/wuff/backups}"

PG_CONTAINER="${PG_CONTAINER:-studiobrain_postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-studiobrain_redis}"
MINIO_CONTAINER="${MINIO_CONTAINER:-studiobrain_minio}"
PGDATABASE="${PGDATABASE:-monsoonfire_studio_os}"

FRESHNESS_HOURS="${STUDIO_BRAIN_BACKUP_MAX_AGE_HOURS:-24}"

section() {
  printf '\n## %s\n' "$1"
}

warn() {
  printf 'WARN: %s\n' "$1"
}

run_shell() {
  printf '\n$ %s\n' "$1"
  bash -lc "$1" 2>&1 || warn "command failed: $1"
}

json_summary() {
  local latest_path="$1"
  local freshness_hours="$2"

  if ! command -v node >/dev/null 2>&1; then
    warn "node is unavailable; cannot parse ${latest_path}"
    return 0
  fi

  node - "${latest_path}" "${freshness_hours}" "${REPO_ROOT}" <<'NODE'
const fs = require("fs");
const path = require("path");

const latestPath = process.argv[2];
const freshnessHours = Number.parseInt(process.argv[3] || "24", 10);
const repoRoot = process.argv[4] || process.cwd();
const maxAgeMinutes = Number.isFinite(freshnessHours) && freshnessHours > 0 ? freshnessHours * 60 : 24 * 60;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return null;
  }
}

function ageMinutes(iso) {
  const date = new Date(iso || "");
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
}

function print(key, value) {
  console.log(`${key}: ${value === undefined || value === null || value === "" ? "<missing>" : value}`);
}

const latest = readJson(latestPath);
if (!latest) {
  console.log(`latest_status: missing_or_unreadable`);
  process.exit(0);
}

print("latest_status", latest.status);
print("latest_gate_status", latest.gateStatus);
print("latest_generated_at", latest.generatedAt);
print("latest_manifest_path", latest.manifestPath);
print("latest_checksum_path", latest.checksumPath);

const latestAge = ageMinutes(latest.generatedAt);
print("latest_age_minutes", latestAge);
print("latest_freshness", latestAge === null ? "unknown" : latestAge <= maxAgeMinutes ? "fresh" : "stale");

const manifestPath = latest.manifestPath ? path.resolve(repoRoot, latest.manifestPath) : "";
const manifest = manifestPath ? readJson(manifestPath) : null;
if (!manifest) {
  console.log("manifest_status: missing_or_unreadable");
  process.exit(0);
}

print("manifest_status", manifest.status);
print("manifest_generated_at", manifest.generatedAt);
print("manifest_command", manifest.command);
print("manifest_redaction_state", manifest.provenance?.redactionState || "");
print("manifest_data_classification", manifest.provenance?.dataClassification || "");

const checks = Array.isArray(manifest.serviceChecks) ? manifest.serviceChecks : [];
for (const service of ["postgres", "redis", "minio"]) {
  const check = checks.find((entry) => entry?.service === service);
  print(`${service}_check_status`, check?.status || "missing");
  print(`${service}_check_summary`, check?.summary || "No service check in manifest.");
  const freshness = manifest.freshness?.services?.[service];
  print(`${service}_freshness_status`, freshness?.status || "missing");
  print(`${service}_freshness_message`, freshness?.message || "No freshness entry in manifest.");
}
NODE
}

list_latest_files() {
  local label="$1"
  local dir="$2"
  local pattern="$3"
  local limit="${4:-5}"

  printf '\n### %s\n' "${label}"
  printf 'directory: %s\n' "${dir}"
  printf 'pattern: %s\n' "${pattern}"

  if [ ! -d "${dir}" ]; then
    printf 'status: missing_directory\n'
    return 0
  fi

  local command="find \"${dir}\" -type f -name \"${pattern}\" -printf '%T@ %TY-%Tm-%TdT%TH:%TM:%TSZ %s %p\n' 2>/dev/null | sort -nr | head -n ${limit}"
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
  printf 'latest files:\n'
  printf '%s\n' "${output}" | awk '{epoch=$1; time=$2; size=$3; $1=""; $2=""; $3=""; sub(/^   /, ""); printf "- %s bytes=%s path=%s\n", time, size, $0}'
}

container_summary() {
  local label="$1"
  local container="$2"

  printf '\n### %s\n' "${label}"
  printf 'container: %s\n' "${container}"

  if ! command -v docker >/dev/null 2>&1; then
    printf 'status: docker_unavailable\n'
    return 0
  fi

  if ! docker ps -a --format '{{.Names}}' | grep -qx "${container}"; then
    printf 'status: container_missing\n'
    return 0
  fi

  docker inspect -f 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} image={{.Config.Image}} mounts={{len .Mounts}}' "${container}" 2>&1 || true
}

system_metadata_summary() {
  local metadata_path="$1"

  printf 'metadata_path: %s\n' "${metadata_path}"
  if [ ! -f "${metadata_path}" ]; then
    printf 'metadata_status: missing_or_permission_denied\n'
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    warn "node is unavailable; cannot parse ${metadata_path}"
    return 0
  fi

  node - "${metadata_path}" <<'NODE'
const fs = require("fs");
const metadataPath = process.argv[2];

function print(key, value) {
  console.log(`${key}: ${value === undefined || value === null || value === "" ? "<missing>" : value}`);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
} catch (error) {
  console.log("metadata_status: unreadable");
  console.log(`metadata_error: ${String(error.message || error).replace(/\s+/g, " ").slice(0, 160)}`);
  process.exit(0);
}

print("metadata_status", "present");
print("metadata_schema", payload.schema);
print("metadata_generated_at", payload.generatedAt);
print("metadata_redaction", payload.redaction);
print("metadata_daily_root", payload.dailyRoot);

const archives = Array.isArray(payload.configArchives) ? payload.configArchives : [];
print("config_archive_count_listed", archives.length);
for (const archive of archives.slice(0, 5)) {
  print(`config_archive_${archive.name || "unknown"}`, `${archive.mtime || "unknown"} bytes=${archive.sizeBytes ?? "unknown"} path=${archive.path || ""}`);
}

for (const service of ["postgres", "redis", "minio"]) {
  const evidence = payload.dataEvidence?.[service] || {};
  print(`${service}_metadata_path`, evidence.path);
  print(`${service}_metadata_exists`, evidence.exists);
  print(`${service}_metadata_file_count`, evidence.fileCount);
  const newest = evidence.newestFile;
  print(`${service}_metadata_newest`, newest ? `${newest.mtime} bytes=${newest.sizeBytes} path=${newest.path}` : "none");
}

print("app_backup_manifest_path", payload.appBackupManifest?.path);
print("app_backup_manifest_exists", payload.appBackupManifest?.exists);
print("restore_drill_file_count", payload.restoreDrill?.fileCount);
print("restore_drill_newest", payload.restoreDrill?.newestFile ? `${payload.restoreDrill.newestFile.mtime} path=${payload.restoreDrill.newestFile.path}` : "none");
NODE
}

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'repo_root: %s\n' "${REPO_ROOT}"
printf 'freshness_threshold_hours: %s\n' "${FRESHNESS_HOURS}"
printf 'redaction: metadata_only_no_env_or_secret_values\n'

section "Unified Source Manifest"
printf 'This report separates source systems. A passing readiness check is not the same as a tested data restore.\n'
printf '\n| Source | Evidence class | What this script proves | What remains unproven |\n'
printf '| --- | --- | --- | --- |\n'
printf '| config archives | filesystem metadata | archive presence, age, size | restore content correctness |\n'
printf '| PostgreSQL | manifest + service readiness + dump artifact search | container readiness, pg_dump/pg_restore tools, dump file presence if found | successful restore unless restore summary exists |\n'
printf '| Redis | manifest + container metadata | container/manifest status | RDB/AOF backup completeness unless separate artifact exists |\n'
printf '| MinIO | manifest + container metadata | container/manifest status | object backup completeness unless separate artifact exists |\n'
printf '| restore drill | manifest search + tool checks | restore-prerequisite summary presence | full production restore over real data |\n'

section "Application Backup Manifest"
printf 'latest_path: %s\n' "${APP_BACKUP_ROOT}/latest.json"
json_summary "${APP_BACKUP_ROOT}/latest.json" "${FRESHNESS_HOURS}"

section "Root-Owned Backup Metadata"
system_metadata_summary "${SYSTEM_METADATA_PATH}"

section "Config Archive Evidence"
list_latest_files "system host config archives" "${SYSTEM_DAILY_ROOT}" "host-config-*.tgz" 5
list_latest_files "studio-brain config archives" "${SYSTEM_DAILY_ROOT}" "studio-brain-config-*.tgz" 5
list_latest_files "home backup files" "${HOST_BACKUP_ROOT}" "*" 5

section "PostgreSQL Evidence"
container_summary "postgres container" "${PG_CONTAINER}"
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
  run_shell "docker exec -u postgres ${PG_CONTAINER} pg_isready -d ${PGDATABASE}"
  run_shell "docker exec -u postgres ${PG_CONTAINER} pg_dump --version"
  run_shell "docker exec -u postgres ${PG_CONTAINER} pg_restore --version"
else
  printf 'postgres_tool_status: unavailable_without_running_container\n'
fi
list_latest_files "postgres dump artifacts" "${POSTGRES_BACKUP_ROOT}" "*.dump" 5
list_latest_files "postgres sql archives" "${POSTGRES_BACKUP_ROOT}" "*.sql*" 5

section "Redis Evidence"
container_summary "redis container" "${REDIS_CONTAINER}"
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "${REDIS_CONTAINER}"; then
  run_shell "docker exec ${REDIS_CONTAINER} sh -lc 'redis-cli ping 2>&1 || true'"
else
  printf 'redis_ping_status: unavailable_without_running_container\n'
fi
list_latest_files "redis backup artifacts" "${SYSTEM_BACKUP_ROOT}/redis" "*" 5

section "MinIO Evidence"
container_summary "minio container" "${MINIO_CONTAINER}"
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "${MINIO_CONTAINER}"; then
  run_shell "docker exec ${MINIO_CONTAINER} sh -lc 'if command -v curl >/dev/null 2>&1; then curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null && echo minio_live=pass || echo minio_live=fail; elif command -v wget >/dev/null 2>&1; then wget -qO- http://127.0.0.1:9000/minio/health/live >/dev/null && echo minio_live=pass || echo minio_live=fail; else echo minio_live=skipped_no_curl_or_wget; fi'"
else
  printf 'minio_health_status: unavailable_without_running_container\n'
fi
list_latest_files "minio backup artifacts" "${SYSTEM_BACKUP_ROOT}/minio" "*" 5

section "Restore Drill Evidence"
list_latest_files "restore drill summaries" "${APP_BACKUP_ROOT}" "restore-drill-summary.json" 5
printf '\nrestore_prerequisite_command: npm run backup:restore:drill\n'
printf 'restore_prerequisite_note: run against a disposable target or advisory prerequisite mode; do not restore over production.\n'
printf 'script_scope: read_only_metadata_report\n'

section "Operator Reading Guide"
printf -- '- Treat missing dump, Redis, or MinIO artifacts as restore-confidence gaps, even if containers are healthy.\n'
printf -- '- Treat stale latest.json as a freshness gap until a new verified manifest exists.\n'
printf -- '- Attach this output to ops tickets only after a quick human review for local path sensitivity.\n'
