#!/usr/bin/env bash
set -euo pipefail

HOST_USER="${STUDIO_BRAIN_DEPLOY_USER:-${USER:-wuff}}"
HOST_HOME="${STUDIO_BRAIN_HOST_HOME:-/home/${HOST_USER}}"
BAMBU_ROOT="${STUDIO_BRAIN_BAMBU_ROOT:-/opt/studiobrain/bambu-studio}"
CURRENT_ROOT="${STUDIO_BRAIN_BAMBU_CURRENT_ROOT:-${BAMBU_ROOT}/current}"
APPDIR="${STUDIO_BRAIN_BAMBU_APPDIR:-${CURRENT_ROOT}/squashfs-root}"
APP_RUN="${STUDIO_BRAIN_BAMBU_APP_RUN:-${APPDIR}/AppRun}"
APPIMAGE="${STUDIO_BRAIN_BAMBU_APPIMAGE:-${CURRENT_ROOT}/BambuStudio.AppImage}"
DATA_ROOT="${STUDIO_BRAIN_BAMBU_DATA_ROOT:-${HOST_HOME}/studiobrain-data/bambu}"
SMOKE_3MF="${STUDIO_BRAIN_BAMBU_SMOKE_3MF:-${APPDIR}/resources/calib/pressure_advance/auto_pa_line_single.3mf}"
XVFB_MODE="${STUDIO_BRAIN_BAMBU_XVFB_MODE:-auto}"
XVFB_ARGS="${STUDIO_BRAIN_BAMBU_XVFB_ARGS:--screen 0 1280x1024x24}"

usage() {
  cat <<'EOF'
Usage:
  studiobrain-bambu-cli.sh status [--json]
  studiobrain-bambu-cli.sh smoke [--json] [--output-dir DIR] [--keep-output]
  studiobrain-bambu-cli.sh run [bambu-cli args...]

Notes:
  - The wrapper runs the installed Bambu Studio AppImage extract from /opt/studiobrain/bambu-studio/current by default.
  - On headless hosts the wrapper prefers xvfb-run when DISPLAY is not available.
  - For raw STL slicing, supply the same full settings JSON files the official Bambu CLI expects.
EOF
}

json_quote() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${1:-}"
}

resolve_runner() {
  if [[ ! -x "${APP_RUN}" ]]; then
    echo "Missing Bambu Studio AppRun at ${APP_RUN}" >&2
    exit 1
  fi

  local use_xvfb="0"
  case "${XVFB_MODE}" in
    always)
      use_xvfb="1"
      ;;
    never)
      use_xvfb="0"
      ;;
    auto)
      if [[ -z "${DISPLAY:-}" && -x "$(command -v xvfb-run || true)" ]]; then
        use_xvfb="1"
      fi
      ;;
    *)
      echo "Invalid STUDIO_BRAIN_BAMBU_XVFB_MODE: ${XVFB_MODE}" >&2
      exit 1
      ;;
  esac

  export HOME="${HOME:-${HOST_HOME}}"
  export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
  export XDG_CACHE_HOME="${XDG_CACHE_HOME:-${HOME}/.cache}"
  if [[ -z "${XDG_RUNTIME_DIR:-}" && -d "/run/user/$(id -u)" ]]; then
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  fi

  if [[ "${use_xvfb}" == "1" ]]; then
    RUNNER=(
      xvfb-run
      -a
      -s "${XVFB_ARGS}"
      env
      GDK_BACKEND=x11
      QT_QPA_PLATFORM=xcb
      XDG_SESSION_TYPE=x11
      WINIT_UNIX_BACKEND=x11
      SDL_VIDEODRIVER=x11
      WAYLAND_DISPLAY=
      WAYLAND_SOCKET=
      "${APP_RUN}"
    )
  else
    RUNNER=("${APP_RUN}")
  fi
}

print_status() {
  local as_json="${1:-0}"
  local current_target=""
  if [[ -e "${CURRENT_ROOT}" ]]; then
    current_target="$(readlink -f "${CURRENT_ROOT}" || true)"
  fi
  local version_name=""
  if [[ -n "${current_target}" ]]; then
    version_name="$(basename "${current_target}")"
  fi
  local xvfb_path=""
  xvfb_path="$(command -v xvfb-run || true)"
  resolve_runner
  local uses_xvfb="false"
  if [[ "${RUNNER[0]}" == "xvfb-run" ]]; then
    uses_xvfb="true"
  fi

  if [[ "${as_json}" == "1" ]]; then
    cat <<EOF
{"ok":true,"installed":$([[ -x "${APP_RUN}" ]] && echo true || echo false),"version":$(json_quote "${version_name}"),"appRun":$(json_quote "${APP_RUN}"),"appImage":$(json_quote "${APPIMAGE}"),"sample3mf":$(json_quote "${SMOKE_3MF}"),"dataRoot":$(json_quote "${DATA_ROOT}"),"xvfbPath":$(json_quote "${xvfb_path}"),"usesXvfb":${uses_xvfb}}
EOF
  else
    echo "installed=$([[ -x "${APP_RUN}" ]] && echo true || echo false)"
    echo "version=${version_name}"
    echo "app_run=${APP_RUN}"
    echo "app_image=${APPIMAGE}"
    echo "sample_3mf=${SMOKE_3MF}"
    echo "data_root=${DATA_ROOT}"
    echo "xvfb_path=${xvfb_path}"
    echo "uses_xvfb=${uses_xvfb}"
  fi
}

run_smoke() {
  local as_json="0"
  local output_dir=""
  local keep_output="0"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)
        as_json="1"
        shift
        ;;
      --output-dir)
        output_dir="${2:-}"
        shift 2
        ;;
      --keep-output)
        keep_output="1"
        shift
        ;;
      *)
        echo "Unknown smoke argument: $1" >&2
        exit 1
        ;;
    esac
  done

  if [[ ! -f "${SMOKE_3MF}" ]]; then
    echo "Missing Bambu smoke fixture: ${SMOKE_3MF}" >&2
    exit 1
  fi

  local run_id
  run_id="$(date +%Y%m%d-%H%M%S)"
  if [[ -z "${output_dir}" ]]; then
    output_dir="${DATA_ROOT}/smoke/${run_id}"
  fi
  mkdir -p "${output_dir}"

  local exported_3mf="${output_dir}/smoke-slice.3mf"
  local export_name="smoke-slice.3mf"
  local stdout_log="${output_dir}/stdout.log"
  local stderr_log="${output_dir}/stderr.log"

  resolve_runner
  set +e
  "${RUNNER[@]}" --slice 0 --debug 2 --outputdir "${output_dir}" --export-3mf "${export_name}" "${SMOKE_3MF}" >"${stdout_log}" 2>"${stderr_log}"
  local exit_code=$?
  set -e

  if [[ "${as_json}" == "1" ]]; then
    python3 - "${output_dir}" "${exported_3mf}" "${stdout_log}" "${stderr_log}" "${exit_code}" "${keep_output}" <<'PY'
import json
import pathlib
import sys

output_dir, exported_3mf, stdout_log, stderr_log, exit_code, keep_output = sys.argv[1:7]
payload = {
    "ok": int(exit_code) == 0,
    "exitCode": int(exit_code),
    "outputDir": output_dir,
    "exported3mf": exported_3mf,
    "stdoutLog": stdout_log,
    "stderrLog": stderr_log,
    "keepOutput": keep_output == "1",
}
for key in ("exported3mf", "stdoutLog", "stderrLog"):
    payload[f"{key}Exists"] = pathlib.Path(payload[key]).exists()
print(json.dumps(payload))
PY
  else
    echo "exit_code=${exit_code}"
    echo "output_dir=${output_dir}"
    echo "exported_3mf=${exported_3mf}"
    echo "stdout_log=${stdout_log}"
    echo "stderr_log=${stderr_log}"
  fi

  if [[ "${exit_code}" -eq 0 && "${keep_output}" != "1" ]]; then
    rm -rf "${output_dir}"
  fi

  return "${exit_code}"
}

run_passthrough() {
  resolve_runner
  exec "${RUNNER[@]}" "$@"
}

subcommand="${1:-status}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "${subcommand}" in
  status)
    as_json="0"
    if [[ "${1:-}" == "--json" ]]; then
      as_json="1"
      shift
    fi
    if [[ $# -gt 0 ]]; then
      echo "status does not accept extra arguments" >&2
      exit 1
    fi
    print_status "${as_json}"
    ;;
  smoke)
    run_smoke "$@"
    ;;
  run)
    if [[ $# -eq 0 ]]; then
      echo "run requires at least one Bambu CLI argument" >&2
      exit 1
    fi
    run_passthrough "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    run_passthrough "${subcommand}" "$@"
    ;;
esac
