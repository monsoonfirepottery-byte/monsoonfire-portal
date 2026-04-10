#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_ROOT="${REPO_ROOT}/config/studiobrain/systemd"
HOST_ROOT="${HOST_ROOT:-/}"
HELPER_IMAGE="${STUDIOBRAIN_HOST_HELPER_IMAGE:-alpine:3.21}"
LEGACY_SYSTEMD_UNITS=(
  "studiobrain-maintenance.service"
  "studiobrain-maintenance.timer"
  "studiobrain-fan-guardian.service"
)
LEGACY_BINARIES=(
  "/usr/local/bin/studiobrain-maintenance.sh"
  "/usr/local/bin/studiobrain-fan-guardian.py"
  "/usr/local/bin/studiobrain-import-thermal-mode.sh"
  "/usr/local/bin/studiobrain-sidecars.sh"
)

for path in \
  "${CONFIG_ROOT}/studio-brain-backup.sh" \
  "${CONFIG_ROOT}/studio-brain-backup.service" \
  "${CONFIG_ROOT}/studio-brain-backup.timer" \
  "${CONFIG_ROOT}/studio-brain-disk-alert.sh" \
  "${CONFIG_ROOT}/studio-brain-disk-alert.service" \
  "${CONFIG_ROOT}/studio-brain-disk-alert.timer" \
  "${CONFIG_ROOT}/studio-brain-healthcheck.sh" \
  "${CONFIG_ROOT}/studio-brain-healthcheck.service" \
  "${CONFIG_ROOT}/studio-brain-healthcheck.timer" \
  "${CONFIG_ROOT}/studio-brain-reboot-watch.sh" \
  "${CONFIG_ROOT}/studio-brain-reboot-watch.service" \
  "${CONFIG_ROOT}/studio-brain-reboot-watch.timer"; do
  if [[ ! -f "${path}" ]]; then
    echo "Missing source file: ${path}" >&2
    exit 1
  fi
done

if [[ "${HOST_ROOT}" == "/" ]]; then
  install -D -m 0755 "${CONFIG_ROOT}/studio-brain-backup.sh" /usr/local/bin/studio-brain-backup.sh
  install -D -m 0644 "${CONFIG_ROOT}/studio-brain-backup.service" /etc/systemd/system/studio-brain-backup.service
  install -D -m 0644 "${CONFIG_ROOT}/studio-brain-backup.timer" /etc/systemd/system/studio-brain-backup.timer
  install -D -m 0755 "${CONFIG_ROOT}/studio-brain-disk-alert.sh" /usr/local/bin/studio-brain-disk-alert.sh
  install -D -m 0644 "${CONFIG_ROOT}/studio-brain-disk-alert.service" /etc/systemd/system/studio-brain-disk-alert.service
  install -D -m 0644 "${CONFIG_ROOT}/studio-brain-disk-alert.timer" /etc/systemd/system/studio-brain-disk-alert.timer
  install -D -m 0755 "${CONFIG_ROOT}/studio-brain-healthcheck.sh" /usr/local/bin/studio-brain-healthcheck.sh
  install -D -m 0644 "${CONFIG_ROOT}/studio-brain-healthcheck.service" /etc/systemd/system/studio-brain-healthcheck.service
  install -D -m 0644 "${CONFIG_ROOT}/studio-brain-healthcheck.timer" /etc/systemd/system/studio-brain-healthcheck.timer
  install -D -m 0755 "${CONFIG_ROOT}/studio-brain-reboot-watch.sh" /usr/local/bin/studio-brain-reboot-watch.sh
  install -D -m 0644 "${CONFIG_ROOT}/studio-brain-reboot-watch.service" /etc/systemd/system/studio-brain-reboot-watch.service
  install -D -m 0644 "${CONFIG_ROOT}/studio-brain-reboot-watch.timer" /etc/systemd/system/studio-brain-reboot-watch.timer
  systemctl disable --now "${LEGACY_SYSTEMD_UNITS[@]}" >/dev/null 2>&1 || true
  rm -f "${LEGACY_BINARIES[@]}" /etc/systemd/system/studiobrain-maintenance.service /etc/systemd/system/studiobrain-maintenance.timer /etc/systemd/system/studiobrain-fan-guardian.service
  if [[ -w /sys/devices/platform/applesmc.768/fan1_manual ]]; then
    echo 0 >/sys/devices/platform/applesmc.768/fan1_manual || true
  fi
  systemctl daemon-reload
  systemctl reset-failed "${LEGACY_SYSTEMD_UNITS[@]}" >/dev/null 2>&1 || true
  systemctl enable studio-brain-backup.timer >/dev/null
  systemctl restart studio-brain-backup.timer
  systemctl start studio-brain-backup.service
  systemctl enable studio-brain-disk-alert.timer >/dev/null
  systemctl restart studio-brain-disk-alert.timer
  systemctl enable studio-brain-healthcheck.timer >/dev/null
  systemctl restart studio-brain-healthcheck.timer
  systemctl start studio-brain-healthcheck.service
  systemctl enable studio-brain-reboot-watch.timer >/dev/null
  systemctl restart studio-brain-reboot-watch.timer
  systemctl start studio-brain-reboot-watch.service
  backup_result="$(systemctl show -p Result --value studio-brain-backup.service)"
  if [ "${backup_result}" != "success" ]; then
    journalctl -u studio-brain-backup.service -n 20 --no-pager
    exit 1
  fi
  result="$(systemctl show -p Result --value studio-brain-healthcheck.service)"
  if [ "${result}" != "success" ]; then
    journalctl -u studio-brain-healthcheck.service -n 20 --no-pager
    exit 1
  fi
  reboot_result="$(systemctl show -p Result --value studio-brain-reboot-watch.service)"
  if [ "${reboot_result}" != "success" ]; then
    journalctl -u studio-brain-reboot-watch.service -n 20 --no-pager
    exit 1
  fi
  systemctl show -p ActiveState -p SubState -p Result studio-brain-healthcheck.service
  systemctl show -p ActiveState -p SubState -p Result studio-brain-reboot-watch.service
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for scripts/install-studiobrain-healthcheck.sh when HOST_ROOT is not /" >&2
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
    install -D -m 0755 /tmp/studiobrain-systemd/studio-brain-backup.sh /host/usr/local/bin/studio-brain-backup.sh
    install -D -m 0644 /tmp/studiobrain-systemd/studio-brain-backup.service /host/etc/systemd/system/studio-brain-backup.service
    install -D -m 0644 /tmp/studiobrain-systemd/studio-brain-backup.timer /host/etc/systemd/system/studio-brain-backup.timer
    install -D -m 0755 /tmp/studiobrain-systemd/studio-brain-disk-alert.sh /host/usr/local/bin/studio-brain-disk-alert.sh
    install -D -m 0644 /tmp/studiobrain-systemd/studio-brain-disk-alert.service /host/etc/systemd/system/studio-brain-disk-alert.service
    install -D -m 0644 /tmp/studiobrain-systemd/studio-brain-disk-alert.timer /host/etc/systemd/system/studio-brain-disk-alert.timer
    install -D -m 0755 /tmp/studiobrain-systemd/studio-brain-healthcheck.sh /host/usr/local/bin/studio-brain-healthcheck.sh
    install -D -m 0644 /tmp/studiobrain-systemd/studio-brain-healthcheck.service /host/etc/systemd/system/studio-brain-healthcheck.service
    install -D -m 0644 /tmp/studiobrain-systemd/studio-brain-healthcheck.timer /host/etc/systemd/system/studio-brain-healthcheck.timer
    install -D -m 0755 /tmp/studiobrain-systemd/studio-brain-reboot-watch.sh /host/usr/local/bin/studio-brain-reboot-watch.sh
    install -D -m 0644 /tmp/studiobrain-systemd/studio-brain-reboot-watch.service /host/etc/systemd/system/studio-brain-reboot-watch.service
    install -D -m 0644 /tmp/studiobrain-systemd/studio-brain-reboot-watch.timer /host/etc/systemd/system/studio-brain-reboot-watch.timer
    chroot /host systemctl disable --now studiobrain-maintenance.service studiobrain-maintenance.timer studiobrain-fan-guardian.service >/dev/null 2>&1 || true
    rm -f \
      /host/usr/local/bin/studiobrain-maintenance.sh \
      /host/usr/local/bin/studiobrain-fan-guardian.py \
      /host/usr/local/bin/studiobrain-import-thermal-mode.sh \
      /host/usr/local/bin/studiobrain-sidecars.sh \
      /host/etc/systemd/system/studiobrain-maintenance.service \
      /host/etc/systemd/system/studiobrain-maintenance.timer \
      /host/etc/systemd/system/studiobrain-fan-guardian.service
    if [ -w /host/sys/devices/platform/applesmc.768/fan1_manual ]; then
      echo 0 >/host/sys/devices/platform/applesmc.768/fan1_manual || true
    fi
    chroot /host systemctl daemon-reload
    chroot /host systemctl reset-failed studiobrain-maintenance.service studiobrain-maintenance.timer studiobrain-fan-guardian.service >/dev/null 2>&1 || true
    chroot /host systemctl enable studio-brain-backup.timer >/dev/null
    chroot /host systemctl restart studio-brain-backup.timer
    chroot /host systemctl start studio-brain-backup.service
    chroot /host systemctl enable studio-brain-disk-alert.timer >/dev/null
    chroot /host systemctl restart studio-brain-disk-alert.timer
    chroot /host systemctl enable studio-brain-healthcheck.timer >/dev/null
    chroot /host systemctl restart studio-brain-healthcheck.timer
    chroot /host systemctl start studio-brain-healthcheck.service
    chroot /host systemctl enable studio-brain-reboot-watch.timer >/dev/null
    chroot /host systemctl restart studio-brain-reboot-watch.timer
    chroot /host systemctl start studio-brain-reboot-watch.service
    backup_result="$(chroot /host systemctl show -p Result --value studio-brain-backup.service)"
    if [ "${backup_result}" != "success" ]; then
      chroot /host journalctl -u studio-brain-backup.service -n 20 --no-pager
      exit 1
    fi
    result="$(chroot /host systemctl show -p Result --value studio-brain-healthcheck.service)"
    if [ "${result}" != "success" ]; then
      chroot /host journalctl -u studio-brain-healthcheck.service -n 20 --no-pager
      exit 1
    fi
    reboot_result="$(chroot /host systemctl show -p Result --value studio-brain-reboot-watch.service)"
    if [ "${reboot_result}" != "success" ]; then
      chroot /host journalctl -u studio-brain-reboot-watch.service -n 20 --no-pager
      exit 1
    fi
    chroot /host systemctl show -p ActiveState -p SubState -p Result studio-brain-backup.service
    chroot /host systemctl show -p ActiveState -p SubState -p Result studio-brain-healthcheck.service
    chroot /host systemctl show -p ActiveState -p SubState -p Result studio-brain-reboot-watch.service
  '
