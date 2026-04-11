#!/usr/bin/env bash
set -euo pipefail

HOST_USER="${STUDIO_BRAIN_HOST_USER:-wuff}"
HOST_HOME="${STUDIO_BRAIN_HOST_HOME:-/home/${HOST_USER}}"
REPO_ROOT="${STUDIO_BRAIN_REPO_ROOT:-${HOST_HOME}/monsoonfire-portal}"
MONITORING_ROOT="${STUDIO_BRAIN_MONITORING_ROOT:-${HOST_HOME}/monitoring}"
STAMP="$(date +%F-%H%M%S)"
OUTDIR="/var/backups/studio-brain/daily"
RETAIN_DAYS="${STUDIO_BRAIN_BACKUP_RETAIN_DAYS:-14}"

mkdir -p "${OUTDIR}"
chmod 700 "${OUTDIR}"

archive_existing_targets() {
  local archive="$1"
  shift
  local targets=()
  for target in "$@"; do
    [[ -e "${target}" ]] && targets+=("${target}")
  done
  if [[ ${#targets[@]} -eq 0 ]]; then
    return 0
  fi
  tar -czf "${archive}" "${targets[@]}"
  chmod 600 "${archive}"
}

archive_existing_targets "${OUTDIR}/host-config-${STAMP}.tgz" \
  /etc/systemd/system/studio-brain-backup.service \
  /etc/systemd/system/studio-brain-backup.timer \
  /etc/systemd/system/studio-brain-disk-alert.service \
  /etc/systemd/system/studio-brain-disk-alert.timer \
  /etc/systemd/system/studio-brain-healthcheck.service \
  /etc/systemd/system/studio-brain-healthcheck.timer \
  /etc/systemd/system/studio-brain-reboot-watch.service \
  /etc/systemd/system/studio-brain-reboot-watch.timer \
  /usr/local/bin/studio-brain-backup.sh \
  /usr/local/bin/studio-brain-disk-alert.sh \
  /usr/local/bin/studio-brain-healthcheck.sh \
  /usr/local/bin/studio-brain-reboot-watch.sh \
  "${HOST_HOME}/.config/monsoonfire" \
  "${MONITORING_ROOT}/docker-compose.yml" \
  "${MONITORING_ROOT}/Caddyfile" \
  "${MONITORING_ROOT}/scripts/bootstrap-kuma-monitors.js" \
  "${MONITORING_ROOT}/netdata-overrides"

archive_existing_targets "${OUTDIR}/studio-brain-config-${STAMP}.tgz" \
  "${REPO_ROOT}/config/studiobrain" \
  "${REPO_ROOT}/studio-brain/docker-compose.yml" \
  "${REPO_ROOT}/studio-brain/docker-compose.proxy.yml" \
  "${REPO_ROOT}/studio-brain/docker/otel-collector.yaml" \
  "${REPO_ROOT}/studio-brain/README.md" \
  "${REPO_ROOT}/studio-brain/docs" \
  "${REPO_ROOT}/docs/runbooks/STUDIO_BRAIN_HOST_ACCESS.md" \
  "${REPO_ROOT}/docs/runbooks/STUDIO_BRAIN_HOST_DEPLOY.md" \
  "${REPO_ROOT}/docs/runbooks/STUDIO_BRAIN_HOST_STACK.md"

find "${OUTDIR}" -type f -name '*.tgz' -mtime +"${RETAIN_DAYS}" -delete
