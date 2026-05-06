#!/usr/bin/env bash
set -u

# Read-only Ubuntu failed-unit and apt/OOM triage for Studio Brain.
# This script does not reset units, disable services, install packages, run upgrades, or modify logs.

section() {
  printf '\n## %s\n' "$1"
}

run_shell() {
  printf '\n$ %s\n' "$1"
  bash -lc "$1" 2>&1 || printf 'WARN: command failed: %s\n' "$1"
}

unit_property() {
  local unit="$1"
  local property="$2"

  systemctl show "${unit}" --no-pager -p "${property}" 2>/dev/null | sed -n "s/^${property}=//p" | head -n 1
}

classify_unit() {
  local unit="$1"
  local type="$2"
  local active="$3"
  local sub="$4"
  local result="$5"
  local exec_status="$6"

  if [[ -z "${active}" ]]; then
    printf 'unknown_missing_or_unreadable'
    return 0
  fi

  if [[ "${active}" == "failed" || "${result}" == "failed" || "${result}" == "exit-code" || "${result}" == "oom-kill" ]]; then
    printf 'failed_requires_triage'
    return 0
  fi

  if [[ "${exec_status}" =~ ^[1-9][0-9]*$ ]]; then
    printf 'nonzero_exit_requires_triage'
    return 0
  fi

  if [[ "${active}" == "active" ]]; then
    printf 'running_ok'
    return 0
  fi

  if [[ "${type}" == "oneshot" && "${active}" == "inactive" && "${sub}" == "dead" && ( -z "${result}" || "${result}" == "success" ) ]]; then
    printf 'completed_oneshot_ok'
    return 0
  fi

  if [[ "${active}" == "inactive" && ( -z "${result}" || "${result}" == "success" ) ]]; then
    printf 'inactive_ok'
    return 0
  fi

  printf 'review_unknown_state'
  printf '' >/dev/null # keep shellcheck-style linters from treating unit as unused in older shells
}

unit_disposition() {
  local unit="$1"
  local classification="$2"

  case "${classification}" in
    completed_oneshot_ok|inactive_ok|running_ok)
      printf 'observe_only'
      ;;
    failed_requires_triage|nonzero_exit_requires_triage)
      case "${unit}" in
        apt-daily-upgrade.service|unattended-upgrades.service)
          printf 'supervised_update_window'
          ;;
        dailyaidecheck.service)
          printf 'repair_or_document_aide_posture'
          ;;
        snap.canonical-livepatch.canonical-livepatchd.service)
          printf 'privileged_livepatch_read_needed'
          ;;
        systemd-networkd-wait-online.service)
          printf 'network_online_dependency_review'
          ;;
        *)
          printf 'operator_triage_needed'
          ;;
      esac
      ;;
    *)
      printf 'operator_review_needed'
      ;;
  esac
}

unit_approval_gate() {
  local unit="$1"
  local classification="$2"

  if [[ "${classification}" == "completed_oneshot_ok" || "${classification}" == "inactive_ok" || "${classification}" == "running_ok" ]]; then
    printf 'none_for_read_only_observation'
    return 0
  fi

  case "${unit}" in
    apt-daily-upgrade.service|unattended-upgrades.service)
      printf 'package_changes_or_reboot_require_approval'
      ;;
    dailyaidecheck.service)
      printf 'disable_or_reconfigure_integrity_checks_requires_approval'
      ;;
    snap.canonical-livepatch.canonical-livepatchd.service)
      printf 'livepatch_registration_or_disable_requires_approval'
      ;;
    systemd-networkd-wait-online.service)
      printf 'network_manager_or_dependency_changes_require_approval'
      ;;
    *)
      printf 'service_changes_require_approval'
      ;;
  esac
}

classifier_row() {
  local unit="$1"
  local type active sub result exec_status classification disposition gate

  type="$(unit_property "${unit}" Type)"
  active="$(unit_property "${unit}" ActiveState)"
  sub="$(unit_property "${unit}" SubState)"
  result="$(unit_property "${unit}" Result)"
  exec_status="$(unit_property "${unit}" ExecMainStatus)"
  classification="$(classify_unit "${unit}" "${type}" "${active}" "${sub}" "${result}" "${exec_status}")"
  disposition="$(unit_disposition "${unit}" "${classification}")"
  gate="$(unit_approval_gate "${unit}" "${classification}")"

  printf '| `%s` | `%s` | `%s/%s` | `%s` | `%s` | `%s` | `%s` |\n' \
    "${unit}" \
    "${classification}" \
    "${active:-unknown}" \
    "${sub:-unknown}" \
    "${result:-none}" \
    "${exec_status:-none}" \
    "${disposition}" \
    "${gate}"
}

classifier_summary() {
  local units=(
    "apt-daily-upgrade.service"
    "unattended-upgrades.service"
    "dailyaidecheck.service"
    "snap.canonical-livepatch.canonical-livepatchd.service"
    "systemd-networkd-wait-online.service"
  )
  local unit

  if ! command -v systemctl >/dev/null 2>&1; then
    printf 'systemctl unavailable\n'
    return 0
  fi

  while IFS= read -r unit; do
    [[ -n "${unit}" ]] && units+=("${unit}")
  done < <(systemctl list-units --type=service --state=failed --no-legend --plain 2>/dev/null | awk '{print $1}')

  printf '| Unit | Classification | State | Result | Exec status | Disposition | Approval gate |\n'
  printf '| --- | --- | --- | --- | --- | --- | --- |\n'

  declare -A seen=()
  for unit in "${units[@]}"; do
    if [[ -n "${seen[${unit}]+x}" ]]; then
      continue
    fi
    seen["${unit}"]=1
    classifier_row "${unit}"
  done
}

unit_report() {
  local unit="$1"

  printf '\n### %s\n' "${unit}"
  if ! command -v systemctl >/dev/null 2>&1; then
    printf 'systemctl unavailable\n'
    return 0
  fi

  run_shell "systemctl status ${unit} --no-pager --lines=25"
  run_shell "systemctl show ${unit} --no-pager -p Id -p LoadState -p ActiveState -p SubState -p Result -p ExecMainStatus -p NRestarts -p FragmentPath -p UnitFileState"
  run_shell "journalctl -u ${unit} --since '14 days ago' --no-pager -n 120"
}

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'scope: read_only_failed_unit_and_apt_oom_triage\n'
printf 'safety: no_unit_resets_no_service_disables_no_package_changes\n'

section "Host Resource Snapshot"
run_shell "uptime"
run_shell "free -h"
run_shell "swapon --show"
run_shell "ps -eo pid,ppid,user,stat,pcpu,pmem,rss,comm,args --sort=-rss | head -n 25"

section "Reboot And Update Posture"
run_shell "test -f /var/run/reboot-required && { echo reboot_required=yes; cat /var/run/reboot-required.pkgs 2>/dev/null || true; } || echo reboot_required=no"
run_shell "apt list --upgradable 2>/dev/null | awk 'NR>1 && /upgradable from:/ {count++; split(\$1, parts, \"/\"); packages[parts[1]]=1} END {print \"upgradable_count=\" count+0; for (name in packages) print \"upgradable_package=\" name}' | sort"
run_shell "systemctl show apt-daily-upgrade.service --no-pager -p ActiveState -p SubState -p Result -p ExecMainStatus -p NRestarts"
run_shell "systemctl show unattended-upgrades.service --no-pager -p ActiveState -p SubState -p Result -p ExecMainStatus -p NRestarts"

section "Failed Units"
if command -v systemctl >/dev/null 2>&1; then
  run_shell "systemctl --failed --no-pager"
  run_shell "systemctl list-units --type=service --state=failed --no-legend --plain | awk '{print \$1}'"
else
  printf 'systemctl unavailable\n'
fi

section "Failed Unit Classifier"
classifier_summary

section "Known Studio Brain Ops Units"
unit_report "apt-daily-upgrade.service"
unit_report "unattended-upgrades.service"
unit_report "dailyaidecheck.service"
unit_report "snap.canonical-livepatch.canonical-livepatchd.service"
unit_report "systemd-networkd-wait-online.service"

section "OOM Evidence"
run_shell "journalctl -k --since '14 days ago' --no-pager | grep -Ei 'out of memory|oom-kill|killed process|invoked oom-killer' || true"
run_shell "journalctl -u apt-daily-upgrade.service --since '14 days ago' --no-pager | grep -Ei 'oom|killed|memory|unattended|error|fail' || true"

section "Apt And Unattended Upgrade State"
run_shell "test -f /var/run/reboot-required && { echo reboot_required=yes; cat /var/run/reboot-required.pkgs 2>/dev/null || true; } || echo reboot_required=no"
run_shell "systemctl is-enabled unattended-upgrades.service 2>/dev/null || true"
run_shell "systemctl is-active unattended-upgrades.service 2>/dev/null || true"
run_shell "apt list --upgradable 2>/dev/null | sed -n '1,120p'"
run_shell "test -f /etc/apt/apt.conf.d/20auto-upgrades && sed -n '1,120p' /etc/apt/apt.conf.d/20auto-upgrades || true"
run_shell "test -f /etc/apt/apt.conf.d/50unattended-upgrades && sed -n '1,180p' /etc/apt/apt.conf.d/50unattended-upgrades | sed -E 's#//.*##' || true"

section "Apt Logs"
run_shell "for file in /var/log/unattended-upgrades/unattended-upgrades.log /var/log/unattended-upgrades/unattended-upgrades-dpkg.log /var/log/apt/history.log /var/log/apt/term.log /var/log/dpkg.log; do if [ -f \"\$file\" ]; then echo \"### \$file\"; tail -n 160 \"\$file\"; fi; done"

section "AIDE And Livepatch Readiness"
run_shell "command -v aide >/dev/null 2>&1 && aide --version | head -n 5 || echo 'aide command unavailable'"
run_shell "command -v canonical-livepatch >/dev/null 2>&1 && canonical-livepatch status || echo 'canonical-livepatch command unavailable'"

section "Disposition Worklist"
cat <<'EOF'
Use this table to convert evidence into an operator decision. Do not reset, disable, or upgrade from this report alone.

| Unit or area | Decision needed | Evidence to attach | Approval gate |
| --- | --- | --- | --- |
| apt-daily-upgrade.service | repair unattended upgrade OOM or move updates to supervised window | OOM evidence, apt logs, pending package list | package changes require approval |
| dailyaidecheck.service | repair AIDE database/config or intentionally disable with reason | unit journal, aide version/config path | disabling integrity checks requires approval |
| snap.canonical-livepatch.canonical-livepatchd.service | repair livepatch or document unsupported host posture | unit journal, livepatch status | disabling livepatch requires approval |
| systemd-networkd-wait-online.service | repair network-online dependency or document harmless boot noise | unit journal, network stack facts | disabling boot dependency requires approval |
| pending packages | schedule maintenance window with rollback notes | apt list, reboot-required state, pre/post health checklist | upgrades require approval |
EOF

section "Maintenance Window Checklist"
cat <<'EOF'
Pre-checks:
- capture `make ops-ubuntu-review`
- capture `make ops-backup-evidence`
- capture Studio Brain `/healthz`, `/readyz`, and `/health/dependencies`
- capture Docker health with `make ops-docker-review`
- confirm SSH access from a second shell
- confirm rollback notes for kernel/Docker/systemd packages

Approved execution only:
- run package updates in a supervised shell
- avoid unattended rerun if OOM cause remains unexplained
- reboot only with approval and post-check owner present

Post-checks:
- `systemctl --failed --no-pager`
- `journalctl -k --since "1 hour ago" | grep -Ei "oom|killed process|error|fail"`
- Studio Brain `/healthz`, `/readyz`, and `/health/dependencies`
- Docker container health
- backup evidence freshness
EOF
