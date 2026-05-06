#!/usr/bin/env bash
set -u

# Read-only time synchronization posture for Studio Brain hosts.
# This script does not change clocks, restart time services, or edit NTP configuration.

section() {
  printf '\n## %s\n' "$1"
}

run_shell() {
  printf '\n$ %s\n' "$1"
  bash -lc "$1" 2>&1 || printf 'WARN: command failed: %s\n' "$1"
}

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'scope: read_only_time_sync_posture\n'
printf 'safety: no_clock_changes_no_service_restarts_no_config_changes\n'

section "Clock Snapshot"
run_shell "date"
run_shell "date -u"
run_shell "timedatectl status --no-pager 2>/dev/null || true"

section "Time Sync Services"
run_shell "systemctl show systemd-timesyncd.service chrony.service chronyd.service ntp.service --no-pager -p Id -p LoadState -p ActiveState -p SubState -p Result -p ExecMainStatus -p UnitFileState 2>/dev/null || true"
run_shell "systemctl list-units '*time*' '*chrony*' '*ntp*' --no-pager 2>/dev/null | sed -n '1,160p' || true"

section "Time Sources"
run_shell "timedatectl timesync-status --no-pager 2>/dev/null || true"
run_shell "chronyc tracking 2>/dev/null || true"
run_shell "chronyc sources -v 2>/dev/null || true"
run_shell "ntpq -p 2>/dev/null || true"

section "Recent Time Sync Logs"
run_shell "journalctl -u systemd-timesyncd.service -u chrony.service -u chronyd.service -u ntp.service --since '14 days ago' --no-pager | grep -Ei 'sync|time|offset|fail|error|step|slew' | tail -n 160 || true"

section "Decision Matrix"
cat <<'EOF'
| Finding | Evidence | Approval gate |
| --- | --- | --- |
| clock not synchronized | timedatectl status, service state, recent logs | service restart or config edit |
| high offset/jitter | chrony/ntp source output, logs | source change, package install, service restart |
| missing time sync service | systemctl list output | package install or enablement |
EOF
