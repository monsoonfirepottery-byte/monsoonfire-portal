#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_ROOT="${REPO_ROOT}/config/studiobrain/systemd"
HOST_ROOT="${HOST_ROOT:-/}"
HELPER_IMAGE="${STUDIOBRAIN_HOST_HELPER_IMAGE:-alpine:3.21}"

for path in \
  "${CONFIG_ROOT}/studio-brain-healthcheck.sh" \
  "${CONFIG_ROOT}/studio-brain-healthcheck.service" \
  "${CONFIG_ROOT}/studio-brain-healthcheck.timer"; do
  if [[ ! -f "${path}" ]]; then
    echo "Missing source file: ${path}" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for scripts/install-studiobrain-healthcheck.sh" >&2
  exit 1
fi

docker run --rm \
  --privileged \
  --pid=host \
  -v "${HOST_ROOT}:/host" \
  -v "${CONFIG_ROOT}:/tmp/studiobrain-systemd:ro" \
  "${HELPER_IMAGE}" \
  sh -lc '
    set -e
    install -D -m 0755 /tmp/studiobrain-systemd/studio-brain-healthcheck.sh /host/usr/local/bin/studio-brain-healthcheck.sh
    install -D -m 0644 /tmp/studiobrain-systemd/studio-brain-healthcheck.service /host/etc/systemd/system/studio-brain-healthcheck.service
    install -D -m 0644 /tmp/studiobrain-systemd/studio-brain-healthcheck.timer /host/etc/systemd/system/studio-brain-healthcheck.timer
    chroot /host systemctl daemon-reload
    chroot /host systemctl enable studio-brain-healthcheck.timer >/dev/null
    chroot /host systemctl restart studio-brain-healthcheck.timer
    chroot /host systemctl start studio-brain-healthcheck.service
    result="$(chroot /host systemctl show -p Result --value studio-brain-healthcheck.service)"
    if [ "${result}" != "success" ]; then
      chroot /host journalctl -u studio-brain-healthcheck.service -n 20 --no-pager
      exit 1
    fi
    chroot /host systemctl show -p ActiveState -p SubState -p Result studio-brain-healthcheck.service
  '
