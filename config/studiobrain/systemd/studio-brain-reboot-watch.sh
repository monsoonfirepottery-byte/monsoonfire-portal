#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${STUDIO_BRAIN_REBOOT_STATE_DIR:-/var/lib/studio-brain}"
STATE_FILE="${STATE_DIR}/reboot-watch.state"
REBOOT_REQUIRED_FILE="${STUDIO_BRAIN_REBOOT_REQUIRED_FILE:-/var/run/reboot-required}"
REBOOT_PACKAGES_FILE="${STUDIO_BRAIN_REBOOT_PACKAGES_FILE:-/var/run/reboot-required.pkgs}"
REPO_ROOT="${STUDIO_BRAIN_REPO_ROOT:-/home/wuff/monsoonfire-portal}"
REMOTE_USER="${STUDIO_BRAIN_REPO_USER:-wuff}"
NOTIFY_DISCORD="${STUDIO_BRAIN_REBOOT_NOTIFY_DISCORD:-true}"
NOTIFY_TIMEOUT_SECONDS="${STUDIO_BRAIN_REBOOT_NOTIFY_TIMEOUT_SECONDS:-20}"
LOGGER_TAG="studio-brain-reboot-watch"
CURRENT_DATE_UTC="$(date -u +%F)"

mkdir -p "${STATE_DIR}"

log() {
  logger -t "${LOGGER_TAG}" -- "$1"
}

trim_message() {
  local value="$1"
  local limit="${2:-280}"
  if ((${#value} <= limit)); then
    printf '%s' "${value}"
    return
  fi
  printf '%s…' "${value:0:limit-1}"
}

notify_discord() {
  local message="$1"
  if [[ "${NOTIFY_DISCORD}" != "true" ]]; then
    return 0
  fi
  if [[ ! -d "${REPO_ROOT}" ]] || [[ ! -x /usr/bin/node ]]; then
    log "manual reboot required but Discord notification prerequisites are missing"
    return 0
  fi
  local quoted_repo
  local quoted_message
  quoted_repo="$(printf '%q' "${REPO_ROOT}")"
  quoted_message="$(printf '%q' "${message}")"
  if command -v timeout >/dev/null 2>&1; then
    timeout "${NOTIFY_TIMEOUT_SECONDS}" \
      runuser -u "${REMOTE_USER}" -- \
      bash -lc "cd ${quoted_repo} && node ./scripts/studio-brain-discord-relay.mjs send --text ${quoted_message}" \
      >/dev/null 2>&1 || log "manual reboot required Discord notify failed or timed out"
    return 0
  fi
  runuser -u "${REMOTE_USER}" -- \
    bash -lc "cd ${quoted_repo} && node ./scripts/studio-brain-discord-relay.mjs send --text ${quoted_message}" \
    >/dev/null 2>&1 || log "manual reboot required Discord notify failed"
}

LAST_SEEN_FINGERPRINT=""
LAST_NOTIFIED_FINGERPRINT=""
LAST_NOTIFIED_DATE=""

load_state() {
  if [[ ! -f "${STATE_FILE}" ]]; then
    return 0
  fi
  if grep -q '=' "${STATE_FILE}"; then
    while IFS='=' read -r key value; do
      case "${key}" in
        LAST_SEEN_FINGERPRINT) LAST_SEEN_FINGERPRINT="${value}" ;;
        LAST_NOTIFIED_FINGERPRINT) LAST_NOTIFIED_FINGERPRINT="${value}" ;;
        LAST_NOTIFIED_DATE) LAST_NOTIFIED_DATE="${value}" ;;
      esac
    done < "${STATE_FILE}"
    return 0
  fi
  # Legacy format stored only the last notified fingerprint.
  local legacy_fingerprint
  legacy_fingerprint="$(tr -d '\r\n' < "${STATE_FILE}")"
  if [[ -n "${legacy_fingerprint}" ]]; then
    LAST_SEEN_FINGERPRINT="${legacy_fingerprint}"
    LAST_NOTIFIED_FINGERPRINT="${legacy_fingerprint}"
    LAST_NOTIFIED_DATE="${CURRENT_DATE_UTC}"
  fi
}

save_state() {
  cat > "${STATE_FILE}" <<EOF
LAST_SEEN_FINGERPRINT=${LAST_SEEN_FINGERPRINT}
LAST_NOTIFIED_FINGERPRINT=${LAST_NOTIFIED_FINGERPRINT}
LAST_NOTIFIED_DATE=${LAST_NOTIFIED_DATE}
EOF
}

load_state

if [[ -f "${REBOOT_REQUIRED_FILE}" ]]; then
  packages="unknown"
  if [[ -f "${REBOOT_PACKAGES_FILE}" ]]; then
    packages="$(tr '\n' ',' < "${REBOOT_PACKAGES_FILE}" | sed 's/,$//' | sed 's/,/, /g')"
    packages="$(trim_message "${packages}" 200)"
  fi
  fingerprint="$(printf '%s\n' "${packages}" | sha256sum | awk '{print $1}')"
  LAST_SEEN_FINGERPRINT="${fingerprint}"
  if [[ "${fingerprint}" != "${LAST_NOTIFIED_FINGERPRINT}" && "${LAST_NOTIFIED_DATE}" != "${CURRENT_DATE_UTC}" ]]; then
    message="Studio Brain host needs a manual reboot. Auto-reboot is disabled because the encrypted disk requires console unlock. Packages: ${packages}"
    log "${message}"
    notify_discord "${message}"
    LAST_NOTIFIED_FINGERPRINT="${fingerprint}"
    LAST_NOTIFIED_DATE="${CURRENT_DATE_UTC}"
  fi
  save_state
  exit 0
fi

if [[ -f "${STATE_FILE}" ]]; then
  LAST_SEEN_FINGERPRINT=""
  save_state
  log "manual reboot requirement cleared"
fi
