#!/usr/bin/env bash
set -euo pipefail

REMOTE_PARENT="${STUDIO_BRAIN_REMOTE_PARENT:-/home/wuff/monsoonfire-portal}"
HOST_USER="${STUDIO_BRAIN_DEPLOY_USER:-wuff}"
PROXY_HOST="${STUDIO_BRAIN_CONTROL_TOWER_PROXY_HOST:-127.0.0.1}"
PROXY_PORT="${STUDIO_BRAIN_CONTROL_TOWER_PROXY_PORT:-18788}"
UPSTREAM_BASE="${STUDIO_BRAIN_CONTROL_TOWER_PROXY_UPSTREAM:-http://127.0.0.1:8787}"
TUNNEL_TARGET="${STUDIO_BRAIN_PORTAL_TUNNEL_TARGET:-}"
TUNNEL_PORT="${STUDIO_BRAIN_PORTAL_TUNNEL_PORT:-21098}"
TUNNEL_REMOTE_HOST="${STUDIO_BRAIN_PORTAL_TUNNEL_REMOTE_HOST:-127.0.0.1}"
TUNNEL_REMOTE_PORT="${STUDIO_BRAIN_PORTAL_TUNNEL_REMOTE_PORT:-18787}"
TUNNEL_LOCAL_HOST="${STUDIO_BRAIN_PORTAL_TUNNEL_LOCAL_HOST:-127.0.0.1}"
TUNNEL_LOCAL_PORT="${STUDIO_BRAIN_PORTAL_TUNNEL_LOCAL_PORT:-18788}"
TUNNEL_KEY_PATH="${STUDIO_BRAIN_PORTAL_TUNNEL_KEY_PATH:-/home/${HOST_USER}/.ssh/studiobrain-namecheap-tunnel}"
NODE_BIN="${STUDIO_BRAIN_NODE_BIN:-$(command -v node)}"
SSH_BIN="${STUDIO_BRAIN_SSH_BIN:-$(command -v ssh)}"

if [[ -z "${TUNNEL_TARGET}" ]]; then
  echo "STUDIO_BRAIN_PORTAL_TUNNEL_TARGET is required" >&2
  exit 1
fi

if [[ -z "${NODE_BIN}" ]]; then
  echo "node is required on the Studio Brain host" >&2
  exit 1
fi

if [[ -z "${SSH_BIN}" ]]; then
  echo "ssh is required on the Studio Brain host" >&2
  exit 1
fi

install -d -m 755 /etc/systemd/system

cat >/etc/systemd/system/studio-brain-control-tower-proxy.service <<UNIT
[Unit]
Description=Studio Brain Control Tower localhost proxy
After=network.target

[Service]
Type=simple
User=${HOST_USER}
WorkingDirectory=${REMOTE_PARENT}
Restart=always
RestartSec=5
ExecStart=/usr/bin/env bash -lc 'set -a; [ -f ${REMOTE_PARENT}/studio-brain/.env.local ] && . ${REMOTE_PARENT}/studio-brain/.env.local; [ -f ${REMOTE_PARENT}/studio-brain/.env ] && . ${REMOTE_PARENT}/studio-brain/.env; set +a; export STUDIO_BRAIN_CONTROL_TOWER_PROXY_HOST=${PROXY_HOST}; export STUDIO_BRAIN_CONTROL_TOWER_PROXY_PORT=${PROXY_PORT}; export STUDIO_BRAIN_CONTROL_TOWER_PROXY_UPSTREAM=${UPSTREAM_BASE}; exec ${NODE_BIN} ${REMOTE_PARENT}/scripts/studiobrain-control-tower-proxy.mjs'

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/studio-brain-namecheap-tunnel.service <<UNIT
[Unit]
Description=Studio Brain reverse tunnel to portal host
After=network-online.target studio-brain-control-tower-proxy.service
Wants=network-online.target studio-brain-control-tower-proxy.service

[Service]
Type=simple
User=${HOST_USER}
Restart=always
RestartSec=5
ExecStart=${SSH_BIN} -NT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -i ${TUNNEL_KEY_PATH} -p ${TUNNEL_PORT} -R ${TUNNEL_REMOTE_HOST}:${TUNNEL_REMOTE_PORT}:${TUNNEL_LOCAL_HOST}:${TUNNEL_LOCAL_PORT} ${TUNNEL_TARGET}

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable studio-brain-control-tower-proxy.service
systemctl enable studio-brain-namecheap-tunnel.service
systemctl restart studio-brain-control-tower-proxy.service
systemctl restart studio-brain-namecheap-tunnel.service

systemctl --no-pager --full status studio-brain-control-tower-proxy.service studio-brain-namecheap-tunnel.service || true
