#!/usr/bin/env bash
set -euo pipefail

HOST_USER="${STUDIO_BRAIN_HOST_USER:-wuff}"
HOST_HOME="${STUDIO_BRAIN_HOST_HOME:-/home/${HOST_USER}}"
REPO_ROOT="${STUDIO_BRAIN_REPO_ROOT:-${HOST_HOME}/monsoonfire-portal}"
MONITORING_ROOT="${STUDIO_BRAIN_MONITORING_ROOT:-${HOST_HOME}/monitoring}"
STAMP="$(date +%F-%H%M%S)"
OUTDIR="/var/backups/studio-brain/daily"
METADATA_PATH="${STUDIO_BRAIN_BACKUP_METADATA_PATH:-/var/backups/studio-brain/latest-metadata.json}"
RETAIN_DAYS="${STUDIO_BRAIN_BACKUP_RETAIN_DAYS:-14}"

mkdir -p "${OUTDIR}"
chmod 700 "${OUTDIR}"

archive_existing_targets() {
  local archive="$1"
  shift
  local targets=()
  for target in "$@"; do
    [[ -e "${target}" ]] && targets+=("${target}")
  done
  if [[ ${#targets[@]} -eq 0 ]]; then
    return 0
  fi
  tar -czf "${archive}" "${targets[@]}"
  chmod 600 "${archive}"
}

write_metadata() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 unavailable; skipping backup metadata manifest" >&2
    return 0
  fi

  python3 - "${OUTDIR}" "${METADATA_PATH}" "${STAMP}" "${REPO_ROOT}" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

daily_root = Path(sys.argv[1])
metadata_path = Path(sys.argv[2])
stamp = sys.argv[3]
repo_root = Path(sys.argv[4])
backup_root = metadata_path.parent


def file_record(path):
    stat = path.stat()
    return {
        "name": path.name,
        "path": str(path),
        "sizeBytes": stat.st_size,
        "mtime": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }


def directory_status(path):
    exists = path.exists()
    count = 0
    newest = None
    if exists and path.is_dir():
        files = [candidate for candidate in path.rglob("*") if candidate.is_file()]
        count = len(files)
        if files:
            newest_path = max(files, key=lambda candidate: candidate.stat().st_mtime)
            newest = file_record(newest_path)
    return {
        "path": str(path),
        "exists": exists,
        "fileCount": count,
        "newestFile": newest,
    }


archives = sorted(
    [file_record(path) for path in daily_root.glob("*.tgz") if path.is_file()],
    key=lambda item: item["mtime"],
    reverse=True,
)

payload = {
    "schema": "studio-brain-backup-metadata.v1",
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "stamp": stamp,
    "backupRoot": str(backup_root),
    "dailyRoot": str(daily_root),
    "redaction": "metadata_only_no_archive_contents_no_env_values",
    "configArchives": archives[:20],
    "dataEvidence": {
        "postgres": directory_status(backup_root / "postgres"),
        "redis": directory_status(backup_root / "redis"),
        "minio": directory_status(backup_root / "minio"),
    },
    "appBackupManifest": {
        "path": str(repo_root / "output" / "backups" / "latest.json"),
        "exists": (repo_root / "output" / "backups" / "latest.json").exists(),
    },
    "restoreDrill": directory_status(repo_root / "output" / "backups"),
}

metadata_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
os.chmod(metadata_path, 0o644)
PY
}

archive_existing_targets "${OUTDIR}/host-config-${STAMP}.tgz" \
  /etc/systemd/system/studio-brain-backup.service \
  /etc/systemd/system/studio-brain-backup.timer \
  /etc/systemd/system/studio-brain-disk-alert.service \
  /etc/systemd/system/studio-brain-disk-alert.timer \
  /etc/systemd/system/studio-brain-healthcheck.service \
  /etc/systemd/system/studio-brain-healthcheck.timer \
  /etc/systemd/system/studio-brain-reboot-watch.service \
  /etc/systemd/system/studio-brain-reboot-watch.timer \
  /usr/local/bin/studio-brain-backup.sh \
  /usr/local/bin/studio-brain-disk-alert.sh \
  /usr/local/bin/studio-brain-healthcheck.sh \
  /usr/local/bin/studio-brain-reboot-watch.sh \
  "${HOST_HOME}/.config/monsoonfire" \
  "${MONITORING_ROOT}/docker-compose.yml" \
  "${MONITORING_ROOT}/Caddyfile" \
  "${MONITORING_ROOT}/scripts/bootstrap-kuma-monitors.js" \
  "${MONITORING_ROOT}/netdata-overrides"

archive_existing_targets "${OUTDIR}/studio-brain-config-${STAMP}.tgz" \
  "${REPO_ROOT}/config/studiobrain" \
  "${REPO_ROOT}/studio-brain/docker-compose.yml" \
  "${REPO_ROOT}/studio-brain/docker-compose.proxy.yml" \
  "${REPO_ROOT}/studio-brain/docker/otel-collector.yaml" \
  "${REPO_ROOT}/studio-brain/README.md" \
  "${REPO_ROOT}/studio-brain/docs" \
  "${REPO_ROOT}/docs/runbooks/STUDIO_BRAIN_HOST_ACCESS.md" \
  "${REPO_ROOT}/docs/runbooks/STUDIO_BRAIN_HOST_DEPLOY.md" \
  "${REPO_ROOT}/docs/runbooks/STUDIO_BRAIN_HOST_STACK.md"

find "${OUTDIR}" -type f -name '*.tgz' -mtime +"${RETAIN_DAYS}" -delete
write_metadata
