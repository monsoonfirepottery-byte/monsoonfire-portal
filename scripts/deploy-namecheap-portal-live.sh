#!/usr/bin/env bash
set -euo pipefail

require_value() {
  local option=$1
  local value=$2
  if [[ -z "$value" || "$value" == --* ]]; then
    echo "ERROR: $option requires a value." >&2
    exit 1
  fi
}

DEFAULT_SERVER="${WEBSITE_DEPLOY_SERVER:-monsggbd@66.29.137.142}"
DEFAULT_PORT="${WEBSITE_DEPLOY_PORT:-21098}"
DEFAULT_KEY="${WEBSITE_DEPLOY_KEY:-$HOME/.ssh/namecheap-portal}"
DEFAULT_REMOTE_PATH="${WEBSITE_DEPLOY_REMOTE_PATH:-portal/}"
DEFAULT_PORTAL_URL="${PORTAL_DEPLOY_URL:-https://portal.monsoonfire.com}"

SERVER="$DEFAULT_SERVER"
PORT="$DEFAULT_PORT"
KEY="$DEFAULT_KEY"
REMOTE_PATH="$DEFAULT_REMOTE_PATH"
PORTAL_URL="$DEFAULT_PORTAL_URL"
NO_BUILD="false"
VERIFY="true"
PROMOTION_GATE="true"

EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)
      require_value "$1" "${2:-}"
      SERVER="$2"
      shift 2
      ;;
    --port)
      require_value "$1" "${2:-}"
      PORT="$2"
      shift 2
      ;;
    --key)
      require_value "$1" "${2:-}"
      KEY="$2"
      shift 2
      ;;
    --remote-path)
      require_value "$1" "${2:-}"
      REMOTE_PATH="$2"
      shift 2
      ;;
    --portal-url)
      require_value "$1" "${2:-}"
      PORTAL_URL="$2"
      shift 2
      ;;
    --no-build)
      NO_BUILD="true"
      shift
      ;;
    --skip-verify)
      VERIFY="false"
      shift
      ;;
    --verify)
      VERIFY="true"
      shift
      ;;
    --promotion-gate)
      PROMOTION_GATE="true"
      shift
      ;;
    --skip-promotion-gate)
      PROMOTION_GATE="false"
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage:
  scripts/deploy-namecheap-portal-live.sh [options]

Options:
  --server <user@host>       default: monsggbd@66.29.137.142
  --port <ssh-port>          default: 21098
  --key <private-key-path>   default: ~/.ssh/namecheap-portal
  --remote-path <path>       default: portal/
  --portal-url <url>         default: https://portal.monsoonfire.com
  --no-build                 skip web build (assumes web/dist already exists)
  --skip-verify              run deploy without running verifier
  --verify                   force verifier (default)
  --skip-promotion-gate      skip automated post-deploy promotion gate
  --promotion-gate           force automated post-deploy promotion gate (default)
  --help                     show this help

Pass-through args:
  Any additional arguments are passed through to deploy-namecheap-portal.mjs.
EOF
      exit 0
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ ! -f "$KEY" ]]; then
  echo "ERROR: SSH key not found: $KEY" >&2
  exit 1
fi

COMMAND=(npm run deploy:namecheap -- --server "$SERVER" --port "$PORT" --key "$KEY" --remote-path "$REMOTE_PATH" --portal-url "$PORTAL_URL")

if [[ "$NO_BUILD" == "true" ]]; then
  COMMAND+=(--no-build)
fi

if [[ "$VERIFY" == "true" ]]; then
  COMMAND+=(--verify)
fi

if [[ "$PROMOTION_GATE" == "false" ]]; then
  COMMAND+=(--skip-promotion-gate)
else
  COMMAND+=(--promotion-gate)
fi

if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  COMMAND+=("${EXTRA_ARGS[@]}")
fi

echo "Running: ${COMMAND[*]}"
exec "${COMMAND[@]}"
