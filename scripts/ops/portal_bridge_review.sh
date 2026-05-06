#!/usr/bin/env bash
set -u

# Read-only Studio Brain portal bridge review.
# Checks service state and port posture for the localhost proxy and reverse tunnel.
# Does not print environment files, private key contents, or full ExecStart command lines.

SSH_HOST="${SSH_HOST:-studiobrain}"
LOCAL_MODE=0
STRICT=0

usage() {
  cat <<'EOF'
Usage: bash scripts/ops/portal_bridge_review.sh [options]

Options:
  --ssh-host HOST   SSH host alias to inspect. Default: studiobrain.
  --local           Inspect the local machine instead of SSH.
  --strict          Exit non-zero if either bridge service is inactive or the tunnel restart count is high.
  --help            Show this help.

Safety:
  Read-only. Does not restart services, read private keys, dump env files, or mutate host state.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ssh-host)
      SSH_HOST="${2:-}"
      shift 2
      ;;
    --local)
      LOCAL_MODE=1
      shift
      ;;
    --strict)
      STRICT=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

section() {
  printf '\n## %s\n' "$1"
}

remote_capture() {
  local command_text="$1"
  if [ "${LOCAL_MODE}" -eq 1 ]; then
    bash -lc "${command_text}" </dev/null
    return $?
  fi

  if ! command -v ssh >/dev/null 2>&1; then
    echo "WARN: ssh is not available; rerun on the host with --local or install ssh." >&2
    return 127
  fi

  ssh -n "${SSH_HOST}" "${command_text}"
}

show_unit() {
  local unit_name="$1"
  remote_capture "systemctl show ${unit_name} --no-pager -p ActiveState -p SubState -p UnitFileState -p FragmentPath -p MainPID -p NRestarts -p ExecMainStartTimestamp -p MemoryCurrent -p CPUUsageNSec 2>/dev/null || true"
}

unit_value() {
  local unit_name="$1"
  local property_name="$2"
  remote_capture "systemctl show ${unit_name} --no-pager --value -p ${property_name} 2>/dev/null || true" | tail -n 1
}

section "Report Metadata"
printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'scope: studio_brain_portal_bridge_review\n'
if [ "${LOCAL_MODE}" -eq 1 ]; then
  printf 'target: local\n'
else
  printf 'target_ssh_host: %s\n' "${SSH_HOST}"
fi
printf 'safety: read_only_no_restart_no_env_dump_no_key_read\n'

proxy_unit="studio-brain-control-tower-proxy.service"
tunnel_unit="studio-brain-namecheap-tunnel.service"

section "Service State"
printf '# %s\n' "${proxy_unit}"
show_unit "${proxy_unit}"
printf '\n# %s\n' "${tunnel_unit}"
show_unit "${tunnel_unit}"

proxy_active="$(unit_value "${proxy_unit}" "ActiveState")"
tunnel_active="$(unit_value "${tunnel_unit}" "ActiveState")"
tunnel_restarts="$(unit_value "${tunnel_unit}" "NRestarts")"
tunnel_restarts="${tunnel_restarts//[^0-9]/}"
if [ -z "${tunnel_restarts}" ]; then
  tunnel_restarts=0
fi

section "Local Port Posture"
remote_capture "ss -ltnp 2>/dev/null | awk 'NR == 1 || /:1878[78][[:space:]]/' || true"

section "Classification"
bridge_status="ok"
if [ "${proxy_active}" != "active" ]; then
  bridge_status="degraded"
  printf 'proxy_status: degraded\n'
else
  printf 'proxy_status: ok\n'
fi

if [ "${tunnel_active}" != "active" ]; then
  bridge_status="degraded"
  printf 'tunnel_status: degraded\n'
elif [ "${tunnel_restarts}" -ge 50 ]; then
  if [ "${bridge_status}" = "ok" ]; then
    bridge_status="watch"
  fi
  printf 'tunnel_status: watch_restart_history\n'
else
  printf 'tunnel_status: ok\n'
fi

printf 'tunnel_restart_count: %s\n' "${tunnel_restarts}"
printf 'overall_status: %s\n' "${bridge_status}"

section "Safe Next Steps"
cat <<'EOF'
- If the proxy is inactive, inspect its journal and upstream health before restart.
- If the tunnel is inactive, inspect network reachability, SSH key path permissions, and remote port availability before restart.
- If restart count is high but the tunnel is currently active, treat it as a watch item; do not restart solely to reset counters.
- Do not print private key contents, environment values, or tunnel credentials into tickets.
EOF

if [ "${STRICT}" -eq 1 ]; then
  if [ "${bridge_status}" != "ok" ]; then
    exit 1
  fi
fi
