#!/usr/bin/env bash
set -euo pipefail

# Install the Studio Brain privileged evidence collector.
# Default mode is a dry run. Use --apply for approved host mutation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CAPTURE_SRC="${REPO_ROOT}/scripts/ops/privileged_evidence_capture.sh"
SERVICE_SRC="${REPO_ROOT}/config/studiobrain/systemd/studio-brain-ops-capture.service"
TIMER_SRC="${REPO_ROOT}/config/studiobrain/systemd/studio-brain-ops-capture.timer"
SUDOERS_SRC="${REPO_ROOT}/config/studiobrain/sudoers/studio-brain-ops-capture"

INSTALL_BIN="${STUDIO_BRAIN_OPS_CAPTURE_BIN:-/usr/local/sbin/studio-brain-ops-capture}"
EVIDENCE_DIR="${STUDIO_BRAIN_PRIVILEGED_EVIDENCE_DIR:-/var/lib/studio-brain/ops-evidence}"
CAPTURE_GROUP="${STUDIO_BRAIN_OPS_CAPTURE_GROUP:-studio-brain-ops-capture}"
APPLY=0
ENABLE_TIMER=0
INSTALL_SUDOERS=0
CREATE_GROUP=0

usage() {
  cat <<'EOF'
Install Studio Brain privileged evidence collector

Usage:
  bash scripts/install-studiobrain-ops-capture.sh [--apply] [--enable-timer] [--install-sudoers] [--create-group]

Default is dry-run. --apply is required for any host mutation.

Options:
  --apply             Install files on this host.
  --enable-timer      Enable and start studio-brain-ops-capture.timer.
  --install-sudoers   Install /etc/sudoers.d/studio-brain-ops-capture after visudo validation.
  --create-group      Create group studio-brain-ops-capture when missing.
  -h, --help          Show this help.

This installer does not add users to the capture group. That remains a human
approval step, for example:

  sudo usermod -aG studio-brain-ops-capture <approved-user>
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --enable-timer)
      ENABLE_TIMER=1
      shift
      ;;
    --install-sudoers)
      INSTALL_SUDOERS=1
      shift
      ;;
    --create-group)
      CREATE_GROUP=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

for path in "${CAPTURE_SRC}" "${SERVICE_SRC}" "${TIMER_SRC}" "${SUDOERS_SRC}"; do
  if [ ! -f "${path}" ]; then
    printf 'Missing required source file: %s\n' "${path}" >&2
    exit 1
  fi
done

print_plan() {
  cat <<EOF
Studio Brain ops capture install plan

mode: $([ "${APPLY}" = "1" ] && printf apply || printf dry-run)
capture_binary: ${INSTALL_BIN}
evidence_dir: ${EVIDENCE_DIR}
systemd_service: /etc/systemd/system/studio-brain-ops-capture.service
systemd_timer: /etc/systemd/system/studio-brain-ops-capture.timer
sudoers: $([ "${INSTALL_SUDOERS}" = "1" ] && printf /etc/sudoers.d/studio-brain-ops-capture || printf "not requested")
capture_group: ${CAPTURE_GROUP}
enable_timer: ${ENABLE_TIMER}
create_group: ${CREATE_GROUP}

No action has been taken unless mode is apply.
EOF
}

print_plan

if [ "${APPLY}" != "1" ]; then
  exit 0
fi

if [ "$(id -u)" != "0" ]; then
  printf 'Approved install requires root. Re-run with sudo after reviewing the plan.\n' >&2
  exit 1
fi

if ! getent group "${CAPTURE_GROUP}" >/dev/null 2>&1; then
  if [ "${CREATE_GROUP}" = "1" ]; then
    groupadd --system "${CAPTURE_GROUP}"
  elif [ "${INSTALL_SUDOERS}" = "1" ]; then
    printf 'Capture group %s is missing. Re-run with --create-group or create it manually.\n' "${CAPTURE_GROUP}" >&2
    exit 1
  fi
fi

install -o root -g root -m 0755 "${CAPTURE_SRC}" "${INSTALL_BIN}"

if getent group "${CAPTURE_GROUP}" >/dev/null 2>&1; then
  install -d -o root -g "${CAPTURE_GROUP}" -m 0750 "${EVIDENCE_DIR}"
else
  install -d -o root -g root -m 0755 "${EVIDENCE_DIR}"
fi

install -o root -g root -m 0644 "${SERVICE_SRC}" /etc/systemd/system/studio-brain-ops-capture.service
install -o root -g root -m 0644 "${TIMER_SRC}" /etc/systemd/system/studio-brain-ops-capture.timer

if [ "${INSTALL_SUDOERS}" = "1" ]; then
  tmp_sudoers="$(mktemp)"
  cleanup() {
    rm -f "${tmp_sudoers}"
  }
  trap cleanup EXIT
  sed "s#%studio-brain-ops-capture#%${CAPTURE_GROUP}#g" "${SUDOERS_SRC}" >"${tmp_sudoers}"
  visudo -cf "${tmp_sudoers}"
  install -o root -g root -m 0440 "${tmp_sudoers}" /etc/sudoers.d/studio-brain-ops-capture
fi

systemctl daemon-reload

if [ "${ENABLE_TIMER}" = "1" ]; then
  systemctl enable --now studio-brain-ops-capture.timer
else
  printf 'Timer installed but not enabled. Enable later with:\n'
  printf '  sudo systemctl enable --now studio-brain-ops-capture.timer\n'
fi

printf 'Installed Studio Brain ops capture. Manual capture command:\n'
printf '  sudo %s\n' "${INSTALL_BIN}"
