#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_CODEX_BIN="${REPO_ROOT}/node_modules/.bin/codex"
CODEX_BIN=""
CODEX_SOURCE=""
CODEX_VERSION=""

resolve_codex_bin() {
  if [[ -n "${CODEX_BIN_OVERRIDE:-}" ]]; then
    CODEX_BIN="${CODEX_BIN_OVERRIDE}"
    CODEX_SOURCE="override"
  elif [[ -x "${LOCAL_CODEX_BIN}" ]]; then
    CODEX_BIN="${LOCAL_CODEX_BIN}"
    CODEX_SOURCE="repo-local"
  elif command -v codex >/dev/null 2>&1; then
    CODEX_BIN="$(command -v codex)"
    CODEX_SOURCE="path"
  else
    cat >&2 <<'NO_CODEX'
ERROR: Unable to find a usable Codex CLI binary.
Install dependencies with:
  npm ci
Or set CODEX_BIN_OVERRIDE=/absolute/path/to/codex and retry.
NO_CODEX
    exit 1
  fi

  CODEX_VERSION="$("${CODEX_BIN}" --version 2>/dev/null | head -n 1 || true)"
  if [[ -x "${LOCAL_CODEX_BIN}" && "${CODEX_BIN}" != "${LOCAL_CODEX_BIN}" ]]; then
    cat >&2 <<WARN_AMBIG
WARN: Using non-local Codex binary (${CODEX_BIN}).
WARN: Repo-local pinned Codex exists at ${LOCAL_CODEX_BIN}.
WARN: Set CODEX_BIN_OVERRIDE or run from an environment that prefers the local binary to avoid CLI version drift.
WARN_AMBIG
  fi
}

codex_cmd() {
  "${CODEX_BIN}" "$@"
}

print_banner() {
  cat <<'BANNER'
MCP operator wrapper:
- Profiles are source of truth, but Codex profile-scoped MCP activation can be flaky.
- This script forces the intended servers on each run with:
  -c 'mcp_servers.<id>.enabled=true'
- Keep top-level MCP defaults disabled in ~/.codex/config.toml.
- Codex CLI 0.106+ expects top-level model config (`model`, optional `model_provider`);
  legacy `[model_providers.*]` / `[models.*]` blocks are deprecated.
BANNER
  echo "- Resolved Codex CLI: ${CODEX_BIN} (${CODEX_SOURCE}${CODEX_VERSION:+, ${CODEX_VERSION}})"
}

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/codex-mcp.sh list
  ./scripts/codex-mcp.sh docs
  ./scripts/codex-mcp.sh infra
  ./scripts/codex-mcp.sh home
  ./scripts/codex-mcp.sh apple
  ./scripts/codex-mcp.sh cloudflare
USAGE
}

run_list_with_overrides() {
  local profile="$1"
  shift
  local server_ids=("$@")

  local cmd=("${CODEX_BIN}" --profile "$profile")
  local server_id
  for server_id in "${server_ids[@]}"; do
    cmd+=(-c "mcp_servers.${server_id}.enabled=true")
  done
  cmd+=(mcp list)

  echo "==> codex --profile ${profile} (with MCP enable overrides) mcp list"
  "${cmd[@]}"
}

smoke_docs() {
  echo "==> docs profile smoke (read-only MCP call)"
  if ! codex_cmd \
    --profile docs_research \
    -c 'mcp_servers.openai_docs.enabled=true' \
    -c 'mcp_servers.context7_docs.enabled=true' \
    -c 'mcp_servers.mcp_registry.enabled=true' \
    exec "Run one read-only MCP call against openai_docs by invoking list_openai_docs with limit=1 and print a one-line success summary."; then
    echo "WARN: docs smoke call failed. MCP servers are listed above; verify connectivity/auth and retry."
  fi
}

smoke_cloudflare() {
  echo "==> cloudflare profile smoke (read-only MCP call)"
  if ! codex_cmd \
    --profile cloudflare \
    -c 'mcp_servers.cloudflare_docs.enabled=true' \
    -c 'mcp_servers.cloudflare_browser_rendering.enabled=true' \
    exec "Run one read-only MCP call against cloudflare_docs (for example a docs search) and print a one-line success summary."; then
    cat <<'KNOWN_ISSUES'
WARN: cloudflare smoke call failed.
KNOWN_ISSUES:
- Current auth capability can still mark `cloudflare_docs` as unsupported.
  If so, `codex mcp login cloudflare_docs` may return:
  \"No authorization support detected\".
- Profile enablement flakiness (#9325 pattern):
  continue to force servers with CLI overrides for this run.

READ_ONLY_FALLBACK:
- Try: codex mcp login cloudflare_browser_rendering
- Retry list/smoke with explicit overrides:
  codex --profile cloudflare \
    -c 'mcp_servers.cloudflare_docs.enabled=true' \
    -c 'mcp_servers.cloudflare_browser_rendering.enabled=true' \
    mcp list
KNOWN_ISSUES
  fi
}

subcommand="${1:-}"
resolve_codex_bin
case "$subcommand" in
  list)
    print_banner
    codex_cmd mcp list
    ;;
  docs)
    print_banner
    run_list_with_overrides docs_research openai_docs context7_docs mcp_registry
    smoke_docs
    ;;
  infra)
    print_banner
    run_list_with_overrides infra_docs \
      ubuntu_docs docker_docs kubernetes_docs ansible_docs awx_docs \
      jenkins_docs nomad_docs podman_docs k8s_mcp_server docker_mcp_server ssh_mcp
    ;;
  home)
    print_banner
    run_list_with_overrides home_automation \
      home_assistant_docs home_assistant_core home_assistant_ai \
      home_assistant_community aqara_mcp hubitat_public hubitat_mcp
    ;;
  apple)
    print_banner
    run_list_with_overrides apple_home apple_fetch
    ;;
  cloudflare)
    print_banner
    run_list_with_overrides cloudflare cloudflare_docs cloudflare_browser_rendering
    smoke_cloudflare
    ;;
  *)
    usage
    exit 2
    ;;
esac
