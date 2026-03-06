#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_FILE="${REPO_ROOT}/config/studiobrain/fail2ban/sshd.local"
HOST_ROOT="${HOST_ROOT:-/}"
HELPER_IMAGE="${STUDIOBRAIN_HOST_HELPER_IMAGE:-alpine:3.21}"

if [[ ! -f "${SOURCE_FILE}" ]]; then
  echo "Missing source file: ${SOURCE_FILE}" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for scripts/install-studiobrain-fail2ban-sshd.sh" >&2
  exit 1
fi

docker run --rm \
  --privileged \
  --pid=host \
  -v "${HOST_ROOT}:/host" \
  -v "${SOURCE_FILE}:/tmp/sshd.local:ro" \
  "${HELPER_IMAGE}" \
  sh -lc '
    set -e
    install -D -m 0644 /tmp/sshd.local /host/etc/fail2ban/jail.d/sshd.local
    chroot /host fail2ban-client -t
    chroot /host systemctl restart fail2ban
    for _ in $(seq 1 15); do
      if chroot /host fail2ban-client ping >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    chroot /host fail2ban-client ping >/dev/null
    chroot /host fail2ban-client status sshd
  '
