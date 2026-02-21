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

show_java_version() {
  java -version 2>&1 | head -n 1
}

configure_java_home_from_dir() {
  local java_root="$1"
  if [[ -x "$java_root/bin/java" ]]; then
    export JAVA_HOME="$java_root"
    export PATH="$JAVA_HOME/bin:$PATH"
    return 0
  fi
  if [[ -x "$java_root/Contents/Home/bin/java" ]]; then
    export JAVA_HOME="$java_root/Contents/Home"
    export PATH="$JAVA_HOME/bin:$PATH"
    return 0
  fi
  return 1
}

try_source_use_java() {
  if [[ -f "$ROOT_DIR/scripts/use-java.sh" ]]; then
    echo "[bootstrap] Attempting Java helper: source scripts/use-java.sh"
    # shellcheck source=/dev/null
    if source "$ROOT_DIR/scripts/use-java.sh" >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

install_java_with_package_manager() {
  echo "[bootstrap] Java not found on PATH. Attempting package-manager install (OpenJDK 17)..."
  if command -v apt-get >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then
      sudo apt-get update && sudo apt-get install -y openjdk-17-jre-headless
    else
      apt-get update && apt-get install -y openjdk-17-jre-headless
    fi
    return $?
  fi

  if command -v dnf >/dev/null 2>&1; then
    if command -v sudo >/dev/null 2>&1; then
      sudo dnf install -y java-17-openjdk
    else
      dnf install -y java-17-openjdk
    fi
    return $?
  fi

  if command -v brew >/dev/null 2>&1; then
    brew install openjdk@17
    return $?
  fi

  echo "[bootstrap] No supported package manager detected for automatic Java install."
  return 1
}

install_portable_java() {
  local portable_root="$HOME/.local/jre17-portable"
  local os_name arch_name platform arch_id api_url archive

  if configure_java_home_from_dir "$portable_root"; then
    echo "[bootstrap] Reusing portable Java at $JAVA_HOME"
    return 0
  fi

  os_name="$(uname -s)"
  arch_name="$(uname -m)"
  case "$os_name" in
    Linux) platform="linux" ;;
    Darwin) platform="mac" ;;
    *)
      echo "[bootstrap] Portable Java fallback unsupported on OS: $os_name"
      return 1
      ;;
  esac

  case "$arch_name" in
    x86_64|amd64) arch_id="x64" ;;
    arm64|aarch64) arch_id="aarch64" ;;
    *)
      echo "[bootstrap] Portable Java fallback unsupported on arch: $arch_name"
      return 1
      ;;
  esac

  api_url="https://api.adoptium.net/v3/binary/latest/17/ga/${platform}/${arch_id}/jre/hotspot/normal/eclipse"
  archive="/tmp/temurin-jre17-${platform}-${arch_id}.tar.gz"

  echo "[bootstrap] Downloading portable Temurin JRE 17..."
  mkdir -p "$portable_root"
  rm -rf "$portable_root"/*

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 "$api_url" -o "$archive"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$archive" "$api_url"
  else
    echo "[bootstrap] Neither curl nor wget is available for portable Java download."
    return 1
  fi

  tar -xzf "$archive" -C "$portable_root" --strip-components=1
  rm -f "$archive"

  if configure_java_home_from_dir "$portable_root"; then
    echo "[bootstrap] Portable Java ready at $JAVA_HOME"
    return 0
  fi

  echo "[bootstrap] Portable Java downloaded but java binary was not found."
  return 1
}

ensure_java() {
  if command -v java >/dev/null 2>&1; then
    echo "[bootstrap] Java already available: $(show_java_version)"
    return 0
  fi

  if try_source_use_java && command -v java >/dev/null 2>&1; then
    echo "[bootstrap] Java loaded via scripts/use-java.sh: $(show_java_version)"
    return 0
  fi

  if install_java_with_package_manager && command -v java >/dev/null 2>&1; then
    echo "[bootstrap] Java installed via package manager: $(show_java_version)"
    return 0
  fi

  if install_portable_java && command -v java >/dev/null 2>&1; then
    echo "[bootstrap] Java loaded via portable install: $(show_java_version)"
    return 0
  fi

  echo "[bootstrap] ERROR: Java is required for Firebase emulators/tests and could not be configured."
  echo "[bootstrap] Please install Java 11+ (recommended OpenJDK 17) and rerun: npm run verify:bootstrap"
  exit 1
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
  local lock_file="$workspace_dir/package-lock.json"

  if needs_install "$workspace_dir"; then
    echo "[bootstrap] Installing dependencies for $label..."
    if [[ -f "$lock_file" ]]; then
      if [[ "$prefix" == "." ]]; then
        echo "[bootstrap] npm ci"
        npm ci
      else
        echo "[bootstrap] npm --prefix $prefix ci"
        npm --prefix "$prefix" ci
      fi
    else
      if [[ "$prefix" == "." ]]; then
        echo "[bootstrap] npm install"
        npm install
      else
        echo "[bootstrap] npm --prefix $prefix install"
        npm --prefix "$prefix" install
      fi
    fi
  else
    echo "[bootstrap] Dependencies for $label are up-to-date. Skipping install."
  fi
}

maybe_use_nvm
ensure_java

install_workspace_if_needed "root" "$ROOT_DIR" "."
install_workspace_if_needed "functions" "$ROOT_DIR/functions" "functions"
install_workspace_if_needed "web" "$ROOT_DIR/web" "web"

echo "[bootstrap] Running verify:local..."
npm run verify:local
echo "[bootstrap] verify:local completed successfully."
