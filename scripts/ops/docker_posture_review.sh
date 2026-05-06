#!/usr/bin/env bash
set -u

# Read-only Docker posture review for Studio Brain hosts.
# This script does not prune, pull, restart, recreate, delete, or edit Docker resources.

TARGET_REPO="${TARGET_REPO:-/home/wuff/monsoonfire-portal}"
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

compose_files_from_repo() {
  if [ -d "${TARGET_REPO}" ]; then
    find "${TARGET_REPO}" -maxdepth 4 \( -name 'docker-compose.yml' -o -name 'docker-compose.yaml' -o -name 'compose.yml' -o -name 'compose.yaml' \) 2>/dev/null | sort
  fi
}

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'host: %s\n' "$(hostname 2>/dev/null || printf unknown)"
printf 'target_repo: %s\n' "${TARGET_REPO}"
printf 'scope: read_only_docker_posture_review\n'
printf 'since: %s\n' "${SINCE}"
printf 'safety: no_prune_no_pull_no_restart_no_recreate_no_delete_no_secret_values\n'

if ! command -v docker >/dev/null 2>&1; then
  printf 'docker unavailable\n'
  exit 0
fi

section "Docker Runtime"
run_shell "docker version --format json 2>/dev/null || docker version"
run_shell "docker compose version 2>/dev/null || true"
run_shell "docker info --format 'DockerRootDir={{.DockerRootDir}} Driver={{.Driver}} CgroupDriver={{.CgroupDriver}} CgroupVersion={{.CgroupVersion}} LoggingDriver={{.LoggingDriver}}' 2>/dev/null || true"

section "Docker Root Growth Trend"
run_shell "docker system df"
run_shell "docker system df -v 2>/dev/null | sed -n '1,260p' || true"
run_shell "docker info --format '{{.DockerRootDir}}' 2>/dev/null | while read -r root; do if [ -n \"\$root\" ] && [ -d \"\$root\" ]; then du -sh \"\$root\" 2>/dev/null || true; du -sh \"\$root\"/* 2>/dev/null | sort -h | tail -n 40 || true; fi; done"
privileged_slot "Docker Root Directory Breakdown" "sh -lc 'root=\$(docker info --format \"{{.DockerRootDir}}\" 2>/dev/null || true); if [ -n \"\$root\" ] && [ -d \"\$root\" ]; then du -xhd1 \"\$root\" 2>/dev/null | sort -h; fi'"

section "Docker Log Size Evidence Slot"
run_shell "docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.ID}}'"
run_shell "for id in \$(docker ps -aq 2>/dev/null); do docker inspect -f '{{.Name}} id={{.Id}} log_driver={{.HostConfig.LogConfig.Type}} log_opts={{json .HostConfig.LogConfig.Config}}' \"\$id\"; done 2>/dev/null || true"
privileged_slot "Docker JSON Log Sizes" "find /var/lib/docker/containers -name '*-json.log' -printf '%s %p\n' 2>/dev/null | sort -n | tail -n 60"

section "Inactive Volume Classifier"
if volumes="$(docker volume ls -q 2>/dev/null)" && [ -n "${volumes}" ]; then
  used_volume_names="$(for id in $(docker ps -aq 2>/dev/null); do docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' "$id" 2>/dev/null; done | sort -u)"
  printf '| Volume | Active | Driver | Labels | Mountpoint |\n'
  printf '| --- | --- | --- | --- | --- |\n'
  for volume in ${volumes}; do
    active="inactive_review_before_cleanup"
    if printf '%s\n' "${used_volume_names}" | grep -Fxq "${volume}"; then
      active="active_mounted"
    fi
    docker volume inspect -f "| \`{{.Name}}\` | \`${active}\` | \`{{.Driver}}\` | \`{{json .Labels}}\` | \`{{.Mountpoint}}\` |" "${volume}" 2>/dev/null || printf '| `%s` | `%s` | `unknown` | `unknown` | `unknown` |\n' "${volume}" "${active}"
  done
else
  printf 'no volumes\n'
fi

section "Floating Tag Policy"
run_shell "docker images --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedSince}} {{.Size}}' | awk '\$1 ~ /:(latest|stable|main|master|dev|edge|[0-9]+)$/ {print \"floating_or_broad_tag=\" \$0}' || true"
run_shell "docker ps -a --format '{{.Names}} image={{.Image}}' | awk '\$2 ~ /:(latest|stable|main|master|dev|edge|[0-9]+)$/ {print \"container_with_floating_or_broad_tag=\" \$0}' || true"

section "Container User Posture"
run_shell "for id in \$(docker ps -aq 2>/dev/null); do docker inspect -f '{{.Name}} image={{.Config.Image}} configured_user={{if .Config.User}}{{.Config.User}}{{else}}default_image_user{{end}} privileged={{.HostConfig.Privileged}} read_only_rootfs={{.HostConfig.ReadonlyRootfs}} cap_add={{json .HostConfig.CapAdd}} cap_drop={{json .HostConfig.CapDrop}} security_opt={{json .HostConfig.SecurityOpt}}' \"\$id\"; done 2>/dev/null || true"

section "Compose Drift Checker"
run_shell "docker compose ls 2>/dev/null || true"
printf '\n### Tracked Compose Files\n'
compose_files_from_repo | sed "s#^${TARGET_REPO}/##" || true
printf '\n### Live Compose Config Files\n'
docker compose ls --format json 2>/dev/null | sed -n '1,120p' || true
printf '\n### Drift Notes\n'
cat <<EOF
- Compare live compose config paths above against tracked compose files under ${TARGET_REPO}.
- Live paths outside ${TARGET_REPO} are operational dependencies and need a docs owner before cleanup.
- Missing tracked files in live compose output may be dormant, not safe to delete.
EOF

section "Compose Secret Reference Inventory"
if compose_files="$(compose_files_from_repo)" && [ -n "${compose_files}" ]; then
  for file in ${compose_files}; do
    printf '\n### %s\n' "${file}"
    awk '
      /^[[:space:]]*(secrets:|env_file:|environment:)/ {inblock=1; print NR ":" $0; next}
      inblock && /^[^[:space:]-]/ {inblock=0}
      inblock {
        line=$0
        gsub(/=.*/, "=REDACTED_VALUE", line)
        gsub(/:[[:space:]]*[^#]+/, ": REDACTED_VALUE", line)
        gsub(/\$\{[^}]+\}/, "${VAR}", line)
        print NR ":" line
      }
    ' "${file}" 2>/dev/null | sed -n '1,180p' || true
  done
else
  printf 'no tracked compose files found under target repo\n'
fi

section "Posture Decision Matrix"
cat <<'EOF'
| Area | Evidence | Approval gate |
| --- | --- | --- |
| Docker log size | log driver/options, privileged json-log size slot | log truncation, daemon config edit, container recreate |
| inactive volumes | active mount classifier, volume inspect metadata | volume delete/prune |
| floating tags | image/container tag scan, compose references | image pinning, pull/recreate |
| compose drift | live compose ls and tracked file inventory | moving/deleting external compose projects |
| Docker root growth | docker system df, root breakdown slot | prune/delete/move Docker root |
| container user posture | configured user, privileged, caps, read-only rootfs | security option changes, recreate |
| secret references | compose env_file/secrets/environment keys only | secret rotation or value inspection |
EOF
