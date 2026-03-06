#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IMAGE_NAME="${LIBRATOM_IMAGE:-monsoonfire/libratom:0.7.1-r2}"
DEFAULT_LIBRATOM_DOCKER_MEMORY="6g"
LIBRATOM_DOCKER_MEMORY="${LIBRATOM_DOCKER_MEMORY:-${DEFAULT_LIBRATOM_DOCKER_MEMORY}}"
LIBRATOM_DOCKER_MEMORY_SWAP="${LIBRATOM_DOCKER_MEMORY_SWAP:-}"
LIBRATOM_DOCKER_CPUS="${LIBRATOM_DOCKER_CPUS:-2}"
LIBRATOM_REPORT_JOBS="${LIBRATOM_REPORT_JOBS:-1}"

if [[ -z "${LIBRATOM_DOCKER_MEMORY_SWAP}" ]]; then
  if [[ "${LIBRATOM_DOCKER_MEMORY}" == "${DEFAULT_LIBRATOM_DOCKER_MEMORY}" ]]; then
    LIBRATOM_DOCKER_MEMORY_SWAP="8g"
  else
    LIBRATOM_DOCKER_MEMORY_SWAP="${LIBRATOM_DOCKER_MEMORY}"
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for scripts/libratom.sh" >&2
  exit 1
fi

if ! docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1; then
  echo "Building ${IMAGE_NAME} from tools/libratom/Dockerfile..." >&2
  docker build -t "${IMAGE_NAME}" "${REPO_ROOT}/tools/libratom"
fi

libratom_args=("$@")
if [[ "${1:-}" == "report" && -n "${LIBRATOM_REPORT_JOBS}" ]]; then
  has_jobs_flag="false"
  for arg in "${libratom_args[@]:1}"; do
    if [[ "${arg}" == "--jobs" || "${arg}" == "--jobs="* || "${arg}" == "-j" ]]; then
      has_jobs_flag="true"
      break
    fi
  done
  if [[ "${has_jobs_flag}" == "false" ]]; then
    libratom_args=("${libratom_args[0]}" "--jobs" "${LIBRATOM_REPORT_JOBS}" "${libratom_args[@]:1}")
  fi
fi

docker_args=(
  --rm
  -u "$(id -u):$(id -g)"
  -v "${PWD}:/workspace"
  -w /workspace
)

if [[ -n "${LIBRATOM_DOCKER_CPUS}" ]]; then
  docker_args+=(--cpus "${LIBRATOM_DOCKER_CPUS}")
fi

if [[ -n "${LIBRATOM_DOCKER_MEMORY}" ]]; then
  docker_args+=(--memory "${LIBRATOM_DOCKER_MEMORY}")
  if [[ -n "${LIBRATOM_DOCKER_MEMORY_SWAP}" ]]; then
    docker_args+=(--memory-swap "${LIBRATOM_DOCKER_MEMORY_SWAP}")
  fi
fi

exec docker run \
  "${docker_args[@]}" \
  "${IMAGE_NAME}" \
  "${libratom_args[@]}"
