#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_CODEX_BIN="${REPO_ROOT}/node_modules/.bin/codex"
CODEX_BIN=""
CODEX_SOURCE=""
CODEX_VERSION=""
CODEX_FULL_PERMISSIONS="${CODEX_FULL_PERMISSIONS:-1}"
CODEX_DEFAULT_ARGS=()

build_codex_default_args() {
  CODEX_DEFAULT_ARGS=()
  if [[ "${CODEX_FULL_PERMISSIONS}" != "0" ]]; then
    # Ensure codex sessions launched by this wrapper default to full access.
    CODEX_DEFAULT_ARGS+=(--dangerously-bypass-approvals-and-sandbox)
  fi
}

resolve_codex_bin() {
  if [[ -n "${CODEX_BIN_OVERRIDE:-}" ]]; then
    CODEX_BIN="${CODEX_BIN_OVERRIDE}"
    CODEX_SOURCE="override"
  elif command -v codex >/dev/null 2>&1; then
    CODEX_BIN="$(command -v codex)"
    CODEX_SOURCE="global-path"
  elif [[ -x "${LOCAL_CODEX_BIN}" ]]; then
    CODEX_BIN="${LOCAL_CODEX_BIN}"
    CODEX_SOURCE="repo-local-fallback"
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
  if [[ "${CODEX_SOURCE}" == "repo-local-fallback" ]]; then
    cat >&2 <<WARN_LOCAL
WARN: Falling back to repo-local Codex binary (${LOCAL_CODEX_BIN}).
WARN: Install Codex globally (or place it on PATH) to keep this harness global-first.
WARN_LOCAL
  fi
}

codex_cmd() {
  "${CODEX_BIN}" "${CODEX_DEFAULT_ARGS[@]}" "$@"
}

run_in_repo() {
  (cd "${REPO_ROOT}" && "$@")
}

print_banner() {
  cat <<'BANNER'
MCP operator wrapper:
- Profiles are source of truth, but Codex profile-scoped MCP activation can be flaky.
- This script forces the intended servers on each run with:
  -c 'mcp_servers.<id>.enabled=true'
- Keep top-level MCP defaults disabled in ~/.codex/config.toml, except
  intentionally persistent servers (for example `open_memory`).
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
  ./scripts/codex-mcp.sh memory
  ./scripts/codex-mcp.sh context
  ./scripts/codex-mcp.sh shell [codex-shell args...]
  ./scripts/codex-mcp.sh resume [codex-shell args...]
  ./scripts/codex-mcp.sh resume-fresh [codex-shell args...]
  ./scripts/codex-mcp.sh resume-status
USAGE
}

run_list_with_overrides() {
  local profile="$1"
  shift
  local server_ids=("$@")

  local cmd=("${CODEX_BIN}" "${CODEX_DEFAULT_ARGS[@]}" --profile "$profile")
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

smoke_context() {
  echo "==> context profile smoke (read-only MCP call)"
  if ! codex_cmd \
    --profile docs_research \
    -c 'mcp_servers.context7_docs.enabled=true' \
    -c 'mcp_servers.mcp_registry.enabled=true' \
    exec "Run one read-only MCP call against context7_docs (for example a docs search) and print a one-line success summary."; then
    echo "WARN: context smoke call failed. Verify context7_docs auth/connectivity and retry."
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
build_codex_default_args
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
  shell)
    shift
    print_banner
    : "${CODEX_ENABLE_CONTEXT7_ON_SHELL:=1}"
    run_in_repo node ./scripts/codex-shell.mjs "$@"
    ;;
  resume)
    shift
    print_banner
    : "${CODEX_ENABLE_CONTEXT7_ON_SHELL:=1}"
    CODEX_OPEN_MEMORY_REUSE_LAST_RUN_ID=true \
    CODEX_OPEN_MEMORY_SESSION_STATE_PATH="${CODEX_OPEN_MEMORY_SESSION_STATE_PATH:-output/codex-shell-state.json}" \
    run_in_repo node ./scripts/codex-shell.mjs "$@"
    ;;
  resume-fresh)
    shift
    print_banner
    : "${CODEX_ENABLE_CONTEXT7_ON_SHELL:=1}"
    CODEX_OPEN_MEMORY_REUSE_LAST_RUN_ID=false \
    CODEX_OPEN_MEMORY_BOOTSTRAP_QUERY="" \
    run_in_repo node ./scripts/codex-shell.mjs --no-bootstrap "$@"
    ;;
  resume-status)
    shift || true
    session_state="${CODEX_OPEN_MEMORY_SESSION_STATE_PATH:-output/codex-shell-state.json}"
    resolved_state_path="${session_state}"
    if [[ "${session_state}" != /* ]]; then
      resolved_state_path="${REPO_ROOT}/${session_state}"
    fi
    if [[ ! -f "${resolved_state_path}" ]]; then
      cat <<'NO_STATE'
No persisted shell state found.
Start a shell session first (e.g., ./scripts/codex-mcp.sh resume) to seed state.
NO_STATE
      exit 1
    fi
    echo "Shell continuity state: ${resolved_state_path}"
    cat "${resolved_state_path}"
    ;;
  memory)
    print_banner
    run_list_with_overrides open_memory open_memory
    ;;
  context)
    print_banner
    run_list_with_overrides docs_research context7_docs mcp_registry
    smoke_context
    ;;
  *)
    usage
    exit 2
    ;;
esac
