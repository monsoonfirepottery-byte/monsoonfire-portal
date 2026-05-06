#!/usr/bin/env bash
set -u

# Read-only apt, OOM, reboot, SSH, and firewall posture for Studio Brain hosts.
# This script does not run apt update/upgrade, edit firewall/SSH settings, or reset services.

SINCE="${SINCE:-30 days ago}"

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
printf 'scope: read_only_package_oom_ssh_firewall_posture\n'
printf 'since: %s\n' "${SINCE}"
printf 'safety: no_apt_changes_no_firewall_changes_no_ssh_changes_no_reboots\n'

section "Resource Snapshot"
run_shell "uptime"
run_shell "free -h"
run_shell "swapon --show || true"
run_shell "ps -eo pid,ppid,user,stat,pcpu,pmem,rss,comm,args --sort=-rss | head -n 25"

section "OOM Trend"
run_shell "journalctl -k --since '${SINCE}' --no-pager | grep -Ei 'out of memory|oom-kill|oom killer|killed process|invoked oom-killer' | tail -n 160 || true"
run_shell "journalctl --since '${SINCE}' --no-pager | grep -Ei 'apt|unattended|dpkg|oom|killed process' | tail -n 160 || true"

section "Apt Package Posture"
run_shell "test -f /var/run/reboot-required && { echo reboot_required=yes; cat /var/run/reboot-required.pkgs 2>/dev/null || true; } || echo reboot_required=no"
run_shell "apt list --upgradable 2>/dev/null | awk 'NR>1 {count++; split(\$1, parts, \"/\"); print \"upgradable_package=\" parts[1]} END {print \"upgradable_count=\" count+0}' | sort"
run_shell "apt-mark showhold 2>/dev/null | sed 's/^/held_package=/' || true"
run_shell "systemctl show apt-daily.service apt-daily-upgrade.service unattended-upgrades.service --no-pager -p Id -p ActiveState -p SubState -p Result -p ExecMainStatus -p NRestarts 2>/dev/null || true"

section "Apt Logs"
run_shell "for file in /var/log/unattended-upgrades/unattended-upgrades.log /var/log/unattended-upgrades/unattended-upgrades-dpkg.log /var/log/apt/history.log /var/log/apt/term.log /var/log/dpkg.log; do if [ -f \"\$file\" ]; then echo \"### \$file\"; tail -n 160 \"\$file\"; fi; done"

section "SSH Evidence Slots"
run_shell "ss -tnlp 2>/dev/null | grep -E ':(22|2222)\\b' || true"
run_shell "systemctl show ssh.service sshd.service --no-pager -p Id -p LoadState -p ActiveState -p SubState -p Result -p ExecMainStatus -p FragmentPath -p UnitFileState 2>/dev/null || true"
privileged_slot "Effective SSHD Configuration" "sshd -T | sort"
privileged_slot "SSH Auth Log Tail" "sh -lc 'for f in /var/log/auth.log /var/log/secure; do if [ -f \"\$f\" ]; then echo \"### \$f\"; tail -n 120 \"\$f\" | sed -E \"s/(from )[0-9a-fA-F:.]+/\\1REDACTED_IP/g\"; fi; done'"
privileged_slot "Fail2ban SSH Status" "fail2ban-client status sshd 2>/dev/null || true"

section "Firewall Evidence Slots"
run_shell "command -v ufw >/dev/null 2>&1 && ufw status verbose 2>/dev/null || echo 'ufw unavailable or privileged read required'"
run_shell "ss -tulpen 2>/dev/null | sed -n '1,160p' || true"
privileged_slot "UFW Numbered Verbose" "ufw status numbered verbose"
privileged_slot "NFT Ruleset" "nft list ruleset"
privileged_slot "IPTables Summary" "sh -lc 'iptables -S 2>/dev/null; ip6tables -S 2>/dev/null'"

section "Operator Decision Matrix"
cat <<'EOF'
| Area | Read-only evidence | Approval gate |
| --- | --- | --- |
| apt OOM/package posture | OOM trend, apt logs, upgradable list, reboot-required marker | apt upgrade, package install/remove, reboot |
| SSH posture | listener, service state, effective sshd config | sshd config edit/reload, key/user changes |
| firewall posture | listeners, UFW/NFT/iptables evidence slots | rule add/remove/reload |
| fail2ban posture | jail status when available | jail config or ban/unban actions |
EOF
