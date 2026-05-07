#!/usr/bin/env bash
set -u
set -o pipefail

# Run Studio Brain PostgreSQL read-only DBA SQL packets and write redacted
# text artifacts. The SQL packets are SELECT-only and the runner wraps them in
# a READ ONLY transaction where PostgreSQL permits it.

SOURCE_PATH="${BASH_SOURCE[0]:-${0}}"
SCRIPT_DIR="$(cd "$(dirname "${SOURCE_PATH}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${1:-${REPO_ROOT}/output/ops/postgres/${STAMP}}"
PG_CONTAINER="${PG_CONTAINER:-studiobrain_postgres}"
PGDATABASE="${PGDATABASE:-monsoonfire_studio_os}"
PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}"
PSQL_STATEMENT_TIMEOUT="${PSQL_STATEMENT_TIMEOUT:-30s}"
POSTGRES_RUNNER_DIRECT="${POSTGRES_RUNNER_DIRECT:-0}"

SQL_PACKETS=(
  "postgres_db_growth_trend_snapshot.sql"
  "postgres_pg_stat_statements_rollup.sql"
  "postgres_long_transaction_lock_packet.sql"
  "postgres_autovacuum_stale_stats_report.sql"
  "postgres_roles_extensions_security_packet.sql"
)

mkdir -p "${OUT_DIR}"
chmod 700 "${OUT_DIR}" 2>/dev/null || true

sanitize_stream() {
  sed -E \
    -e 's/([Aa]uthorization:?[[:space:]]*Bearer[[:space:]]+)[^[:space:]]+/\1[redacted]/g' \
    -e 's/([Tt]oken["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Pp]assword["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/([Ss]ecret["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/g' \
    -e 's/(api[_-]?key["=:[:space:]]+)[^",[:space:]]+/\1[redacted]/Ig' \
    -e 's#(postgres(ql)?://[^:[:space:]/]+:)[^@[:space:]]+@#\1[redacted]@#Ig'
}

write_skipped_report() {
  local label="$1"
  local reason="$2"
  local file="${OUT_DIR}/${label}.txt"

  {
    printf '# %s\n' "${label}"
    printf '# generated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# scope=read_only_postgres_snapshot\n\n'
    printf 'status: skipped\n'
    printf 'reason: %s\n' "${reason}"
    printf 'next_step: set DATABASE_URL or PG* variables, or run on the Studio Brain host where %s is available.\n' "${PG_CONTAINER}"
  } >"${file}"
}

run_with_direct_psql() {
  local sql_file="$1"
  local label="$2"
  local file="${OUT_DIR}/${label}.txt"
  local psql_args=()

  if [ -n "${DATABASE_URL:-}" ]; then
    psql_args+=("${DATABASE_URL}")
  fi

  {
    printf '# %s\n' "${label}"
    printf '# generated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# scope=read_only_postgres_snapshot\n'
    printf '# runner=direct_psql\n\n'
    {
      printf '\\set ON_ERROR_STOP on\n'
      printf 'begin read only;\n'
      printf "set local statement_timeout = '%s';\n" "${PSQL_STATEMENT_TIMEOUT}"
      cat "${sql_file}"
      printf '\nrollback;\n'
    } | PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT}" psql "${psql_args[@]}" -X -f -
  } 2>&1 | sanitize_stream >"${file}"
}

run_with_docker_psql() {
  local sql_file="$1"
  local label="$2"
  local file="${OUT_DIR}/${label}.txt"

  {
    printf '# %s\n' "${label}"
    printf '# generated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '# scope=read_only_postgres_snapshot\n'
    printf '# runner=docker_exec\n\n'
    {
      printf '\\set ON_ERROR_STOP on\n'
      printf 'begin read only;\n'
      printf "set local statement_timeout = '%s';\n" "${PSQL_STATEMENT_TIMEOUT}"
      cat "${sql_file}"
      printf '\nrollback;\n'
    } | docker exec -i -u postgres "${PG_CONTAINER}" psql -d "${PGDATABASE}" -X -f -
  } 2>&1 | sanitize_stream >"${file}"
}

can_use_direct_psql() {
  command -v psql >/dev/null 2>&1 && {
    [ -n "${DATABASE_URL:-}" ] ||
    [ -n "${PGHOST:-}" ] ||
    [ -n "${PGSERVICE:-}" ] ||
    [ "${POSTGRES_RUNNER_DIRECT}" = "1" ]
  }
}

can_use_docker_psql() {
  command -v docker >/dev/null 2>&1 &&
    docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "${PG_CONTAINER}"
}

printf 'postgres snapshot output: %s\n' "${OUT_DIR}"

for packet in "${SQL_PACKETS[@]}"; do
  sql_file="${SCRIPT_DIR}/${packet}"
  label="${packet%.sql}"

  if [ ! -f "${sql_file}" ]; then
    write_skipped_report "${label}" "SQL packet ${packet} was not found"
    continue
  fi

  printf 'writing %s\n' "${OUT_DIR}/${label}.txt"
  if can_use_direct_psql; then
    if ! run_with_direct_psql "${sql_file}" "${label}"; then
      printf 'WARN: %s failed; review %s\n' "${packet}" "${OUT_DIR}/${label}.txt"
    fi
  elif can_use_docker_psql; then
    if ! run_with_docker_psql "${sql_file}" "${label}"; then
      printf 'WARN: %s failed; review %s\n' "${packet}" "${OUT_DIR}/${label}.txt"
    fi
  else
    write_skipped_report "${label}" "no configured direct psql connection and no running ${PG_CONTAINER} container"
  fi
done

cat >"${OUT_DIR}/README.md" <<EOF
# PostgreSQL Read-Only DBA Snapshot

Generated at: $(date -u +%Y-%m-%dT%H:%M:%SZ)

Scope: read-only PostgreSQL evidence. Review files for local path sensitivity before sharing outside the ops team.

Included packets:

- postgres_db_growth_trend_snapshot.txt
- postgres_pg_stat_statements_rollup.txt
- postgres_long_transaction_lock_packet.txt
- postgres_autovacuum_stale_stats_report.txt
- postgres_roles_extensions_security_packet.txt

Boundaries:

- No schema changes, DDL, VACUUM, ANALYZE, REINDEX, session termination, restore, or secret reads.
- Missing extensions, permissions, Docker, or psql connections are reported as skipped/degraded evidence.
- Query text is length-limited and literal-redacted where practical; PostgreSQL may also hide text based on role privileges.
EOF

printf 'postgres snapshot complete: %s\n' "${OUT_DIR}"
