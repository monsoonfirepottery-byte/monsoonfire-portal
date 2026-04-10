#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MONITORING_SRC="${REPO_ROOT}/config/studiobrain/monitoring"
HOST_USER="${STUDIO_BRAIN_DEPLOY_USER:-${SUDO_USER:-wuff}}"
HOST_HOME="${STUDIO_BRAIN_HOST_HOME:-/home/${HOST_USER}}"
TARGET_ROOT="${STUDIO_BRAIN_MONITORING_ROOT:-${HOST_HOME}/monitoring}"
DEFAULT_BIND_HOST="${STUDIO_BRAIN_MONITORING_BIND_HOST:-127.0.0.1}"

for path in \
  "${MONITORING_SRC}/docker-compose.yml" \
  "${MONITORING_SRC}/Caddyfile" \
  "${MONITORING_SRC}/scripts/bootstrap-kuma-monitors.js" \
  "${MONITORING_SRC}/netdata-overrides/netdata.conf" \
  "${MONITORING_SRC}/netdata-overrides/docker.conf" \
  "${MONITORING_SRC}/netdata-overrides/systemdunits.conf"; do
  if [[ ! -f "${path}" ]]; then
    echo "Missing source file: ${path}" >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for scripts/install-studiobrain-monitoring.sh" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required for scripts/install-studiobrain-monitoring.sh" >&2
  exit 1
fi

install -d -o "${HOST_USER}" -g "${HOST_USER}" -m 0755 \
  "${TARGET_ROOT}" \
  "${TARGET_ROOT}/scripts" \
  "${TARGET_ROOT}/netdata-overrides" \
  "${TARGET_ROOT}/uptime-kuma" \
  "${TARGET_ROOT}/netdata-config" \
  "${TARGET_ROOT}/netdata-lib" \
  "${TARGET_ROOT}/netdata-cache"

install -o "${HOST_USER}" -g "${HOST_USER}" -m 0644 \
  "${MONITORING_SRC}/docker-compose.yml" \
  "${TARGET_ROOT}/docker-compose.yml"
install -o "${HOST_USER}" -g "${HOST_USER}" -m 0644 \
  "${MONITORING_SRC}/Caddyfile" \
  "${TARGET_ROOT}/Caddyfile"
install -o "${HOST_USER}" -g "${HOST_USER}" -m 0755 \
  "${MONITORING_SRC}/scripts/bootstrap-kuma-monitors.js" \
  "${TARGET_ROOT}/scripts/bootstrap-kuma-monitors.js"

for override in netdata.conf docker.conf systemdunits.conf; do
  install -o "${HOST_USER}" -g "${HOST_USER}" -m 0644 \
    "${MONITORING_SRC}/netdata-overrides/${override}" \
    "${TARGET_ROOT}/netdata-overrides/${override}"
done

if [[ ! -f "${TARGET_ROOT}/.env" ]]; then
  printf 'MONITORING_BIND_HOST=%s\n' "${DEFAULT_BIND_HOST}" >"${TARGET_ROOT}/.env"
  chown "${HOST_USER}:${HOST_USER}" "${TARGET_ROOT}/.env"
  chmod 0644 "${TARGET_ROOT}/.env"
fi

docker compose -f "${TARGET_ROOT}/docker-compose.yml" --project-directory "${TARGET_ROOT}" up -d

if ! docker ps --format '{{.Names}}' | grep -qx 'uptime-kuma'; then
  echo "uptime-kuma did not start successfully" >&2
  exit 1
fi

tmp_stdout="$(mktemp)"
tmp_stderr="$(mktemp)"
cleanup() {
  rm -f "${tmp_stdout}" "${tmp_stderr}"
}
trap cleanup EXIT

docker exec uptime-kuma sh -lc 'rm -rf /tmp/kuma-bootstrap && mkdir -p /tmp/kuma-bootstrap' >/dev/null
docker cp "${TARGET_ROOT}/scripts/bootstrap-kuma-monitors.js" uptime-kuma:/tmp/kuma-bootstrap/bootstrap-kuma-monitors.js >/dev/null
if ! docker exec uptime-kuma sh -lc 'command -v npm >/dev/null 2>&1'; then
  echo "uptime-kuma container is missing npm, cannot bootstrap monitors" >&2
  exit 1
fi
if ! docker exec uptime-kuma sh -lc 'cd /tmp/kuma-bootstrap && npm install --no-save --no-package-lock --silent socket.io-client@4' >>"${tmp_stdout}" 2>>"${tmp_stderr}"; then
  cat "${tmp_stderr}" >&2
  exit 1
fi
if ! docker exec uptime-kuma sh -lc 'cd /tmp/kuma-bootstrap && node ./bootstrap-kuma-monitors.js' >"${tmp_stdout}" 2>"${tmp_stderr}"; then
  cat "${tmp_stderr}" >&2
  exit 1
fi
docker exec uptime-kuma sh -lc 'rm -rf /tmp/kuma-bootstrap' >/dev/null

docker compose -f "${TARGET_ROOT}/docker-compose.yml" --project-directory "${TARGET_ROOT}" ps
