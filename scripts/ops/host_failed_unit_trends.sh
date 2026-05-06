#!/usr/bin/env bash
set -u

# Read-only failed-unit trend and privileged-read checklist for Studio Brain hosts.
# This script does not reset units, edit systemd files, install packages, or change host posture.

SINCE="${SINCE:-30 days ago}"
UNITS="${UNITS:-apt-daily-upgrade.service unattended-upgrades.service dailyaidecheck.service snap.canonical-livepatch.canonical-livepatchd.service systemd-networkd-wait-online.service}"

section() {
  printf '\n## %s\n' "$1"
}

run_shell() {
  printf '\n$ %s\n' "$1"
  bash -lc "$1" 2>&1 || printf 'WARN: command failed: %s\n' "$1"
}

privileged_slot() {
  local label="$1"
  local command_text="$2"

  printf '\n### %s\n' "${label}"
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    run_shell "sudo -n ${command_text}"
  else
    printf 'status: approval_gated\n'
    printf 'reason: privileged read requires an approved sudo-capable shell\n'
    printf 'command: sudo %s\n' "${command_text}"
  fi
}

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'scope: read_only_failed_unit_trends_and_privileged_checklists\n'
printf 'since: %s\n' "${SINCE}"
printf 'safety: no_unit_resets_no_service_changes_no_package_changes\n'

section "Current Failed Units"
if command -v systemctl >/dev/null 2>&1; then
  run_shell "systemctl --failed --no-pager"
  run_shell "systemctl list-units --type=service --state=failed --no-legend --plain | awk '{print \$1}' | sort"
else
  printf 'systemctl unavailable\n'
fi

section "Unit State Matrix"
printf '| Unit | Load | Active | Sub | Result | Exec status | Restarts | Unit file |\n'
printf '| --- | --- | --- | --- | --- | --- | --- | --- |\n'
if command -v systemctl >/dev/null 2>&1; then
  for unit in ${UNITS}; do
    load="$(systemctl show "${unit}" --no-pager -p LoadState 2>/dev/null | sed 's/^LoadState=//' || true)"
    active="$(systemctl show "${unit}" --no-pager -p ActiveState 2>/dev/null | sed 's/^ActiveState=//' || true)"
    sub="$(systemctl show "${unit}" --no-pager -p SubState 2>/dev/null | sed 's/^SubState=//' || true)"
    result="$(systemctl show "${unit}" --no-pager -p Result 2>/dev/null | sed 's/^Result=//' || true)"
    exec_status="$(systemctl show "${unit}" --no-pager -p ExecMainStatus 2>/dev/null | sed 's/^ExecMainStatus=//' || true)"
    restarts="$(systemctl show "${unit}" --no-pager -p NRestarts 2>/dev/null | sed 's/^NRestarts=//' || true)"
    unit_file="$(systemctl show "${unit}" --no-pager -p UnitFileState 2>/dev/null | sed 's/^UnitFileState=//' || true)"
    printf '| `%s` | `%s` | `%s` | `%s` | `%s` | `%s` | `%s` | `%s` |\n' \
      "${unit}" "${load:-unknown}" "${active:-unknown}" "${sub:-unknown}" "${result:-none}" "${exec_status:-none}" "${restarts:-unknown}" "${unit_file:-unknown}"
  done
else
  printf '| systemctl unavailable | unknown | unknown | unknown | unknown | unknown | unknown | unknown |\n'
fi

section "Failure Trend Events"
if command -v journalctl >/dev/null 2>&1; then
  for unit in ${UNITS}; do
    printf '\n### %s\n' "${unit}"
    run_shell "journalctl -u '${unit}' --since '${SINCE}' --no-pager | grep -Ei 'failed|failure|error|oom|killed|timeout|dependency|start request repeated|exit-code' | tail -n 80 || true"
  done
else
  printf 'journalctl unavailable\n'
fi

section "AIDE Readiness Checklist"
run_shell "command -v aide >/dev/null 2>&1 && aide --version | head -n 5 || echo 'aide command unavailable'"
run_shell "systemctl show dailyaidecheck.service --no-pager -p LoadState -p ActiveState -p SubState -p Result -p ExecMainStatus -p FragmentPath -p UnitFileState 2>/dev/null || true"
privileged_slot "AIDE Configuration And Database Metadata" "sh -lc 'for p in /etc/aide /etc/aide/aide.conf /var/lib/aide /var/lib/aide/aide.db /var/lib/aide/aide.db.gz; do if [ -e \"\$p\" ]; then ls -ld \"\$p\"; fi; done'"

section "Livepatch Readiness Checklist"
run_shell "command -v canonical-livepatch >/dev/null 2>&1 && canonical-livepatch status || echo 'canonical-livepatch command unavailable'"
run_shell "systemctl show snap.canonical-livepatch.canonical-livepatchd.service --no-pager -p LoadState -p ActiveState -p SubState -p Result -p ExecMainStatus -p FragmentPath -p UnitFileState 2>/dev/null || true"
privileged_slot "Livepatch Snap And Service Metadata" "sh -lc 'snap list canonical-livepatch 2>/dev/null || true; systemctl status snap.canonical-livepatch.canonical-livepatchd.service --no-pager --lines=30'"

section "Network Online Readiness Checklist"
run_shell "systemctl show systemd-networkd-wait-online.service --no-pager -p LoadState -p ActiveState -p SubState -p Result -p ExecMainStatus -p FragmentPath -p UnitFileState 2>/dev/null || true"
run_shell "systemctl list-dependencies --reverse systemd-networkd-wait-online.service --no-pager 2>/dev/null | sed -n '1,120p' || true"
run_shell "networkctl list --no-pager 2>/dev/null || true"
privileged_slot "Network Manager And Link Metadata" "sh -lc 'ip -brief addr; ip route; resolvectl status 2>/dev/null | sed -n \"1,120p\" || true'"

section "Disposition Packet"
cat <<'EOF'
| Area | Evidence slot | Approval gate |
| --- | --- | --- |
| failed units | trend events, state matrix, latest journal lines | unit reset/restart/disable requires approval |
| AIDE | config/database metadata, dailyaidecheck journal | disabling integrity checks requires approval |
| livepatch | canonical-livepatch status, snap metadata, unit journal | registration, disablement, or package changes require approval |
| network-online | reverse dependencies, link facts, journal | changing wait-online dependencies or network stack requires approval |
EOF
