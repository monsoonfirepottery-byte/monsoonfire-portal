#!/usr/bin/env bash
set -u

# Read Studio Brain privileged evidence artifacts without requiring sudo.
# This is the agent-facing side of the privileged evidence lane.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." 2>/dev/null && pwd || pwd)"
EVIDENCE_ROOT="${STUDIO_BRAIN_PRIVILEGED_EVIDENCE_DIR:-/var/lib/studio-brain/ops-evidence}"
OUTPUT_DIR="${REPO_ROOT}/output/ops/privileged-evidence"
RUN_SELECTOR="latest"
LIST_ONLY=0
SUMMARY_ONLY=0
CAT_FILE=""

usage() {
  cat <<'EOF'
Studio Brain privileged evidence reader

Usage:
  bash scripts/ops/privileged_evidence_read.sh [--evidence-dir <path>] [--run latest|<run-id>] [--list] [--summary] [--cat <file>]

Options:
  --evidence-dir <path>  Evidence root. Default: /var/lib/studio-brain/ops-evidence.
  --run <value>          latest or a run directory name. Default: latest.
  --list                 List files in the selected run.
  --summary              Print summary.json only.
  --cat <file>           Print one file from the selected run. Basename only.
  -h, --help             Show this help.

If the default host evidence path is unavailable, the reader falls back to
output/ops/privileged-evidence in the repository checkout.
EOF
}

require_value() {
  local option="$1"
  local value="${2:-}"
  if [ -z "${value}" ] || [ "${value#--}" != "${value}" ]; then
    printf 'Missing value for %s\n' "${option}" >&2
    usage >&2
    exit 2
  fi
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g'
}

write_latest_artifacts() {
  status="$1"
  reason="${2:-}"
  run_dir="${3:-}"
  mkdir -p "${OUTPUT_DIR}" 2>/dev/null || return 0

  generated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)"
  file_count=0
  summary_present=false
  if [ -n "${run_dir}" ] && [ -d "${run_dir}" ]; then
    file_count="$(find "${run_dir}" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"
    if [ -f "${run_dir}/summary.json" ]; then
      summary_present=true
    fi
  fi

  cat > "${OUTPUT_DIR}/latest.json" <<EOF
{
  "schema": "studio-brain.ops.privileged-evidence-read.v1",
  "generatedAt": "$(json_escape "${generated_at}")",
  "readOnly": true,
  "status": "$(json_escape "${status}")",
  "reason": "$(json_escape "${reason}")",
  "evidenceRoot": "$(json_escape "${EVIDENCE_ROOT}")",
  "runSelector": "$(json_escape "${RUN_SELECTOR}")",
  "runDir": "$(json_escape "${run_dir}")",
  "summaryPresent": ${summary_present},
  "fileCount": ${file_count},
  "safeNextStep": "If status is unavailable or missing, run the approval-gated collector or install the root-owned timer; do not bypass sudo or mutate host state from this reader."
}
EOF

  cat > "${OUTPUT_DIR}/latest.md" <<EOF
# Privileged Evidence Read

- Generated: ${generated_at}
- Status: ${status}
- Reason: ${reason:-none}
- Evidence root: ${EVIDENCE_ROOT}
- Run selector: ${RUN_SELECTOR}
- Run dir: ${run_dir:-none}
- Summary present: ${summary_present}
- File count: ${file_count}

## Safety

This reader is read-only. If privileged evidence is unavailable or missing, the safe next step is an approval-gated capture path, not sudo bypass or host mutation from the agent lane.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --evidence-dir)
      require_value "$1" "${2:-}"
      EVIDENCE_ROOT="$2"
      shift 2
      ;;
    --evidence-dir=*)
      EVIDENCE_ROOT="${1#*=}"
      shift
      ;;
    --run)
      require_value "$1" "${2:-}"
      RUN_SELECTOR="$2"
      shift 2
      ;;
    --run=*)
      RUN_SELECTOR="${1#*=}"
      shift
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
    --summary)
      SUMMARY_ONLY=1
      shift
      ;;
    --cat)
      require_value "$1" "${2:-}"
      CAT_FILE="$2"
      shift 2
      ;;
    --cat=*)
      CAT_FILE="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ ! -d "${EVIDENCE_ROOT}" ]; then
  fallback="${REPO_ROOT}/output/ops/privileged-evidence"
  if [ -d "${fallback}" ] && { [ -L "${fallback}/latest" ] || [ -d "${fallback}/latest" ] || [ -f "${fallback}/latest.path" ] || find "${fallback}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | grep -q .; }; then
    EVIDENCE_ROOT="${fallback}"
  fi
fi

if [ ! -d "${EVIDENCE_ROOT}" ]; then
  write_latest_artifacts "unavailable" "privileged evidence directory is not readable" ""
  cat <<EOF
status: unavailable
reason: privileged evidence directory is not readable
evidence_root: ${EVIDENCE_ROOT}
safe_next_step: run the approval-gated collector or install the root-owned timer.
EOF
  exit 0
fi

resolve_latest() {
  if [ -L "${EVIDENCE_ROOT}/latest" ]; then
    if [ -d "${EVIDENCE_ROOT}/latest" ]; then
      cd "${EVIDENCE_ROOT}/latest" 2>/dev/null && pwd
      return 0
    fi
  fi
  if [ -f "${EVIDENCE_ROOT}/latest.path" ]; then
    latest_path="$(sed -n '1p' "${EVIDENCE_ROOT}/latest.path")"
    if [ -n "${latest_path}" ] && [ -d "${latest_path}" ]; then
      cd "${latest_path}" 2>/dev/null && pwd
      return 0
    fi
  fi
  if [ -d "${EVIDENCE_ROOT}/latest" ]; then
    cd "${EVIDENCE_ROOT}/latest" 2>/dev/null && pwd
    return 0
  fi
  find "${EVIDENCE_ROOT}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk 'NR==1 {sub(/^[^ ]+ /, ""); print}'
}

if [ "${RUN_SELECTOR}" = "latest" ]; then
  RUN_DIR="$(resolve_latest)"
else
  case "${RUN_SELECTOR}" in
    *[!A-Za-z0-9._-]*|"")
      printf 'Invalid run selector: %s\n' "${RUN_SELECTOR}" >&2
      exit 2
      ;;
    *)
      RUN_DIR="${EVIDENCE_ROOT}/${RUN_SELECTOR}"
      ;;
  esac
fi

if [ -z "${RUN_DIR}" ] || [ ! -d "${RUN_DIR}" ]; then
  write_latest_artifacts "missing" "no privileged evidence run was found" ""
  cat <<EOF
status: missing
reason: no privileged evidence run was found
evidence_root: ${EVIDENCE_ROOT}
run: ${RUN_SELECTOR}
EOF
  exit 0
fi

if [ -n "${CAT_FILE}" ]; then
  case "${CAT_FILE}" in
    *[!A-Za-z0-9._-]*|"")
      printf 'Invalid file selector: %s\n' "${CAT_FILE}" >&2
      exit 2
      ;;
  esac
  if [ ! -f "${RUN_DIR}/${CAT_FILE}" ]; then
    printf 'status: missing_file\nrun_dir: %s\nfile: %s\n' "${RUN_DIR}" "${CAT_FILE}"
    exit 0
  fi
  sed -n '1,260p' "${RUN_DIR}/${CAT_FILE}"
  exit 0
fi

if [ "${SUMMARY_ONLY}" = "1" ]; then
  if [ -f "${RUN_DIR}/summary.json" ]; then
    sed -n '1,260p' "${RUN_DIR}/summary.json"
  else
    printf 'status: missing_summary\nrun_dir: %s\n' "${RUN_DIR}"
  fi
  exit 0
fi

if [ "${LIST_ONLY}" = "1" ]; then
  printf 'run_dir: %s\n' "${RUN_DIR}"
  find "${RUN_DIR}" -maxdepth 1 -type f -printf '%f\t%s bytes\n' 2>/dev/null | sort
  exit 0
fi

write_latest_artifacts "available" "" "${RUN_DIR}"

printf 'status: available\n'
printf 'evidence_root: %s\n' "${EVIDENCE_ROOT}"
printf 'run_dir: %s\n' "${RUN_DIR}"
printf '\n## Summary\n'
if [ -f "${RUN_DIR}/summary.json" ]; then
  sed -n '1,220p' "${RUN_DIR}/summary.json"
else
  printf 'missing summary.json\n'
fi
printf '\n## Files\n'
find "${RUN_DIR}" -maxdepth 1 -type f -printf '%f\t%s bytes\n' 2>/dev/null | sort | sed -n '1,120p'
