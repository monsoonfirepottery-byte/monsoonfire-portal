#!/usr/bin/env bash
set -u

# Generate a local read-only ops evidence bundle.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${1:-${REPO_ROOT}/output/ops/${STAMP}}"
PG_CONTAINER="${PG_CONTAINER:-studiobrain_postgres}"
PGDATABASE="${PGDATABASE:-monsoonfire_studio_os}"

mkdir -p "${OUT_DIR}"

run_to_file() {
  label="$1"
  shift
  printf 'writing %s\n' "${OUT_DIR}/${label}.txt"
  {
    printf '# %s\n' "${label}"
    printf '# generated_at=%s\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    "$@"
  } >"${OUT_DIR}/${label}.txt" 2>&1
}

run_to_file system_inventory bash "${SCRIPT_DIR}/system_inventory.sh"
run_to_file docker_inventory bash "${SCRIPT_DIR}/docker_inventory.sh"
run_to_file disk_pressure bash "${SCRIPT_DIR}/disk_pressure.sh"
run_to_file log_pressure bash "${SCRIPT_DIR}/log_pressure.sh"
run_to_file dependency_inventory bash "${SCRIPT_DIR}/dependency_inventory.sh"
run_to_file backup_evidence bash "${SCRIPT_DIR}/backup_evidence.sh"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
  run_to_file postgres_readonly_review docker exec -i -u postgres "${PG_CONTAINER}" psql -d "${PGDATABASE}" -X -v ON_ERROR_STOP=1 -f - <"${SCRIPT_DIR}/postgres_readonly_review.sql"
else
  {
    echo "PostgreSQL docker container ${PG_CONTAINER} was not available."
    echo "Run manually with: psql -X -v ON_ERROR_STOP=1 -f scripts/ops/postgres_readonly_review.sql"
  } >"${OUT_DIR}/postgres_readonly_review.txt"
fi

cat >"${OUT_DIR}/README.md" <<EOF
# Studio Brain Ops Evidence Bundle

Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

This bundle is read-only and should not contain secrets. Review before sharing outside the ops team.
EOF

printf 'ops report written to %s\n' "${OUT_DIR}"
