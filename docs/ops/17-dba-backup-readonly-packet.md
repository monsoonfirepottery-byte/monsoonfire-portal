# DBA And Backup Read-Only Packet

Snapshot date: 2026-05-06.

This packet adds read-only evidence artifacts for Studio Brain PostgreSQL, Redis,
and MinIO backup confidence. The scripts are intended for issue packets and
operator review. They do not change schemas, create backups, run restores, read
secret files, or print environment values.

## Added Artifacts

| Slice | Artifact | Purpose |
| --- | --- | --- |
| 31 | `scripts/ops/backup_postgres_artifact_verifier.sh` | Verify PostgreSQL backup artifact presence, freshness, and dump/restore tool readiness from metadata only. |
| 32 | `scripts/ops/backup_restore_prerequisite_drill.sh` | Produce a restore-prerequisite packet without running a restore. |
| 33 | `scripts/ops/redis_minio_evidence_verifier.sh` | Verify Redis and MinIO service and backup evidence from container and filesystem metadata. |
| 34 | `scripts/ops/postgres_pg_stat_statements_rollup.sql` | Roll up `pg_stat_statements` by database/user and list top total/mean time fingerprints. |
| 35 | `scripts/ops/postgres_query_hotspot_issue_generator.sql` | Generate issue-ready Markdown snippets for query hotspots. |
| 36 | `scripts/ops/postgres_db_growth_trend_snapshot.sql` | Capture database, schema, and relation size snapshots for weekly trend deltas. |
| 37 | `scripts/ops/postgres_autovacuum_stale_stats_report.sql` | Identify stale analyze/vacuum candidates and dead-tuple review leads. |
| 38 | `scripts/ops/postgres_roles_extensions_security_packet.sql` | Produce redacted role, role-membership, extension, and extension-version review inventory. |
| 39 | Backup packet documentation | Define the evidence boundaries and operator commands for the DBA packet. |
| 40 | Smoke and syntax checks | Validate shell scripts with `bash -n` and, where available, run SQL through read-only `psql`. |

## Operator Commands

Run shell evidence scripts from the repo root:

```bash
bash scripts/ops/backup_postgres_artifact_verifier.sh
bash scripts/ops/backup_restore_prerequisite_drill.sh
bash scripts/ops/redis_minio_evidence_verifier.sh
```

Run SQL snapshots against the Studio Brain database with an existing safe
operator connection:

```bash
psql "$DATABASE_URL" -f scripts/ops/postgres_pg_stat_statements_rollup.sql
psql "$DATABASE_URL" -f scripts/ops/postgres_query_hotspot_issue_generator.sql
psql "$DATABASE_URL" -f scripts/ops/postgres_db_growth_trend_snapshot.sql
psql "$DATABASE_URL" -f scripts/ops/postgres_autovacuum_stale_stats_report.sql
psql "$DATABASE_URL" -f scripts/ops/postgres_roles_extensions_security_packet.sql
```

If running inside the local PostgreSQL container:

```bash
docker exec -i -u postgres studiobrain_postgres psql -d monsoonfire_studio_os -f - < scripts/ops/postgres_db_growth_trend_snapshot.sql
```

## Evidence Boundaries

- Backup artifact verifiers prove metadata presence, freshness, size, and tool
  readiness. They do not prove that a restore succeeds.
- The restore-prerequisite drill proves that a safe restore drill is ready to
  schedule. It does not restore into any target.
- Backup confidence score semantics, artifact age thresholds, and issue-ready
  stale/missing evidence bodies are defined in
  `docs/ops/23-backup-restore-confidence.md`.
- Query hotspot output is workload evidence only. Capture approved
  `EXPLAIN (ANALYZE, BUFFERS)` output with literals scrubbed before proposing
  indexes or query rewrites.
- Role and extension packets are redacted inventory. Do not add passwords,
  connection strings, raw `.env` values, or dump contents to ticket artifacts.

## Confidence And Age Semantics

Use `docs/ops/23-backup-restore-confidence.md` as the shared issue and dashboard
language for backup confidence:

| Recommendation | Evidence placeholder / known evidence | Risk | Safe next step | Rollback / undo notes | Approval gate |
| --- | --- | --- | --- | --- | --- |
| Score backup confidence as a conservative rollup instead of a binary pass/fail. | Known evidence: root-owned config/archive metadata was recorded for 2026-05-06 18:11 UTC; PostgreSQL, Redis, MinIO, and restore-drill proof still need current attached verifier output. | Medium if partial evidence is mistaken for restore proof. | Attach current backup evidence outputs and apply the score bands from the confidence packet. | Revert docs/dashboard wording if scoring is wrong; keep all backup artifacts intact. | Approval required before backup job changes, manual dumps, restores, or retention changes. |
| Treat artifact age as stale before it becomes missing-critical. | Placeholder: attach artifact family, mtime, age, threshold, and verifier command used. | Medium to high depending on the data family. | Open stale-evidence issue when age exceeds the documented threshold. | Revert issue/docs updates if evidence was misread; do not delete or overwrite backups. | Read-only checks do not need approval; runtime backup changes do. |
| Keep restore confidence separate from artifact presence. | Placeholder: attach disposable-target drill summary or explicitly mark drill evidence missing. | High if operators assume `pg_restore --list` or metadata presence proves recovery. | Schedule an owner-approved disposable-target restore drill. | Drop only the disposable target after approval; never restore over production. | Explicit owner approval required before any restore using production-derived data. |

## Suggested Weekly Packet

1. PostgreSQL artifact verifier output.
2. Redis/MinIO evidence verifier output.
3. DB growth trend snapshot output.
4. Autovacuum stale-stats report output.
5. `pg_stat_statements` rollup plus generated hotspot issue snippets.
6. Redacted roles/extensions security packet.

The packet is ready for a DBA review ticket when each output has been reviewed
for local path sensitivity and no secrets are present.
