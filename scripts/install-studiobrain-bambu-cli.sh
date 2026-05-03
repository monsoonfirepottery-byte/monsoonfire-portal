#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

HOST_USER="${STUDIO_BRAIN_DEPLOY_USER:-${SUDO_USER:-wuff}}"
INSTALL_ROOT="${STUDIO_BRAIN_BAMBU_ROOT:-/opt/studiobrain/bambu-studio}"
CACHE_ROOT="${STUDIO_BRAIN_BAMBU_CACHE_ROOT:-/var/cache/studiobrain/bambu-studio}"
BIN_LINK="${STUDIO_BRAIN_BAMBU_BIN_LINK:-/usr/local/bin/studiobrain-bambu-cli}"
TAG="${STUDIO_BRAIN_BAMBU_TAG:-v02.05.02.51}"
FLAVOR="${STUDIO_BRAIN_BAMBU_FLAVOR:-ubuntu-24.04}"
RELEASE_API="${STUDIO_BRAIN_BAMBU_RELEASE_API:-https://api.github.com/repos/bambulab/BambuStudio/releases/tags/${TAG}}"
FORCE_INSTALL="${STUDIO_BRAIN_BAMBU_FORCE_INSTALL:-0}"

WRAPPER_SRC="${REPO_ROOT}/scripts/studiobrain-bambu-cli.sh"
VERSION_ROOT="${INSTALL_ROOT}/${TAG}"
CURRENT_LINK="${INSTALL_ROOT}/current"
DOWNLOAD_DIR="${CACHE_ROOT}/${TAG}"
META_PATH="${DOWNLOAD_DIR}/release.json"

for required in curl python3 install sha256sum; do
  if ! command -v "${required}" >/dev/null 2>&1; then
    echo "Missing required command for Bambu CLI install: ${required}" >&2
    exit 1
  fi
done

assert_child_path() {
  local target="$1"
  local root="$2"
  local label="$3"
  python3 - "${target}" "${root}" "${label}" <<'PY'
import pathlib
import sys

target = pathlib.Path(sys.argv[1]).expanduser().resolve(strict=False)
root = pathlib.Path(sys.argv[2]).expanduser().resolve(strict=False)
label = sys.argv[3]

try:
    target.relative_to(root)
except ValueError:
    raise SystemExit(f"Refusing destructive cleanup outside {label}: {target} not under {root}")

if target == root or str(target) == "/":
    raise SystemExit(f"Refusing destructive cleanup at unsafe {label}: {target}")
PY
}

export DEBIAN_FRONTEND=noninteractive
runtime_packages=(
  libwebkit2gtk-4.1-0
  libjavascriptcoregtk-4.1-0
)
missing_packages=()
for package_name in "${runtime_packages[@]}"; do
  if ! dpkg -s "${package_name}" >/dev/null 2>&1; then
    missing_packages+=("${package_name}")
  fi
done
if [[ "${#missing_packages[@]}" -gt 0 ]]; then
  apt-get update
  apt-get install -y "${missing_packages[@]}"
fi

if [[ ! -x "${WRAPPER_SRC}" ]]; then
  chmod 0755 "${WRAPPER_SRC}"
fi

install -d -m 0755 "${INSTALL_ROOT}" "${CACHE_ROOT}" "${DOWNLOAD_DIR}"

curl -fsSL "${RELEASE_API}" -o "${META_PATH}"

mapfile -t asset_fields < <(
  python3 - "${META_PATH}" "${FLAVOR}" "${TAG}" <<'PY'
import json
import sys

meta_path, flavor, tag = sys.argv[1:4]
with open(meta_path, "r", encoding="utf-8") as handle:
    payload = json.load(handle)

needle = f"BambuStudio_{flavor}_{tag}"
match = None
for asset in payload.get("assets", []):
    name = str(asset.get("name", ""))
    if needle in name and name.endswith(".AppImage"):
        match = asset
        break

if match is None:
    raise SystemExit(f"Unable to find AppImage asset matching {needle}")

digest = str(match.get("digest", "") or "")
if digest.startswith("sha256:"):
    digest = digest.split(":", 1)[1]

print(str(match["name"]))
print(str(match["browser_download_url"]))
print(digest)
PY
)

if [[ "${#asset_fields[@]}" -lt 3 ]]; then
  echo "Failed to resolve Bambu Studio release asset from ${RELEASE_API}" >&2
  exit 1
fi

ASSET_NAME="${asset_fields[0]}"
ASSET_URL="${asset_fields[1]}"
ASSET_SHA256="${asset_fields[2]}"
APPIMAGE_PATH="${DOWNLOAD_DIR}/${ASSET_NAME}"
VERSION_APPIMAGE_PATH="${VERSION_ROOT}/BambuStudio.AppImage"
APPDIR_PATH="${VERSION_ROOT}/squashfs-root"

if [[ ! -f "${APPIMAGE_PATH}" || "${FORCE_INSTALL}" == "1" ]]; then
  curl -fL --retry 3 --retry-delay 2 "${ASSET_URL}" -o "${APPIMAGE_PATH}"
fi

if [[ -n "${ASSET_SHA256}" ]]; then
  actual_sha256="$(sha256sum "${APPIMAGE_PATH}" | awk '{print $1}')"
  if [[ "${actual_sha256}" != "${ASSET_SHA256}" ]]; then
    echo "Bambu Studio AppImage checksum mismatch for ${APPIMAGE_PATH}" >&2
    exit 1
  fi
fi

if [[ ! -d "${APPDIR_PATH}" || "${FORCE_INSTALL}" == "1" ]]; then
  assert_child_path "${VERSION_ROOT}" "${INSTALL_ROOT}" "Bambu install root"
  rm -rf "${VERSION_ROOT}"
  install -d -m 0755 "${VERSION_ROOT}"
  install -m 0755 "${APPIMAGE_PATH}" "${VERSION_APPIMAGE_PATH}"
  (
    cd "${VERSION_ROOT}"
    ./BambuStudio.AppImage --appimage-extract >/dev/null
  )
fi

if [[ ! -x "${APPDIR_PATH}/AppRun" ]]; then
  echo "Bambu Studio AppRun missing after extraction: ${APPDIR_PATH}/AppRun" >&2
  exit 1
fi

ln -sfn "${VERSION_ROOT}" "${CURRENT_LINK}"
ln -sfn "${WRAPPER_SRC}" "${BIN_LINK}"

python3 - "${INSTALL_ROOT}" "${CURRENT_LINK}" "${BIN_LINK}" "${HOST_USER}" "${ASSET_NAME}" <<'PY'
import json
import os
import sys

install_root, current_link, bin_link, host_user, asset_name = sys.argv[1:6]
payload = {
    "ok": True,
    "installRoot": install_root,
    "current": os.path.realpath(current_link),
    "binLink": bin_link,
    "hostUser": host_user,
    "assetName": asset_name,
}
print(json.dumps(payload))
PY
