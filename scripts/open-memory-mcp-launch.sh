#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
STUDIO_SECRETS="${REPO_ROOT}/secrets/studio-brain/studio-brain-automation.env"
LEGACY_STUDIO_BRAIN_ENV="${REPO_ROOT}/studio-brain/.env"
LOCAL_STUDIO_BRAIN_ENV="${REPO_ROOT}/studio-brain/.env.local"
PORTAL_SECRETS="${REPO_ROOT}/secrets/portal/portal-automation.env"

load_env_file() {
  local env_file="$1"
  if [[ -f "${env_file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
  fi
}

load_env_file "${STUDIO_SECRETS}"
load_env_file "${LEGACY_STUDIO_BRAIN_ENV}"
load_env_file "${LOCAL_STUDIO_BRAIN_ENV}"

if [[ -z "${STUDIO_BRAIN_BASE_URL:-}" ]]; then
  resolved_base_url="$(
    cd "${REPO_ROOT}" && node --input-type=module -e '
      import { resolveStudioBrainBaseUrlFromEnv } from "./scripts/studio-brain-url-resolution.mjs";
      process.stdout.write(resolveStudioBrainBaseUrlFromEnv({ env: process.env }));
    ' 2>/dev/null || true
  )"
  if [[ -n "${resolved_base_url}" ]]; then
    export STUDIO_BRAIN_BASE_URL="${resolved_base_url%/}"
  fi
fi

mint_staff_id_token() {
  (
    cd "${REPO_ROOT}" &&
      node --input-type=module -e '
        import { mintStaffIdTokenFromPortalEnv } from "./scripts/lib/firebase-auth-token.mjs";
        const minted = await mintStaffIdTokenFromPortalEnv({
          env: process.env,
          defaultCredentialsPath: "./secrets/portal/portal-agent-staff.json",
          preferRefreshToken: true,
        });
        if (!minted.ok || !minted.token) {
          process.exit(1);
        }
        process.stdout.write(minted.token);
      '
  )
}

load_env_file "${PORTAL_SECRETS}"
if [[ "${STUDIO_BRAIN_PREFER_EXISTING_AUTH_TOKEN:-}" != "true" ]]; then
  minted_id_token="$(mint_staff_id_token 2>/dev/null || true)"
  if [[ -n "${minted_id_token}" ]]; then
    export STUDIO_BRAIN_ID_TOKEN="${minted_id_token}"
    unset STUDIO_BRAIN_AUTH_TOKEN
  fi
fi

if [[ -z "${STUDIO_BRAIN_AUTH_TOKEN:-}" && -n "${STUDIO_BRAIN_ID_TOKEN:-}" ]]; then
  if [[ "${STUDIO_BRAIN_ID_TOKEN}" =~ ^[Bb]earer[[:space:]]+ ]]; then
    export STUDIO_BRAIN_AUTH_TOKEN="${STUDIO_BRAIN_ID_TOKEN}"
  else
    export STUDIO_BRAIN_AUTH_TOKEN="Bearer ${STUDIO_BRAIN_ID_TOKEN}"
  fi
fi

exec node "${REPO_ROOT}/scripts/open-memory-mcp.mjs"
