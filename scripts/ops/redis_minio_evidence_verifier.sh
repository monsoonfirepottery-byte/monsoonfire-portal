#!/usr/bin/env bash
set -u

# Read-only Redis and MinIO evidence verifier.
# Emits service/container and backup artifact metadata only.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
DEFAULT_REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="${REPO_ROOT:-${DEFAULT_REPO_ROOT}}"

SYSTEM_BACKUP_ROOT="${SYSTEM_BACKUP_ROOT:-/var/backups/studio-brain}"
REDIS_BACKUP_ROOT="${REDIS_BACKUP_ROOT:-${SYSTEM_BACKUP_ROOT}/redis}"
MINIO_BACKUP_ROOT="${MINIO_BACKUP_ROOT:-${SYSTEM_BACKUP_ROOT}/minio}"
REDIS_CONTAINER="${REDIS_CONTAINER:-studiobrain_redis}"
MINIO_CONTAINER="${MINIO_CONTAINER:-studiobrain_minio}"
MAX_AGE_HOURS="${STUDIO_BRAIN_OBJECT_BACKUP_MAX_AGE_HOURS:-24}"

section() {
  printf '\n## %s\n' "$1"
}

list_latest() {
  local label="$1"
  local dir="$2"
  local limit="${3:-10}"

  printf '\n### %s\n' "${label}"
  printf 'directory: %s\n' "${dir}"

  if [ ! -d "${dir}" ]; then
    printf 'status: missing_directory\n'
    return 0
  fi

  local output
  output="$(find "${dir}" -type f -printf '%T@ %TY-%Tm-%TdT%TH:%TM:%TSZ %s %p\n' 2>/dev/null | sort -nr | head -n "${limit}" || true)"
  if [ -z "${output}" ] && command -v sudo >/dev/null 2>&1; then
    output="$(sudo -n find "${dir}" -type f -printf '%T@ %TY-%Tm-%TdT%TH:%TM:%TSZ %s %p\n' 2>/dev/null | sort -nr | head -n "${limit}" || true)"
  fi

  if [ -z "${output}" ]; then
    printf 'status: no_files_or_permission_denied\n'
    return 0
  fi

  printf 'status: found\n'
  printf '%s\n' "${output}" | awk '{epoch=$1; time=$2; size=$3; $1=""; $2=""; $3=""; sub(/^   /, ""); printf "- mtime=%s bytes=%s path=%s\n", time, size, $0}'
}

freshness_summary() {
  local label="$1"
  local dir="$2"

  printf '\n### %s freshness\n' "${label}"
  if ! command -v node >/dev/null 2>&1; then
    printf 'freshness_status: skipped_node_unavailable\n'
    return 0
  fi

  node - "${dir}" "${MAX_AGE_HOURS}" <<'NODE'
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const maxAgeHours = Number(process.argv[3] || 24);

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    if (entry.isFile()) {
      const stat = fs.statSync(full);
      out.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return out;
}

const files = walk(root).sort((a, b) => b.mtimeMs - a.mtimeMs);
if (files.length === 0) {
  console.log("freshness_status: no_files");
  process.exit(0);
}
const newest = files[0];
const ageHours = Math.max(0, (Date.now() - newest.mtimeMs) / 3600000);
console.log("freshness_status: found");
console.log(`newest_path: ${newest.path}`);
console.log(`newest_mtime: ${new Date(newest.mtimeMs).toISOString()}`);
console.log(`newest_size_bytes: ${newest.size}`);
console.log(`newest_age_hours: ${ageHours.toFixed(2)}`);
console.log(`freshness_result: ${ageHours <= maxAgeHours ? "fresh" : "stale"}`);
NODE
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

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'repo_root: %s\n' "${REPO_ROOT}"
printf 'redaction: metadata_only_no_object_content_no_secret_values\n'
printf 'freshness_threshold_hours: %s\n' "${MAX_AGE_HOURS}"

section "Redis Evidence"
container_summary "redis container" "${REDIS_CONTAINER}"
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "${REDIS_CONTAINER}"; then
  docker exec "${REDIS_CONTAINER}" sh -lc 'redis-cli ping 2>&1 || true' 2>&1 || true
else
  printf 'redis_ping_status: unavailable_without_running_container\n'
fi
freshness_summary "redis backup" "${REDIS_BACKUP_ROOT}"
list_latest "redis backup artifacts" "${REDIS_BACKUP_ROOT}" 10

section "MinIO Evidence"
container_summary "minio container" "${MINIO_CONTAINER}"
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "${MINIO_CONTAINER}"; then
  docker exec "${MINIO_CONTAINER}" sh -lc 'if command -v curl >/dev/null 2>&1; then curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null && echo minio_live=pass || echo minio_live=fail; elif command -v wget >/dev/null 2>&1; then wget -qO- http://127.0.0.1:9000/minio/health/live >/dev/null && echo minio_live=pass || echo minio_live=fail; else echo minio_live=skipped_no_curl_or_wget; fi' 2>&1 || true
else
  printf 'minio_health_status: unavailable_without_running_container\n'
fi
freshness_summary "minio backup" "${MINIO_BACKUP_ROOT}"
list_latest "minio backup artifacts" "${MINIO_BACKUP_ROOT}" 10

section "Verifier Result Interpretation"
printf -- '- Fresh artifacts plus healthy containers are evidence, not restore proof.\n'
printf -- '- Missing Redis or MinIO artifacts should become restore-confidence gaps in the DBA packet.\n'
printf -- '- Do not attach object names that encode sensitive customer or staff data without review.\n'
