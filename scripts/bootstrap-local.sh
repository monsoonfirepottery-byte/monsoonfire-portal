#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[bootstrap] Repository: $ROOT_DIR"

maybe_use_nvm() {
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$nvm_dir/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "$nvm_dir/nvm.sh"
    if command -v nvm >/dev/null 2>&1; then
      if nvm use >/dev/null 2>&1; then
        echo "[bootstrap] Node via nvm: $(node -v)"
      else
        echo "[bootstrap] nvm detected but failed to 'nvm use'. Continuing with current Node: $(node -v)"
      fi
      return
    fi
  fi
  echo "[bootstrap] nvm not available in this shell. Continuing with current Node: $(node -v)"
}

maybe_use_java() {
  if [[ -f "$ROOT_DIR/scripts/use-java.sh" ]]; then
    # shellcheck source=/dev/null
    if source "$ROOT_DIR/scripts/use-java.sh" >/dev/null 2>&1; then
      echo "[bootstrap] Java environment initialized via scripts/use-java.sh"
    else
      echo "[bootstrap] scripts/use-java.sh exists but did not initialize Java cleanly. Continuing."
    fi
  else
    echo "[bootstrap] scripts/use-java.sh not found. Continuing without Java bootstrap helper."
  fi
}

needs_install() {
  local workspace_dir="$1"
  local lock_file="$workspace_dir/package-lock.json"
  local node_modules_dir="$workspace_dir/node_modules"

  if [[ ! -d "$node_modules_dir" ]]; then
    return 0
  fi

  if [[ -f "$lock_file" && "$lock_file" -nt "$node_modules_dir" ]]; then
    return 0
  fi

  return 1
}

install_workspace_if_needed() {
  local label="$1"
  local workspace_dir="$2"
  local prefix="$3"

  if needs_install "$workspace_dir"; then
    echo "[bootstrap] Installing dependencies for $label..."
    if [[ "$prefix" == "." ]]; then
      npm install
    else
      npm --prefix "$prefix" install
    fi
  else
    echo "[bootstrap] Dependencies for $label are up-to-date. Skipping install."
  fi
}

maybe_use_nvm
maybe_use_java

install_workspace_if_needed "root" "$ROOT_DIR" "."
install_workspace_if_needed "functions" "$ROOT_DIR/functions" "functions"
install_workspace_if_needed "web" "$ROOT_DIR/web" "web"

echo "[bootstrap] Running verify:local..."
npm run verify:local
echo "[bootstrap] verify:local completed successfully."
