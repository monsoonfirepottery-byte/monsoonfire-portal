# Studio Brain PostgreSQL DBA Review

Snapshot time: 2026-05-06 18:32 UTC. Queries were read-only against `studiobrain_postgres`.

## Version And Config Facts

- PostgreSQL version: 16.13, Debian build, from `pgvector/pgvector:pg16`.
- Database: `monsoonfire_studio_os`.
- Extensions: `pg_stat_statements`, `pg_trgm`, `pgcrypto`, `plpgsql`, `vector`.
- Key settings:
  - `max_connections=100`
  - `shared_buffers=131072 8kB` (about 1GB)
  - `effective_cache_size=1048576 8kB` (about 8GB)
  - `work_mem=8192 kB`
  - `maintenance_work_mem=262144 kB`
  - `max_wal_size=2048 MB`
  - `checkpoint_timeout=300 s`
  - `autovacuum=on`
  - `track_io_timing=on`
  - `shared_preload_libraries=pg_stat_statements`

## Database Size Summary

| Database | Size |
| --- | ---: |
| `monsoonfire_studio_os` | 8348 MB |
| `postgres` | 7519 kB |
| `template1` | 7425 kB |
| `template0` | 7361 kB |

## Largest Tables And Indexes

Largest table families:

| Relation | Total | Table | Indexes | Live tuples | Dead tuples |
| --- | ---: | ---: | ---: | ---: | ---: |
| `public.swarm_memory` | 3167 MB | 1235 MB | 948 MB | 178,790 | 7,551 |
| `public.memory_relation_edge` | 2292 MB | 771 MB | 1520 MB | 2,577,843 | 10,881 |
| `public.memory_pattern_index` | 1318 MB | 315 MB | 1003 MB | 1,998,083 | 37,503 |
| `public.memory_entity_index` | 1040 MB | 273 MB | 766 MB | 1,773,624 | 9,224 |
| `public.memory_ingest_event` | 288 MB | 227 MB | 61 MB | 500,379 | 0 |

Largest indexes:

- `public.idx_swarm_memory_contextualized_tsv`: 591 MB.
- `public.memory_relation_edge_pkey`: 559 MB.
- `public.idx_memory_relation_edge_target_relation`: 535 MB.
- `public.idx_memory_relation_edge_target`: 421 MB.
- `public.memory_pattern_index_pkey`: 310 MB.
- `public.idx_memory_pattern_lookup`: 310 MB.

## Bloat And Dead Tuple Concerns

- Large tables have relatively low dead tuple ratios in this snapshot.
- `public.swarm_memory` has about 4.05% dead tuples.
- `public.memory_pattern_index` has about 1.84% dead tuples.
- Smaller operational tables such as `mission_control.agents`, `public.brain_ops_cases`, and `public.memory_stats_rollup` show high dead percentages, but their absolute sizes are small.
- No index bloat estimator was run in this first pass. Use the read-only scripts in `scripts/ops/` before considering `REINDEX`, `VACUUM FULL`, or schema changes.

## Slow Query Visibility

- `pg_stat_statements` is installed and preloaded, so slow-query review is possible.
- The read-only review now includes a top-total-time query with single-line, length-limited query text. It showed several memory retrieval/statistics families dominating total execution time.
- Highest-cost families in the 18:32 UTC snapshot included memory pattern/entity lookups, `refresh_memory_stats_rollup`, row-count snapshots for memory tables, and repeated `mission_control.task_events order by occurred_at desc limit $1`.
- Treat these as workload leads, not index-change approval. Before schema changes, capture approved `EXPLAIN (ANALYZE, BUFFERS)` output with literal scrubbing and rollback SQL.

## Connection Count And Pooling Status

- Activity state snapshot:
  - 10 total sessions.
  - 10% of `max_connections=100`.
  - 0 idle-in-transaction sessions.
  - 0 ungranted locks.
- No evidence of connection saturation was observed.
- No external connection pooler was discovered in Docker inventory.

## Long-Running Transaction And Lock Risks

- Active activity contained only the review query.
- Lock snapshot showed only granted locks: one `virtualxid` exclusive lock and one relation access-share lock.
- No waiting locks were observed.
- No idle-in-transaction session was observed in the captured output.

## Vacuum And Analyze Posture

- Autovacuum is enabled.
- Large memory tables show recent autoanalyze and some recent autovacuum activity.
- Some manual `last_vacuum`/`last_analyze` timestamps are older or null, which is normal if autovacuum is handling the table.
- Recommendation: collect weekly relation stats before changing autovacuum thresholds.

## WAL And Checkpoint Observations

- `pg_stat_wal` reported about 150.3GB cumulative `wal_bytes`.
- `pg_stat_bgwriter` showed 17,617 timed checkpoints and 171 requested checkpoints.
- This is a point-in-time cumulative counter, not a rate. Trend it before tuning WAL/checkpoints.

## Backup And Restore Posture

- Systemd backup archives are current but appear config-focused.
- Root-owned backup metadata now exists at `/var/backups/studio-brain/latest-metadata.json`; the 2026-05-06 18:11 UTC manifest proves archive metadata without exposing secrets.
- A database restore drill should be treated as unproven until a current artifact explicitly shows PostgreSQL dump/restore verification.

## Recommended SQL Inspection Queries

The repo now includes:

- `scripts/ops/postgres_readonly_review.sql`
- `scripts/ops/postgres_size_report.sql`

Recommended cadence:

- Weekly: size report, dead tuples, active sessions, locks, and settings snapshot.
- Monthly: pg_stat_statements redacted top-query review and restore drill.
- Before schema/index PRs: capture `EXPLAIN (ANALYZE, BUFFERS)` only on approved queries and scrub literals from shared artifacts.

## Safe Improvement Candidates

- Add weekly read-only DBA snapshots.
- Keep the redacted pg_stat_statements report in the weekly DBA packet.
- Add backup manifest fields that prove PostgreSQL dump and restore-prerequisite status.
- Add a DB network-bind check to Compose validation.
- Avoid schema/index changes until workload evidence exists.
