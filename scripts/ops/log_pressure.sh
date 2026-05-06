#!/usr/bin/env bash
set -u

# Read-only log pressure snapshot. Does not print log contents.

section() {
  printf '\n## %s\n' "$1"
}

run_shell() {
  printf '\n$ %s\n' "$1"
  bash -lc "$1" 2>&1 || printf 'WARN: command failed: %s\n' "$1"
}

section "Systemd Journal Size"
run_shell "journalctl --disk-usage 2>/dev/null || true"

section "Log Directory Sizes"
run_shell "(sudo -n du -sh /var/log /var/log/* 2>/dev/null || du -sh /var/log /var/log/* 2>/dev/null || true) | sort -h | tail -n 60"

section "Docker Json Log Sizes"
run_shell "sudo -n find /var/lib/docker/containers -name '*-json.log' -printf '%s %p\n' 2>/dev/null | sort -n | tail -n 40 || echo 'docker log paths require sudo or are unavailable'"

section "Recent OOM Markers"
run_shell "journalctl -k --since '14 days ago' --no-pager 2>/dev/null | grep -Ei 'out of memory|oom-kill|killed process' || true"
