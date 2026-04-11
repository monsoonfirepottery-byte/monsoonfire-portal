#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${STUDIO_BRAIN_REPO_ROOT:-/home/wuff/monsoonfire-portal}"
DISCORD_ENV_PATH="${STUDIO_BRAIN_DISCORD_ENV_PATH:-${REPO_ROOT}/secrets/studio-brain/discord-mcp.env}"
NODE_BIN="${STUDIO_BRAIN_NODE_BIN:-$(command -v node)}"

COMMAND="${1:-listen}"

if [[ ! -d "${REPO_ROOT}" ]]; then
  echo "Studio Brain repo root not found: ${REPO_ROOT}" >&2
  exit 1
fi

if [[ ! -f "${DISCORD_ENV_PATH}" ]]; then
  echo "Discord relay env file not found: ${DISCORD_ENV_PATH}" >&2
  exit 1
fi

if [[ -z "${NODE_BIN}" || ! -x "${NODE_BIN}" ]]; then
  echo "node binary not found for Studio Brain Discord relay" >&2
  exit 1
fi

ARGS=(
  "./scripts/studio-brain-discord-relay.mjs"
  "${COMMAND}"
)

if [[ "${COMMAND}" == "listen" ]]; then
  ARGS+=(
    "--skip-bot-messages"
    "${STUDIO_BRAIN_DISCORD_RELAY_SKIP_BOT_MESSAGES:-true}"
    "--initial-sync"
    "${STUDIO_BRAIN_DISCORD_RELAY_INITIAL_SYNC:-true}"
  )
else
  ARGS+=(
    "--skip-bot-messages"
    "${STUDIO_BRAIN_DISCORD_RELAY_SKIP_BOT_MESSAGES:-true}"
  )

  if [[ -n "${STUDIO_BRAIN_DISCORD_RELAY_LIMIT:-}" ]]; then
    ARGS+=("--limit" "${STUDIO_BRAIN_DISCORD_RELAY_LIMIT}")
  fi
fi

if [[ -n "${STUDIO_BRAIN_DISCORD_RELAY_STATE_PATH:-}" ]]; then
  ARGS+=("--state-path" "${STUDIO_BRAIN_DISCORD_RELAY_STATE_PATH}")
fi

if [[ -n "${STUDIO_BRAIN_DISCORD_RELAY_CHANNEL_ID:-}" ]]; then
  ARGS+=("--channel-id" "${STUDIO_BRAIN_DISCORD_RELAY_CHANNEL_ID}")
fi

cd "${REPO_ROOT}"
"${NODE_BIN}" "${ARGS[@]}"
