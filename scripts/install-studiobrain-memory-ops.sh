#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_ROOT="${REPO_ROOT}/config/studiobrain/systemd/user"
HOST_USER="${STUDIO_BRAIN_HOST_USER:-${SUDO_USER:-$(id -un)}}"
HOST_HOME="${STUDIO_BRAIN_HOST_HOME:-$(getent passwd "${HOST_USER}" | cut -d: -f6)}"
USER_UNIT_DIR="${HOST_HOME}/.config/systemd/user"
UNITS=(
  "studio-brain-memory-ops-supervisor.service"
  "studio-brain-memory-ops-supervisor.timer"
)

if [[ -z "${HOST_HOME}" || ! -d "${HOST_HOME}" ]]; then
  echo "Could not resolve home directory for ${HOST_USER}." >&2
  exit 1
fi

for unit in "${UNITS[@]}"; do
  if [[ ! -f "${CONFIG_ROOT}/${unit}" ]]; then
    echo "Missing source unit: ${CONFIG_ROOT}/${unit}" >&2
    exit 1
  fi
done

install -d -m 0755 "${USER_UNIT_DIR}"
for unit in "${UNITS[@]}"; do
  install -m 0644 "${CONFIG_ROOT}/${unit}" "${USER_UNIT_DIR}/${unit}"
done

if [[ "$(id -u)" -eq 0 ]]; then
  chown -R "${HOST_USER}:${HOST_USER}" "${HOST_HOME}/.config/systemd"
  loginctl enable-linger "${HOST_USER}" >/dev/null 2>&1 || true
fi

run_user_systemctl() {
  local uid
  uid="$(id -u "${HOST_USER}")"
  if [[ "$(id -u)" -eq "${uid}" ]]; then
    systemctl --user "$@"
    return
  fi
  runuser -u "${HOST_USER}" -- env \
    "XDG_RUNTIME_DIR=/run/user/${uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus" \
    systemctl --user "$@"
}

run_user_systemctl daemon-reload
run_user_systemctl enable --now studio-brain-memory-ops-supervisor.service
run_user_systemctl enable --now studio-brain-memory-ops-supervisor.timer
run_user_systemctl show -p ActiveState -p SubState -p NRestarts studio-brain-memory-ops-supervisor.service
run_user_systemctl show -p ActiveState -p NextElapseUSecRealtime studio-brain-memory-ops-supervisor.timer
