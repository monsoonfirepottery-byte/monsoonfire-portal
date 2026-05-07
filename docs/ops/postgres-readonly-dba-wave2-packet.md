# PostgreSQL Read-Only DBA Wave 2 Packet

Date: 2026-05-07.

This packet extends the DBA evidence lane without schema changes. It is safe to
run from an existing read-only PostgreSQL connection or on the Studio Brain host
against the `studiobrain_postgres` container.

## Artifacts

| Artifact | Purpose |
| --- | --- |
| `scripts/ops/postgres_readonly_snapshot_runner.sh` | Runs the DBA SQL packets into timestamped text artifacts with secret-oriented stream redaction. |
| `scripts/ops/postgres_db_growth_trend_snapshot.sql` | Captures database, schema, table, individual index, and table/index ratio snapshots for weekly growth diffs. |
| `scripts/ops/postgres_pg_stat_statements_rollup.sql` | Detects `pg_stat_statements` visibility and, when available, rolls up redacted query families by statement kind and primary relation. |
| `scripts/ops/postgres_long_transaction_lock_packet.sql` | Captures long transaction, idle-in-transaction, waiting activity, blocking pairs, lock summaries, and prepared transactions. |
| `scripts/ops/postgres_autovacuum_stale_stats_report.sql` | Reports autovacuum settings, stale analyze candidates, vacuum threshold leads, and custom table autovacuum options. |

## Operator Commands

Run the full packet:

```bash
bash scripts/ops/postgres_readonly_snapshot_runner.sh
```

For a local socket connection without `PGHOST`, set `POSTGRES_RUNNER_DIRECT=1`
so the runner does not accidentally prefer an unconfigured workstation `psql`
over the Studio Brain Docker container.

Run a single SQL packet with an existing safe connection:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/ops/postgres_long_transaction_lock_packet.sql
```

Run through the container on the Studio Brain host:

```bash
docker exec -i -u postgres studiobrain_postgres psql -d monsoonfire_studio_os -X -v ON_ERROR_STOP=1 < scripts/ops/postgres_long_transaction_lock_packet.sql
```

## Degraded Evidence Rules

- If `pg_stat_statements` is missing, not preloaded, not visible, or not
  selectable by the current role, the rollup prints a status row and next step
  instead of failing the packet.
- If PostgreSQL hides other sessions' query text for privilege reasons, the lock
  packet still reports session, wait, lock, and age fields.
- If no direct `psql` connection or Docker container is available, the runner
  writes skipped reports and keeps the packet shape intact.

## Boundaries

This lane does not approve or perform:

- schema changes, migrations, index creation, `REINDEX`, `VACUUM FULL`, or table
  rewrites
- `VACUUM`, `ANALYZE`, autovacuum reloption changes, or setting changes
- `pg_cancel_backend`, `pg_terminate_backend`, service restarts, or lock-clearing
  action
- restore drills or backup creation
- secret reads, environment dumps, or raw connection-string output

Use the packet as evidence for a DBA review ticket. Any tuning or remediation
needs a separate approval packet with rollback notes.
