#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 2 ]]; then
  cat <<'USAGE'
Usage:
  ./scripts/libratom-export-jsonl.sh <report.sqlite3> <output.jsonl> [max_body_chars]

Description:
  Converts a libratom report database into Open Memory import JSONL.
  Run this after:
    ./scripts/libratom.sh report -m -o <report.sqlite3> <mailbox.pst>

Arguments:
  report.sqlite3   Path to libratom report DB (contains file_report + message rows)
  output.jsonl     Output JSONL file ready for npm run open-memory -- import
  max_body_chars   Optional body snippet cap (default: 1200)

Environment:
  LIBRATOM_IMAGE   Container image used for python/sqlite conversion.
                   Default: monsoonfire/libratom:0.7.1-r2
  LIBRATOM_DOCKER_MEMORY
                   Docker memory limit for the converter container.
                   Default: 6g
  LIBRATOM_DOCKER_MEMORY_SWAP
                   Docker memory+swap ceiling for the converter container.
                   Default: 8g when using the default memory limit
  LIBRATOM_DOCKER_CPUS
                   Docker CPU limit for the converter container.
                   Default: 2
USAGE
  exit 0
fi

DB_PATH="${1}"
OUT_PATH="${2}"
MAX_BODY_CHARS="${3:-1200}"
IMAGE_NAME="${LIBRATOM_IMAGE:-monsoonfire/libratom:0.7.1-r2}"
DEFAULT_LIBRATOM_DOCKER_MEMORY="6g"
LIBRATOM_DOCKER_MEMORY="${LIBRATOM_DOCKER_MEMORY:-${DEFAULT_LIBRATOM_DOCKER_MEMORY}}"
LIBRATOM_DOCKER_MEMORY_SWAP="${LIBRATOM_DOCKER_MEMORY_SWAP:-}"
LIBRATOM_DOCKER_CPUS="${LIBRATOM_DOCKER_CPUS:-2}"

if [[ -z "${LIBRATOM_DOCKER_MEMORY_SWAP}" ]]; then
  if [[ "${LIBRATOM_DOCKER_MEMORY}" == "${DEFAULT_LIBRATOM_DOCKER_MEMORY}" ]]; then
    LIBRATOM_DOCKER_MEMORY_SWAP="8g"
  else
    LIBRATOM_DOCKER_MEMORY_SWAP="${LIBRATOM_DOCKER_MEMORY}"
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for scripts/libratom-export-jsonl.sh" >&2
  exit 1
fi

if [[ ! -f "${DB_PATH}" ]]; then
  echo "Input DB not found: ${DB_PATH}" >&2
  exit 1
fi

mkdir -p "$(dirname "${OUT_PATH}")"

docker_args=(
  --rm
  -i
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

docker run \
  "${docker_args[@]}" \
  --entrypoint python \
  "${IMAGE_NAME}" \
  - "${DB_PATH}" "${OUT_PATH}" "${MAX_BODY_CHARS}" <<'PY'
import hashlib
import json
import sqlite3
import sys
from email.parser import HeaderParser

db_path = sys.argv[1]
out_path = sys.argv[2]
try:
    max_body_chars = int(sys.argv[3])
except ValueError:
    max_body_chars = 1200

parser = HeaderParser()
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA temp_store = FILE")
conn.execute("PRAGMA cache_size = -20000")
cur = conn.cursor()

query = """
SELECT
  m.id AS message_id,
  m.pff_identifier AS pff_identifier,
  m.date AS message_date,
  m.headers AS headers,
  m.body AS body,
  fr.path AS file_path,
  fr.name AS file_name
FROM message AS m
LEFT JOIN file_report AS fr ON fr.id = m.file_report_id
ORDER BY
  CASE WHEN m.date IS NULL OR m.date = '' THEN 1 ELSE 0 END,
  m.date,
  m.id
"""

written = 0

with open(out_path, "w", encoding="utf-8") as handle:
    for row in cur.execute(query):
        headers_raw = row["headers"] or ""
        headers = parser.parsestr(headers_raw)
        subject = (headers.get("Subject") or "").strip()
        sender = (headers.get("From") or "").strip()
        recipients = (headers.get("To") or "").strip()
        date_text = (row["message_date"] or "").strip()

        body_raw = row["body"] or ""
        body_clean = " ".join(body_raw.replace("\r", "\n").split())
        snippet = body_clean[:max_body_chars].strip()
        if len(body_clean) > len(snippet):
            snippet = f"{snippet}…"

        parts = []
        if date_text:
            parts.append(f"On {date_text}")
        else:
            parts.append("Undated message")
        if sender:
            parts.append(f"from {sender}")
        if recipients:
            parts.append(f"to {recipients}")
        if subject:
            parts.append(f'subject "{subject}"')

        prefix = " ".join(parts).strip()
        content = f"{prefix}. {snippet}".strip() if snippet else prefix
        content = content.strip(" .")
        if not content:
            continue

        stable_key = f"{db_path}:{row['message_id']}:{row['pff_identifier']}"
        client_request_id = f"pst-{hashlib.sha256(stable_key.encode('utf-8')).hexdigest()[:24]}"

        payload = {
            "content": content,
            "source": "pst:libratom",
            "tags": ["pst", "email", "import"],
            "metadata": {
                "mailboxPath": row["file_path"],
                "mailboxName": row["file_name"],
                "subject": subject,
                "from": sender,
                "to": recipients,
                "messageDate": date_text,
                "messageId": row["message_id"],
                "pffIdentifier": row["pff_identifier"],
            },
            "clientRequestId": client_request_id,
        }
        if date_text:
            payload["occurredAt"] = date_text

        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
        written += 1

print(json.dumps({"ok": True, "written": written, "output": out_path}))
PY
