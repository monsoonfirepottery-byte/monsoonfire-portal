#!/usr/bin/env bash
set -u

# Read-only disk pressure snapshot. Uses sudo only when passwordless sudo is already available.
OPS_COMMAND_TIMEOUT_SECONDS="${OPS_COMMAND_TIMEOUT_SECONDS:-30}"

section() {
  printf '\n## %s\n' "$1"
}

run_shell() {
  printf '\n$ %s\n' "$1"
  if command -v timeout >/dev/null 2>&1; then
    timeout "${OPS_COMMAND_TIMEOUT_SECONDS}" bash -lc "$1" 2>&1 || printf 'WARN: command failed or timed out after %ss: %s\n' "${OPS_COMMAND_TIMEOUT_SECONDS}" "$1"
  else
    bash -lc "$1" 2>&1 || printf 'WARN: command failed: %s\n' "$1"
  fi
}

section "Filesystems"
run_shell "df -hT"
run_shell "df -ih"

section "Top-Level Pressure"
run_shell "(sudo -n du -sh /home /home/* /var/lib/docker /var/backups /var/log /tmp 2>/dev/null || du -sh /home /home/* /var/log /tmp 2>/dev/null || true) | sort -h"

section "Home Directory Detail"
run_shell "(sudo -n du -xhd1 /home 2>/dev/null || du -xhd1 /home 2>/dev/null || true) | sort -h | tail -n 40"

section "Docker Directory Detail"
run_shell "sudo -n du -xhd1 /var/lib/docker 2>/dev/null | sort -h | tail -n 40 || echo 'docker directory requires sudo or is unavailable'"
