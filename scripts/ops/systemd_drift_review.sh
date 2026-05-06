#!/usr/bin/env bash
set -u

# Read-only Studio Brain systemd drift review.
# Compares repo-tracked unit/script files with installed host paths by normalized text checksum.
# It does not print file contents, environment values, journal entries, or secrets.

CONFIG_ROOT="${CONFIG_ROOT:-config/studiobrain/systemd}"
SSH_HOST="${SSH_HOST:-studiobrain}"
REMOTE_SYSTEMD_ROOT="${REMOTE_SYSTEMD_ROOT:-/etc/systemd/system}"
REMOTE_BIN_ROOT="${REMOTE_BIN_ROOT:-/usr/local/bin}"
LOCAL_MODE=0
STRICT=0

usage() {
  cat <<'EOF'
Usage: bash scripts/ops/systemd_drift_review.sh [options]

Options:
  --ssh-host HOST       SSH host alias to inspect. Default: studiobrain.
  --config-root PATH    Local tracked systemd config root. Default: config/studiobrain/systemd.
  --local               Inspect the local machine instead of SSH.
  --strict              Exit non-zero if drift, missing files, unreadable files, or untracked remote candidates are found.
  --help                Show this help.

Safety:
  Read-only. Prints paths, normalized hashes, and classifications only. Does not restart, reload, install, delete, or edit anything.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ssh-host)
      SSH_HOST="${2:-}"
      shift 2
      ;;
    --config-root)
      CONFIG_ROOT="${2:-}"
      shift 2
      ;;
    --local)
      LOCAL_MODE=1
      shift
      ;;
    --strict)
      STRICT=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

section() {
  printf '\n## %s\n' "$1"
}

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

remote_capture() {
  local command_text="$1"
  if [ "${LOCAL_MODE}" -eq 1 ]; then
    bash -lc "${command_text}" </dev/null
    return $?
  fi

  if ! command -v ssh >/dev/null 2>&1; then
    echo "WARN: ssh is not available; rerun on the host with --local or install ssh." >&2
    return 127
  fi

  ssh -n "${SSH_HOST}" "${command_text}"
}

remote_path_for() {
  local relative_path="$1"
  local basename
  basename="$(basename "${relative_path}")"

  case "${relative_path}" in
    *.service|*.timer|*.service.d/*.conf|*.timer.d/*.conf)
      printf '%s/%s\n' "${REMOTE_SYSTEMD_ROOT}" "${relative_path}"
      ;;
    *.sh)
      printf '%s/%s\n' "${REMOTE_BIN_ROOT}" "${basename}"
      ;;
    *)
      printf '\n'
      ;;
  esac
}

normalized_sha256_file() {
  sed 's/\r$//' "$1" | sha256sum | cut -d' ' -f1
}

remote_normalized_sha256() {
  local remote_path="$1"
  local quoted
  quoted="$(shell_quote "${remote_path}")"
  remote_capture "if test -f ${quoted}; then if sed 's/\\r\$//' ${quoted} >/dev/null 2>&1; then sed 's/\\r\$//' ${quoted} | sha256sum | cut -d' ' -f1; else printf '%s\n' __UNREADABLE__; fi; else printf '%s\n' __MISSING__; fi" 2>/dev/null | tail -n 1
}

if [ ! -d "${CONFIG_ROOT}" ]; then
  echo "Tracked systemd config root not found: ${CONFIG_ROOT}" >&2
  echo "Run from the repo root or pass --config-root." >&2
  exit 2
fi

if ! command -v sha256sum >/dev/null 2>&1; then
  echo "sha256sum is required for local file checks." >&2
  exit 2
fi

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'scope: studio_brain_systemd_drift_review\n'
printf 'config_root: %s\n' "${CONFIG_ROOT}"
if [ "${LOCAL_MODE}" -eq 1 ]; then
  printf 'target: local\n'
else
  printf 'target_ssh_host: %s\n' "${SSH_HOST}"
fi
printf 'safety: read_only_normalized_hashes_only_no_restart_no_reload_no_install_no_delete\n'

tracked_count=0
matched_count=0
drift_count=0
missing_count=0
unreadable_count=0
skipped_count=0
untracked_count=0
declare -A expected_remote_paths=()

section "Tracked File Comparison"
printf 'status\tlocal_norm_sha256\tremote_norm_sha256\tlocal_path\tremote_path\n'

while IFS= read -r -d '' local_path; do
  relative_path="${local_path#${CONFIG_ROOT}/}"
  remote_path="$(remote_path_for "${relative_path}")"

  if [ -z "${remote_path}" ]; then
    skipped_count=$((skipped_count + 1))
    printf 'skipped\t-\t-\t%s\t-\n' "${local_path}"
    continue
  fi

  tracked_count=$((tracked_count + 1))
  expected_remote_paths["${remote_path}"]=1
  local_sha="$(normalized_sha256_file "${local_path}")"
  remote_sha="$(remote_normalized_sha256 "${remote_path}")"

  if [ "${remote_sha}" = "__MISSING__" ]; then
    missing_count=$((missing_count + 1))
    printf 'missing_remote\t%s\t-\t%s\t%s\n' "${local_sha}" "${local_path}" "${remote_path}"
  elif [ "${remote_sha}" = "__UNREADABLE__" ] || [ -z "${remote_sha}" ]; then
    unreadable_count=$((unreadable_count + 1))
    printf 'unreadable_remote\t%s\t-\t%s\t%s\n' "${local_sha}" "${local_path}" "${remote_path}"
  elif [ "${local_sha}" = "${remote_sha}" ]; then
    matched_count=$((matched_count + 1))
    printf 'matched\t%s\t%s\t%s\t%s\n' "${local_sha}" "${remote_sha}" "${local_path}" "${remote_path}"
  else
    drift_count=$((drift_count + 1))
    printf 'drift\t%s\t%s\t%s\t%s\n' "${local_sha}" "${remote_sha}" "${local_path}" "${remote_path}"
  fi
done < <(find "${CONFIG_ROOT}" -type f \( -name '*.service' -o -name '*.timer' -o -name '*.conf' -o -name '*.sh' \) -print0 | sort -z)

section "Untracked Installed Candidates"
remote_list_command="find $(shell_quote "${REMOTE_SYSTEMD_ROOT}") -maxdepth 3 -type f \( -name 'studio-brain-*.service' -o -name 'studio-brain-*.timer' -o -path $(shell_quote "${REMOTE_SYSTEMD_ROOT}/studio-brain-*.service.d/*.conf") -o -path $(shell_quote "${REMOTE_SYSTEMD_ROOT}/studio-brain-*.timer.d/*.conf") \) -print 2>/dev/null; find $(shell_quote "${REMOTE_BIN_ROOT}") -maxdepth 1 -type f -name 'studio-brain-*.sh' -print 2>/dev/null"
remote_paths="$(remote_capture "${remote_list_command}" 2>/dev/null || true)"

if [ -z "${remote_paths}" ]; then
  echo "none_or_unavailable"
else
  while IFS= read -r remote_path; do
    [ -z "${remote_path}" ] && continue
    if [ -z "${expected_remote_paths[${remote_path}]+x}" ]; then
      untracked_count=$((untracked_count + 1))
      printf 'untracked_remote\t%s\n' "${remote_path}"
    fi
  done <<< "${remote_paths}"
  if [ "${untracked_count}" -eq 0 ]; then
    echo "none"
  fi
fi

section "Summary"
printf 'tracked_compared: %s\n' "${tracked_count}"
printf 'matched: %s\n' "${matched_count}"
printf 'drift: %s\n' "${drift_count}"
printf 'missing_remote: %s\n' "${missing_count}"
printf 'unreadable_remote: %s\n' "${unreadable_count}"
printf 'skipped_unmapped: %s\n' "${skipped_count}"
printf 'untracked_remote_candidates: %s\n' "${untracked_count}"

section "Interpretation"
cat <<'EOF'
matched: repo and installed host file normalized checksums agree.
drift: installed host content differs from the tracked repo file after CRLF normalization; inspect before reinstalling or overwriting.
missing_remote: tracked repo file is not installed at the expected host path.
unreadable_remote: file exists check or checksum could not be read with current privileges.
untracked_remote: host has a Studio Brain systemd/script file not represented by the tracked repo config.

Safe next step: review drift rows, decide whether the host or repo is the source of truth, then use a small PR or approved host reconcile window. Do not run systemctl daemon-reload, restart timers, or overwrite files from this report alone.
EOF

if [ "${STRICT}" -eq 1 ]; then
  issue_count=$((drift_count + missing_count + unreadable_count + untracked_count))
  if [ "${issue_count}" -gt 0 ]; then
    exit 1
  fi
fi
