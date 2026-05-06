#!/usr/bin/env bash
set -u

# Read-only Studio Brain host inventory. Does not print process environments.

section() {
  printf '\n## %s\n' "$1"
}

run() {
  printf '\n$ %s\n' "$*"
  "$@" 2>&1 || printf 'WARN: command failed: %s\n' "$*"
}

run_shell() {
  printf '\n$ %s\n' "$1"
  bash -lc "$1" 2>&1 || printf 'WARN: command failed: %s\n' "$1"
}

section "Identity"
run hostname
run date -Is
run whoami
run id

section "OS"
run_shell "grep -E '^(PRETTY_NAME|VERSION_ID|ID)=' /etc/os-release || true"
run uname -a

section "Resources"
run uptime
run free -h
run swapon --show

section "Filesystems"
run df -hT
run df -ih

section "Package State"
run_shell "test -f /var/run/reboot-required && { echo reboot_required=yes; cat /var/run/reboot-required.pkgs 2>/dev/null || true; } || echo reboot_required=no"
run_shell "apt list --upgradable 2>/dev/null | sed -n '1,80p'"

section "Systemd Failed Units"
if command -v systemctl >/dev/null 2>&1; then
  run systemctl --failed --no-pager
else
  echo "systemctl not available"
fi

section "Studio Brain Units And Timers"
if command -v systemctl >/dev/null 2>&1; then
  run_shell "systemctl list-units --type=service --type=timer --all --no-pager | grep -Ei 'studio|brain|postgres|docker|redis|minio|mission|backup|health|disk|reboot|cron|ssh|caddy|nginx' || true"
  run_shell "systemctl list-timers --all --no-pager | grep -Ei 'studio|brain|backup|health|disk|reboot|apt|logrotate' || true"
else
  echo "systemctl not available"
fi

section "Open Listening Ports"
run_shell "(sudo -n ss -tulpen 2>/dev/null || ss -tulpen) | sed -n '1,160p'"

section "Docker Summary"
if command -v docker >/dev/null 2>&1; then
  run docker version
  run docker compose version
  run docker ps
  run docker system df
else
  echo "docker not available"
fi
