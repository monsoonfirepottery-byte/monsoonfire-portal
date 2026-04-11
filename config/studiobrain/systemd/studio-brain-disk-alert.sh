#!/usr/bin/env bash
set -euo pipefail

THRESHOLD="${STUDIO_BRAIN_DISK_ALERT_THRESHOLD:-85}"
TARGET_PATH="${STUDIO_BRAIN_DISK_ALERT_PATH:-/}"
LOGGER_TAG="${STUDIO_BRAIN_DISK_ALERT_LOGGER_TAG:-studio-brain}"
USE="$(df --output=pcent "${TARGET_PATH}" | tail -1 | tr -dc '0-9')"

if [[ -z "${USE}" ]]; then
  echo "Unable to determine disk usage for ${TARGET_PATH}" >&2
  exit 1
fi

if (( USE >= THRESHOLD )); then
  logger -t "${LOGGER_TAG}" "Disk usage critical: ${USE}% used on ${TARGET_PATH}"
  exit 2
fi

exit 0
