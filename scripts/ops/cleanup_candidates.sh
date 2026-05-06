#!/usr/bin/env bash
set -u

# Read-only cleanup candidate report.
# This script inventories possible cleanup work and classifies approval level.
# It never deletes, prunes, rotates, compresses, moves, or restarts anything.

TOP_N=20
IMPORT_TARGET="${IMPORT_TARGET:-/home/wuff/imports}"
BACKUP_TARGETS=("/home/wuff/backups" "/home/wuff/backup" "/var/backups")
TMP_TARGETS=("/tmp" "/var/tmp")
LOG_TARGETS=("/var/log")

usage() {
  cat <<'EOF'
Usage: bash scripts/ops/cleanup_candidates.sh [options]

Options:
  --import-target DIR   Import directory to classify. Default: /home/wuff/imports
  --backup-target DIR   Add a backup directory to inspect. Can be repeated.
  --top N               Number of rows per candidate list. Default: 20
  --help                Show this help.

Read-only by design. Cleanup actions still require human approval unless a
separate runbook explicitly says otherwise.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --import-target)
      IMPORT_TARGET="${2:-}"
      shift 2
      ;;
    --import-target=*)
      IMPORT_TARGET="${1#*=}"
      shift
      ;;
    --backup-target)
      BACKUP_TARGETS+=("${2:-}")
      shift 2
      ;;
    --backup-target=*)
      BACKUP_TARGETS+=("${1#*=}")
      shift
      ;;
    --top)
      TOP_N="${2:-20}"
      shift 2
      ;;
    --top=*)
      TOP_N="${1#*=}"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "WARN: ignoring unknown argument: $1" >&2
      shift
      ;;
  esac
done

case "${TOP_N}" in
  ''|*[!0-9]*)
    TOP_N=20
    ;;
esac

section() {
  printf '\n## %s\n' "$1"
}

subsection() {
  printf '\n### %s\n' "$1"
}

run_shell() {
  printf '\n$ %s\n' "$1"
  bash -lc "$1" 2>&1 || printf 'WARN: command failed: %s\n' "$1"
}

can_sudo() {
  command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1
}

find_large_files() {
  local target="$1"
  local min_size="${2:-50M}"

  if [ ! -d "${target}" ]; then
    printf 'not_found: %s\n' "${target}"
    return 0
  fi

  if can_sudo; then
    sudo -n find "${target}" -xdev -type f -size +"${min_size}" -printf '%s\t%TY-%Tm-%Td\t%p\n' 2>/dev/null
  else
    find "${target}" -xdev -type f -size +"${min_size}" -printf '%s\t%TY-%Tm-%Td\t%p\n' 2>/dev/null
  fi | sort -nr | head -n "${TOP_N}"
}

find_old_files() {
  local target="$1"
  local age_days="${2:-30}"

  if [ ! -d "${target}" ]; then
    printf 'not_found: %s\n' "${target}"
    return 0
  fi

  if can_sudo; then
    sudo -n find "${target}" -xdev -type f -mtime +"${age_days}" -printf '%s\t%TY-%Tm-%Td\t%p\n' 2>/dev/null
  else
    find "${target}" -xdev -type f -mtime +"${age_days}" -printf '%s\t%TY-%Tm-%Td\t%p\n' 2>/dev/null
  fi | sort -nr | head -n "${TOP_N}"
}

directory_size() {
  local target="$1"
  if [ ! -e "${target}" ]; then
    printf 'not_found\t%s\n' "${target}"
    return 0
  fi

  if can_sudo; then
    sudo -n du -sh "${target}" 2>/dev/null || true
  else
    du -sh "${target}" 2>/dev/null || true
  fi
}

section "Cleanup Candidate Classifications"
cat <<'EOF'
| Classification | Meaning |
| --- | --- |
| safe_to_automate | Safe only for future report generation or dry-run checks; this script performs those read-only actions now. |
| safe_with_backup | Candidate may be removable after backup/restore evidence proves it is replayable or recoverable. |
| requires_service_window | Candidate may require restart, recreate, image pull, log-driver change, or other service-impacting work. |
| requires_human_approval | Do not act until the owner approves the exact path/object/action. |
| do_not_touch | Treat as durable state unless a verified backup, restore plan, service window, and explicit approval exist. |
EOF

section "Report Scope"
printf -- '- generated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf -- '- import_target=%s\n' "${IMPORT_TARGET}"
printf -- '- top_rows=%s\n' "${TOP_N}"
printf -- '- mode=read_only_no_cleanup\n'

section "Safe To Automate"
cat <<'EOF'
- Generate this report on a weekly cadence.
- Capture `docker system df`, exited containers, dangling images, dangling volumes, log pressure, temp-file candidates, backup/import candidates, and action classifications.
- Compare report output to prior snapshots before proposing cleanup.
EOF

section "Docker Candidates"
if ! command -v docker >/dev/null 2>&1; then
  echo "docker not available"
else
  subsection "Docker Space"
  run_shell "docker system df"

  subsection "Exited Containers"
  echo "classification=requires_human_approval action=inspect_logs_then_remove_if_owner_approved"
  run_shell "docker ps -a -f status=exited --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"

  subsection "Dangling Images"
  echo "classification=requires_human_approval action=remove_only_after_confirming_no_rollback_need"
  run_shell "docker images -f dangling=true --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}'"

  subsection "Dangling Volumes"
  echo "classification=requires_human_approval action=map_to_container_or_backup_before_removal"
  run_shell "docker volume ls -f dangling=true"

  subsection "Dangling Volume Details"
  echo "classification=requires_human_approval action=review_mountpoint_labels_and_backup_before_removal"
  run_shell "volumes=\$(docker volume ls -q -f dangling=true); if [ -n \"\$volumes\" ]; then docker volume inspect -f '{{.Name}} driver={{.Driver}} mountpoint={{.Mountpoint}} labels={{json .Labels}}' \$volumes; else echo 'no dangling volumes'; fi"

  subsection "Volume Ownership Map"
  echo "classification=do_not_touch action=map_named_volumes_before_any_cleanup"
  run_shell "for id in \$(docker ps -aq); do docker inspect -f '{{.Name}} {{range .Mounts}}{{.Type}}:{{.Name}}:{{.Destination}} {{end}}' \"\$id\"; done"

  subsection "Service Window Candidates"
  cat <<'EOF'
- Changing Docker log driver options: requires_service_window
- Adding hard CPU/memory caps: requires_service_window
- Pulling new production images: requires_service_window
- Recreating containers to apply Compose changes: requires_service_window
EOF
fi

section "Log Candidates"
subsection "Journal Size"
if command -v journalctl >/dev/null 2>&1; then
  run_shell "journalctl --disk-usage"
else
  echo "journalctl not available"
fi

subsection "Large Log Files"
echo "classification=requires_human_approval action=rotate_or_truncate_only_with_runbook"
for target in "${LOG_TARGETS[@]}"; do
  printf '\n# target=%s min_size=50M\n' "${target}"
  find_large_files "${target}" "50M"
done

section "Temporary File Candidates"
echo "classification=requires_human_approval action=delete_only_after_owner_confirms_no_active_process_uses_path"
for target in "${TMP_TARGETS[@]}"; do
  printf '\n# target=%s age_days=30\n' "${target}"
  find_old_files "${target}" "30"
done

section "Import Candidates"
echo "classification=safe_with_backup_or_requires_human_approval action=classify_source_data_vs_replayable_imports_before_cleanup"
directory_size "${IMPORT_TARGET}"
if [ -d "${IMPORT_TARGET}" ]; then
  printf '\n# largest files under %s\n' "${IMPORT_TARGET}"
  find_large_files "${IMPORT_TARGET}" "100M"
  printf '\n# old files under %s\n' "${IMPORT_TARGET}"
  find_old_files "${IMPORT_TARGET}" "30"
fi

section "Backup Candidates"
echo "classification=safe_with_backup_or_requires_human_approval action=verify_retention_and_restore_confidence_before_cleanup"
for target in "${BACKUP_TARGETS[@]}"; do
  [ -n "${target}" ] || continue
  printf '\n# target=%s\n' "${target}"
  directory_size "${target}"
  find_old_files "${target}" "30"
done

section "Do Not Touch Without Explicit Approval"
cat <<'EOF'
- PostgreSQL data directories and Docker volumes.
- MinIO/object storage data directories and Docker volumes.
- Redis volumes/state files unless rebuildability is documented.
- Any file under an import, backup, archive, or attachment path whose provenance is unknown.
- Any cleanup action that requires restarting services, changing firewall/SSH/sudoers, upgrading packages, or pruning Docker volumes.
EOF

section "Suggested Next Steps"
cat <<'EOF'
1. Attach this report to a cleanup ticket.
2. Pick one cleanup family only: Docker artifacts, logs, temp files, imports, or backups.
3. Record exact paths/objects, expected benefit, backup evidence, rollback notes, and production impact.
4. Get owner approval before any deletion, prune, truncate, restart, package change, or service-window action.
EOF
