#!/usr/bin/env bash
set -u

# Root-friendly, read-only Studio Brain privileged evidence capture.
# Intended install path: /usr/local/sbin/studio-brain-ops-capture
#
# Safety contract:
# - no service restarts
# - no package changes
# - no firewall/SSH/user/sudoers changes
# - no Docker prune/delete/restart
# - no database writes
# - no environment dumps
#
# The script writes redacted evidence artifacts and updates a latest pointer.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." 2>/dev/null && pwd || pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="privileged-evidence-${STAMP}-$$"
OUTPUT_ROOT=""
SMOKE=0
NO_LATEST=0
SUMMARY_ROWS=()
REPORT_TIMEOUT_SECONDS="${STUDIO_BRAIN_OPS_CAPTURE_TIMEOUT_SECONDS:-45}"

usage() {
  cat <<'EOF'
Studio Brain privileged evidence capture

Usage:
  studio-brain-ops-capture
  bash scripts/ops/privileged_evidence_capture.sh [--output-dir <path>] [--run-id <id>] [--smoke] [--no-latest]

Options:
  --output-dir <path>  Evidence root. Default: /var/lib/studio-brain/ops-evidence when root,
                       otherwise output/ops/privileged-evidence in this repo.
  --run-id <id>        Stable run directory name.
  --smoke              Fast local smoke that skips privileged-heavy sections.
  --no-latest          Do not update latest symlink/path pointer.
  -h, --help           Show this help.

This script is read-only except for writing its own evidence artifacts.
EOF
}

require_value() {
  local option="$1"
  local value="${2:-}"
  if [ -z "${value}" ] || [ "${value#--}" != "${value}" ]; then
    printf 'Missing value for %s\n' "${option}" >&2
    usage >&2
    exit 2
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir)
      require_value "$1" "${2:-}"
      OUTPUT_ROOT="$2"
      shift 2
      ;;
    --output-dir=*)
      OUTPUT_ROOT="${1#*=}"
      shift
      ;;
    --run-id)
      require_value "$1" "${2:-}"
      RUN_ID="$2"
      shift 2
      ;;
    --run-id=*)
      RUN_ID="${1#*=}"
      shift
      ;;
    --smoke)
      SMOKE=1
      shift
      ;;
    --no-latest)
      NO_LATEST=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "${OUTPUT_ROOT}" ]; then
  if [ "$(id -u 2>/dev/null || printf 1)" = "0" ]; then
    OUTPUT_ROOT="${STUDIO_BRAIN_PRIVILEGED_EVIDENCE_DIR:-/var/lib/studio-brain/ops-evidence}"
  else
    OUTPUT_ROOT="${REPO_ROOT}/output/ops/privileged-evidence"
  fi
fi

safe_run_id="$(printf '%s' "${RUN_ID}" | tr -c 'A-Za-z0-9._-' '-' | sed -E 's/^-+//; s/-+$//' | cut -c1-96)"
if [ -z "${safe_run_id}" ]; then
  safe_run_id="privileged-evidence-${STAMP}-$$"
fi

RUN_DIR="${OUTPUT_ROOT}/${safe_run_id}"
if [ -e "${RUN_DIR}" ]; then
  printf 'Refusing to overwrite existing evidence run directory: %s\n' "${RUN_DIR}" >&2
  exit 1
fi

mkdir -p "${RUN_DIR}" || {
  printf 'Could not create evidence run directory: %s\n' "${RUN_DIR}" >&2
  exit 1
}
chmod 0750 "${RUN_DIR}" 2>/dev/null || true

json_string() {
  local value="${1:-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '"%s"' "${value}"
}

sanitize_stream() {
  sed -E \
    -e 's/([Aa]uthorization:?[[:space:]]*Bearer[[:space:]]+)[^[:space:]]+/\1[redacted]/g' \
    -e 's/([Cc]ookie:?[[:space:]]*)[^[:space:]]+/\1[redacted]/g' \
    -e 's/([Tt]oken["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Pp]assword["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Ss]ecret["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/(api[_-]?key["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/Ig' \
    -e 's/([A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+/[jwt-redacted]/g'
}

append_summary_row() {
  local label="$1"
  local file="$2"
  local exit_code="$3"
  local status="$4"
  local bytes="0"

  if [ -f "${RUN_DIR}/${file}" ]; then
    bytes="$(wc -c <"${RUN_DIR}/${file}" | tr -d '[:space:]')"
  fi

  SUMMARY_ROWS+=("$(printf '{"label":%s,"file":%s,"status":%s,"exitCode":%s,"bytes":%s}' \
    "$(json_string "${label}")" \
    "$(json_string "${file}")" \
    "$(json_string "${status}")" \
    "${exit_code}" \
    "${bytes}")")
}

run_to_file() {
  local label="$1"
  shift
  local exit_code=0
  local raw_file="${RUN_DIR}/.${label}.raw"

  printf 'writing %s\n' "${RUN_DIR}/${label}.txt"
  {
    printf '# %s\n' "${label}"
    printf '# generated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# scope=read_only_privileged_evidence_capture\n\n'
    if command -v timeout >/dev/null 2>&1 && [ -n "${REPORT_TIMEOUT_SECONDS}" ] && [ "${REPORT_TIMEOUT_SECONDS}" != "0" ]; then
      timeout --preserve-status "${REPORT_TIMEOUT_SECONDS}" "$@" 2>&1
    else
      "$@" 2>&1
    fi
    exit_code="$?"
    printf '\n# exit_code=%s\n' "${exit_code}"
  } >"${raw_file}" 2>&1

  sanitize_stream <"${raw_file}" >"${RUN_DIR}/${label}.txt" 2>&1
  rm -f "${raw_file}" 2>/dev/null || true

  if [ "${exit_code}" -eq 0 ]; then
    append_summary_row "${label}" "${label}.txt" "${exit_code}" "ok"
  else
    append_summary_row "${label}" "${label}.txt" "${exit_code}" "check_failed"
  fi
}

write_command_file() {
  local label="$1"
  local command_text="$2"
  run_to_file "${label}" bash -lc "${command_text}"
}

write_skipped_report() {
  local label="$1"
  shift
  printf 'writing %s\n' "${RUN_DIR}/${label}.txt"
  {
    printf '# %s\n' "${label}"
    printf '# generated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# scope=read_only_privileged_evidence_capture\n\n'
    printf '%s\n' "$@"
    printf '\n# exit_code=0\n'
  } | sanitize_stream >"${RUN_DIR}/${label}.txt" 2>&1
  append_summary_row "${label}" "${label}.txt" "0" "skipped"
}

write_summary_json() {
  local summary_path="${RUN_DIR}/summary.json"
  printf 'writing %s\n' "${summary_path}"
  {
    printf '{\n'
    printf '  "schema": "studio-brain-privileged-evidence.summary.v1",\n'
    printf '  "generatedAt": %s,\n' "$(json_string "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
    printf '  "runId": %s,\n' "$(json_string "${safe_run_id}")"
    printf '  "scope": "read_only_privileged_evidence_capture",\n'
    printf '  "outputDir": %s,\n' "$(json_string "${RUN_DIR}")"
    printf '  "effectiveUid": %s,\n' "$(json_string "$(id -u 2>/dev/null || printf unknown)")"
    printf '  "effectiveUser": %s,\n' "$(json_string "$(id -un 2>/dev/null || printf unknown)")"
    printf '  "smoke": %s,\n' "$(json_string "${SMOKE}")"
    printf '  "redaction": "tokens_cookies_passwords_secrets_api_keys_jwts",\n'
    printf '  "safety": "no_restarts_no_prune_no_package_changes_no_firewall_changes_no_db_writes",\n'
    printf '  "reportTimeoutSeconds": %s,\n' "$(json_string "${REPORT_TIMEOUT_SECONDS}")"
    printf '  "reports": [\n'
    local idx
    for idx in "${!SUMMARY_ROWS[@]}"; do
      if [ "${idx}" -gt 0 ]; then
        printf ',\n'
      fi
      printf '    %s' "${SUMMARY_ROWS[$idx]}"
    done
    printf '\n  ]\n'
    printf '}\n'
  } >"${summary_path}"
}

update_latest_pointer() {
  if [ "${NO_LATEST}" = "1" ]; then
    return 0
  fi

  mkdir -p "${OUTPUT_ROOT}" 2>/dev/null || return 0
  local latest_tmp="${OUTPUT_ROOT}/latest.tmp.$$"
  if ln -sfn "${safe_run_id}" "${latest_tmp}" 2>/dev/null && mv -Tf "${latest_tmp}" "${OUTPUT_ROOT}/latest" 2>/dev/null; then
    rm -f "${OUTPUT_ROOT}/latest.path" 2>/dev/null || true
    printf 'latest_pointer=symlink:%s/latest\n' "${OUTPUT_ROOT}" >"${RUN_DIR}/latest-pointer.txt"
  else
    printf '%s\n' "${RUN_DIR}" >"${OUTPUT_ROOT}/latest.path" 2>/dev/null || true
    rm -f "${latest_tmp}" 2>/dev/null || true
    rmdir "${latest_tmp}" 2>/dev/null || true
    printf 'latest_pointer=path-file:%s/latest.path\n' "${OUTPUT_ROOT}" >"${RUN_DIR}/latest-pointer.txt"
  fi
}

write_command_file capture_metadata "printf 'hostname='; hostname 2>/dev/null || true; printf 'date='; date -Is 2>/dev/null || date -u; printf 'kernel='; uname -a 2>/dev/null || true; printf 'uid='; id -u 2>/dev/null || true; printf 'user='; id -un 2>/dev/null || true; printf 'groups='; id -Gn 2>/dev/null || true"
write_command_file versions "command -v systemctl >/dev/null 2>&1 && systemctl --version | head -n 2 || true; command -v journalctl >/dev/null 2>&1 && journalctl --version | head -n 2 || true; command -v docker >/dev/null 2>&1 && docker version || true; command -v ufw >/dev/null 2>&1 && ufw version || true; command -v nft >/dev/null 2>&1 && nft --version || true; command -v sshd >/dev/null 2>&1 && sshd -V 2>&1 || true"

if [ "${SMOKE}" = "1" ]; then
  write_skipped_report privileged_sections "smoke mode enabled; privileged-heavy captures skipped"
  write_summary_json
  update_latest_pointer
  cat >"${RUN_DIR}/README.md" <<EOF
# Studio Brain Privileged Evidence Capture Smoke

Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Scope: fast smoke for artifact creation and redaction plumbing.
EOF
  printf 'privileged evidence smoke written to %s\n' "${RUN_DIR}"
  exit 0
fi

write_command_file resource_pressure "uptime 2>/dev/null || true; free -h 2>/dev/null || true; swapon --show 2>/dev/null || true; df -hT 2>/dev/null || true; df -ih 2>/dev/null || true"
write_command_file disk_hotspots "for path in / /home /home/wuff /var /var/log /var/backups /var/lib/docker /tmp; do if [ -e \"\$path\" ]; then echo \"## \$path\"; du -xhd1 \"\$path\" 2>/dev/null | sort -h | tail -n 80 || true; fi; done"
write_command_file process_pressure "ps -eo pid,ppid,user,stat,pcpu,pmem,rss,etime,args --sort=-pcpu 2>/dev/null | head -60 || true"

write_command_file systemd_failed_units "systemctl --failed --no-pager 2>/dev/null || true; systemctl list-units --state=failed --no-pager 2>/dev/null || true"
write_command_file systemd_timers "systemctl list-timers --all --no-pager 2>/dev/null | sed -n '1,220p' || true"
write_command_file systemd_selected_units "for unit in dailyaidecheck.service snap.canonical-livepatch.canonical-livepatchd.service systemd-networkd-wait-online.service apt-daily.service apt-daily-upgrade.service unattended-upgrades.service docker.service studio-brain-backup.service studio-brain-healthcheck.service studio-brain-idle-worker.service studio-brain-idle-worker-overnight.service studio-brain-mission-control.service; do echo \"## \$unit\"; systemctl show \"\$unit\" --no-pager -p Id -p LoadState -p ActiveState -p SubState -p Result -p ExecMainStatus -p NRestarts -p FragmentPath -p UnitFileState 2>/dev/null || true; done"
write_command_file selected_unit_journals "for unit in dailyaidecheck.service snap.canonical-livepatch.canonical-livepatchd.service systemd-networkd-wait-online.service apt-daily-upgrade.service unattended-upgrades.service docker.service studio-brain-backup.service studio-brain-healthcheck.service studio-brain-idle-worker.service studio-brain-idle-worker-overnight.service studio-brain-mission-control.service; do echo \"## \$unit\"; journalctl -u \"\$unit\" --since '14 days ago' -n 180 --no-pager -l 2>/dev/null | sed -E 's/(from )[0-9a-fA-F:.]+/\\1REDACTED_IP/g' || true; done"
write_command_file kernel_oom_journal "journalctl -k --since '30 days ago' --no-pager 2>/dev/null | grep -Ei 'out of memory|oom-kill|oom killer|killed process|invoked oom-killer' | tail -n 220 || true"

write_command_file reboot_package_posture "test -f /var/run/reboot-required && { echo reboot_required=yes; cat /var/run/reboot-required.pkgs 2>/dev/null || true; } || echo reboot_required=no; apt list --upgradable 2>/dev/null | awk 'NR>1 {count++; split(\$1, parts, \"/\"); print \"upgradable_package=\" parts[1]} END {print \"upgradable_count=\" count+0}' | sort; apt-mark showhold 2>/dev/null | sed 's/^/held_package=/' || true"
write_command_file apt_logs "for file in /var/log/unattended-upgrades/unattended-upgrades.log /var/log/unattended-upgrades/unattended-upgrades-dpkg.log /var/log/apt/history.log /var/log/apt/term.log /var/log/dpkg.log; do if [ -f \"\$file\" ]; then echo \"### \$file\"; tail -n 180 \"\$file\"; fi; done"

write_command_file network_listeners "(ss -tulpen 2>/dev/null || ss -tuln 2>/dev/null || true) | sed -E 's/pid=[0-9]+/pid=REDACTED/g' | sed -n '1,240p'"
write_command_file firewall_posture "command -v ufw >/dev/null 2>&1 && ufw status numbered verbose 2>/dev/null || echo 'ufw unavailable or unreadable'; command -v nft >/dev/null 2>&1 && nft list ruleset 2>/dev/null | sed -n '1,260p' || true; command -v iptables-save >/dev/null 2>&1 && iptables-save 2>/dev/null | sed -n '1,220p' || true; command -v ip6tables-save >/dev/null 2>&1 && ip6tables-save 2>/dev/null | sed -n '1,220p' || true"
write_command_file ssh_posture "command -v sshd >/dev/null 2>&1 && sshd -T 2>/dev/null | awk '/^(port|listenaddress|passwordauthentication|kbdinteractiveauthentication|challengeresponseauthentication|pubkeyauthentication|permitrootlogin|authenticationmethods|allowusers|allowgroups|usepam|maxauthtries|logingracetime|clientaliveinterval|clientalivecountmax)[[:space:]]/ {print}' | sort || echo 'sshd -T unavailable'; for f in /var/log/auth.log /var/log/secure; do if [ -f \"\$f\" ]; then echo \"### \$f\"; tail -n 160 \"\$f\" | sed -E 's/(from )[0-9a-fA-F:.]+/\\1REDACTED_IP/g'; fi; done; command -v fail2ban-client >/dev/null 2>&1 && { fail2ban-client status 2>/dev/null || true; fail2ban-client status sshd 2>/dev/null || true; } || true"
write_command_file time_sync_posture "timedatectl status --no-pager 2>/dev/null || true; timedatectl timesync-status --no-pager 2>/dev/null || true; command -v chronyc >/dev/null 2>&1 && { chronyc tracking 2>/dev/null || true; chronyc sources -v 2>/dev/null || true; } || true; command -v ntpq >/dev/null 2>&1 && ntpq -p 2>/dev/null || true"

write_command_file docker_metadata "if command -v docker >/dev/null 2>&1; then docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.ID}}'; docker system df 2>/dev/null || true; docker compose ls 2>/dev/null || true; for id in \$(docker ps -aq 2>/dev/null); do docker inspect -f '{{.Name}} image={{.Config.Image}} user={{if .Config.User}}{{.Config.User}}{{else}}default_image_user{{end}} privileged={{.HostConfig.Privileged}} log_driver={{.HostConfig.LogConfig.Type}} restart={{.HostConfig.RestartPolicy.Name}} health={{if .Config.Healthcheck}}present{{else}}missing{{end}}' \"\$id\"; done; else echo 'docker unavailable'; fi"
write_command_file docker_privileged_sizes "if command -v docker >/dev/null 2>&1; then find /var/lib/docker/containers -name '*-json.log' -printf '%s %p\n' 2>/dev/null | sort -n | tail -n 80 || true; root=\$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true); if [ -n \"\$root\" ] && [ -d \"\$root\" ]; then du -xhd1 \"\$root\" 2>/dev/null | sort -h | tail -n 80 || true; fi; else echo 'docker unavailable'; fi"
write_command_file backup_artifacts "for path in /var/backups/studio-brain /home/wuff/backups /home/wuff/imports; do if [ -e \"\$path\" ]; then echo \"## \$path\"; find \"\$path\" -maxdepth 3 -type f -printf '%TY-%Tm-%TdT%TH:%TM:%TSZ %s %p\n' 2>/dev/null | sort -r | head -n 200 || true; else echo \"missing_path=\$path\"; fi; done"

write_summary_json
update_latest_pointer

cat >"${RUN_DIR}/README.md" <<EOF
# Studio Brain Privileged Evidence Capture

Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Scope: read-only privileged host evidence. Review artifacts before sharing outside ops.

Primary files:

- \`summary.json\`
- \`systemd_failed_units.txt\`
- \`selected_unit_journals.txt\`
- \`firewall_posture.txt\`
- \`ssh_posture.txt\`
- \`docker_privileged_sizes.txt\`
- \`backup_artifacts.txt\`

Unsafe actions still requiring separate approval:

- service restarts
- package upgrades
- firewall, SSH, sudoers, or user changes
- Docker prune/delete/restart/recreate
- database schema changes or restores over production
- secret rotation
- deleting logs, backups, imports, temp files, or generated artifacts
EOF

printf 'privileged evidence capture written to %s\n' "${RUN_DIR}"
