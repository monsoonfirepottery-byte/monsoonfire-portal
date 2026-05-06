#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${STUDIO_BRAIN_REPO_ROOT:-/home/wuff/monsoonfire-portal}"
PROFILE="${STUDIO_BRAIN_IDLE_WORKER_PROFILE:-idle}"
JOBS="${STUDIO_BRAIN_IDLE_WORKER_JOBS:-memory,repo,harness,wiki}"
WIKI_MODE="${STUDIO_BRAIN_IDLE_WORKER_WIKI_MODE:-check}"
NODE_BIN="${STUDIO_BRAIN_NODE_BIN:-$(command -v node || true)}"
RUN_USER="${STUDIO_BRAIN_IDLE_WORKER_RUN_USER:-wuff}"

if [[ -z "${NODE_BIN}" ]]; then
  echo "node binary not found for Studio Brain idle worker" >&2
  exit 127
fi

if [[ ! -d "${REPO_ROOT}" ]]; then
  echo "Studio Brain repo root not found: ${REPO_ROOT}" >&2
  exit 1
fi

ARGS=(--profile "${PROFILE}" --jobs "${JOBS}")

if [[ -n "${WIKI_MODE}" ]]; then
  ARGS+=(--wiki-mode "${WIKI_MODE}")
fi

if [[ -n "${STUDIO_BRAIN_IDLE_WORKER_REPO_DEPTH:-}" ]]; then
  ARGS+=(--repo-depth "${STUDIO_BRAIN_IDLE_WORKER_REPO_DEPTH}")
fi

if [[ -n "${STUDIO_BRAIN_IDLE_WORKER_MAX_LOAD_1M:-}" ]]; then
  ARGS+=(--max-load-1m "${STUDIO_BRAIN_IDLE_WORKER_MAX_LOAD_1M}")
fi

if [[ "${STUDIO_BRAIN_IDLE_WORKER_STRICT:-}" == "true" ]]; then
  ARGS+=(--strict)
fi

cd "${REPO_ROOT}"
if [[ "$(id -u)" -eq 0 && -n "${RUN_USER}" ]]; then
  exec runuser -u "${RUN_USER}" -- "${NODE_BIN}" ./scripts/studiobrain-idle-worker.mjs "${ARGS[@]}"
fi

exec "${NODE_BIN}" ./scripts/studiobrain-idle-worker.mjs "${ARGS[@]}"
