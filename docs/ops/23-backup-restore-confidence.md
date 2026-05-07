# Backup And Restore Confidence Packet

Snapshot date: 2026-05-07.

This packet defines the operator-facing semantics for backup confidence, backup
artifact age thresholds, disposable-target restore drills, and issue-ready
follow-up bodies for stale or missing backup evidence. It is documentation and
backlog support only. It does not approve backup path changes, production
restores, Docker restarts, PostgreSQL writes, file deletion, or secret access.

Known evidence at this snapshot:

- PR #596 added root-owned backup metadata evidence and a Mission Control
  Backup Confidence panel.
- `docs/ops/01-risk-register.md` records that
  `/var/backups/studio-brain/latest-metadata.json` proved a 2026-05-06
  18:11 UTC config/archive manifest without exposing secrets.
- `docs/ops/04-postgres-dba-review.md` records PostgreSQL restore confidence
  as unproven until a current artifact explicitly shows dump and restore
  verification.
- Prior ops handoff evidence recorded `sudo_unavailable` as the blocker for
  deeper privileged host evidence.

Current read-only host evidence from 2026-05-07 20:19 UTC:

- `scripts/ops/backup_evidence.sh` was run on `studiobrain` from
  `/home/wuff/monsoonfire-portal`.
- Root-owned metadata exists at `/var/backups/studio-brain/latest-metadata.json`
  with `metadata_generated_at: 2026-05-07T03:45:01.738705+00:00`.
- The app backup manifest exists and reports Postgres, Redis, and MinIO checks
  as passing, but its freshness status is stale at about 1567 minutes old
  against a 1440 minute threshold.
- `studiobrain_postgres`, `studiobrain_redis`, and `studiobrain_minio` were
  running and Docker-reported healthy. PostgreSQL `pg_dump` and `pg_restore`
  were available at version 16.13, and MinIO live health passed.
- Dedicated backup artifact directories were missing for PostgreSQL dumps,
  Redis artifacts, and MinIO artifacts under `/var/backups/studio-brain/`.
- The newest restore drill summary found was
  `/home/wuff/monsoonfire-portal/output/backups/2026-02-23T07-39-51-116Z/restore-drill-summary.json`,
  which is stale by the 30 day threshold.
- Local Windows lane evidence remains tool-limited: `make` and Docker are not
  installed locally, so host evidence should be captured over SSH or from a
  Docker-capable host lane.

Conservative current rollup: yellow/orange. Runtime dependencies are healthy
and root-owned config metadata is current, but restore confidence remains
degraded until PostgreSQL/Redis/MinIO artifact coverage and a current
disposable-target restore drill are proven.

## Slice 16: Backup Confidence Score Semantics

The score is a communication aid, not proof that a restore will succeed. Treat
it as a conservative rollup of evidence age, artifact coverage, and restore
drill recency.

| Score band | Operator meaning | Known evidence or placeholder | Risk | Safe next step | Rollback / undo notes | Approval gate |
| --- | --- | --- | --- | --- | --- | --- |
| 90-100, green | All required backup artifact families have fresh metadata, and a disposable-target restore drill is current. | Placeholder: attach latest `make ops-backup-evidence`, PostgreSQL artifact verifier, Redis/MinIO evidence verifier, and restore drill summary. | Low residual risk; artifact corruption or hidden dependency drift can still exist. | Keep weekly evidence capture and monthly restore drill cadence. | Revert only documentation or dashboard threshold edits; do not delete backup artifacts. | No approval for read-only evidence capture; approval required for restore execution or backup tooling changes. |
| 70-89, yellow | Core metadata is present but one evidence family is stale, partial, or restore-drill evidence is older than threshold. | Known evidence: config/archive metadata was proven on 2026-05-06 18:11 UTC; PostgreSQL/Redis/MinIO restore confidence remains incomplete unless fresh verifier output is attached. | Medium risk of overestimating recoverability or missing RPO/RTO drift. | Open a stale-evidence ticket and refresh read-only evidence before changing runtime backup paths. | Revert docs/backlog changes if wording is wrong; keep all existing artifacts intact. | Human approval required before running restore drill, copying production data, or changing retention. |
| 40-69, orange | Some backup evidence exists, but one required data family is missing or older than the critical age threshold. | Placeholder: attach missing-family line from backup evidence output, artifact path, and expected owner. | High risk that operators cannot prove current recoverability for the affected data family. | Open a missing-evidence ticket and classify whether the data family is authoritative, regenerable, or out of backup scope. | Roll back any proposed config change by restoring prior repo commit or service config; do not remove existing backups. | Approval required before enabling new backup jobs, creating new privileged reads, moving artifacts, or changing storage. |
| 0-39, red | No usable current metadata, no current data-artifact evidence, or no safe path to validate a restore. | Placeholder: attach failed or missing `make ops-backup-evidence` output and exact unreadable/missing path. | Critical data-loss risk if production fails before evidence is restored. | Stop cleanup proposals that depend on backup confidence; capture root-owned metadata through the approved privileged evidence lane. | Undo docs-only changes by reverting the PR; undo runtime changes only with owner-approved rollback plan. | Explicit owner approval required for any production-impacting backup, restore, service, or storage action. |

Recommended initial rollup weights:

| Component | Weight | Passing condition | Known evidence or placeholder | Risk | Safe next step | Rollback / undo notes | Approval gate |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| Root-owned config/archive metadata | 20 | Latest metadata file is readable, non-empty, and fresh by the thresholds below. | Known evidence: 2026-05-06 18:11 UTC manifest was recorded in ops docs. | Low if fresh; medium if stale because config recovery may lag host changes. | Refresh `make ops-backup-evidence`. | Revert documentation changes only; do not edit root backup metadata by hand. | No approval for read-only capture; approval required to modify the backup job. |
| PostgreSQL dump artifact metadata | 30 | Current dump artifact metadata exists with size, mtime, checksum or manifest reference, and `pg_restore --list` readiness. | Placeholder: attach `backup_postgres_artifact_verifier.sh` output. | High if missing because PostgreSQL is authoritative application state. | Run verifier and prepare DBA review ticket. | Do not delete or overwrite dumps; revert any proposed script/docs PR if wrong. | Approval required for manual dumps, restore execution, or retention changes. |
| Redis backup scope | 10 | Redis is classified as authoritative, cache-only, or backed up with fresh metadata. | Placeholder: attach Redis section from `redis_minio_evidence_verifier.sh`. | Medium until scope is explicit; high if Redis holds non-regenerable state. | Classify Redis authority and attach evidence. | Revert classification doc if evidence contradicts it; do not flush or restart Redis. | Approval required for backup enablement, restart, flush, or storage changes. |
| MinIO backup scope | 15 | MinIO object data is classified and fresh backup metadata exists if authoritative. | Placeholder: attach MinIO section from `redis_minio_evidence_verifier.sh`. | High if authoritative object data lacks current backup evidence. | Classify buckets/data authority and attach artifact metadata. | Revert docs only; do not remove buckets, volumes, or objects. | Approval required for object copy, retention, bucket changes, or service restart. |
| Disposable restore drill | 25 | A restore drill summary exists for a disposable target and is fresh by threshold. | Placeholder: attach restore drill summary path, duration, target, and smoke-query result. | High if absent because artifact presence does not prove restore correctness. | Schedule owner-approved disposable-target drill. | Drop only the disposable target after approval; never overwrite production. | Explicit owner approval required before restoring production-derived data anywhere. |

## Slice 17: Backup Artifact Age Thresholds

Use these thresholds for dashboard language, issue priority, and maintenance
calendar review. If a service has a stricter RPO later, use the stricter value.

| Artifact family | Fresh | Stale | Critical / missing | Evidence placeholder or known evidence | Risk | Safe next step | Rollback / undo notes | Approval gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Root-owned config/archive metadata | <= 36 hours | > 36 hours and <= 72 hours | > 72 hours or unreadable/missing | Known evidence: 2026-05-06 18:11 UTC manifest recorded in ops docs. | Medium if stale; config drift may not be recoverable. | Rerun backup evidence and inspect backup timer state. | Revert docs if threshold needs tuning; do not delete archives. | Approval required to run or modify backup timer/job. |
| PostgreSQL dump metadata | <= 30 hours | > 30 hours and <= 48 hours | > 48 hours or missing/unreadable | Placeholder: PostgreSQL artifact verifier output with dump mtime, size, checksum/manifest reference. | High if stale because application data RPO is unknown. | Capture artifact verifier output and open stale/missing ticket. | Keep existing dumps; revert only proposed retention/tooling changes. | Approval required for manual dump, restore, retention, or backup path change. |
| Redis backup evidence | <= 30 hours if authoritative; not applicable if explicitly cache-only | > 30 hours and <= 48 hours | > 48 hours, missing, or authority unknown | Placeholder: Redis authority decision plus backup metadata or cache-only rationale. | Medium to high depending on Redis authority. | Classify Redis as authoritative, cache-only, or backup-required. | Revert classification if contradicted; do not flush or restart Redis. | Approval required for Redis backup enablement or service action. |
| MinIO backup evidence | <= 30 hours if authoritative; not applicable if explicitly regenerable | > 30 hours and <= 48 hours | > 48 hours, missing, or authority unknown | Placeholder: MinIO bucket/object authority decision plus metadata. | High if objects are authoritative. | Capture MinIO evidence and classify buckets/data. | Do not move/delete buckets or volumes; revert docs if wrong. | Approval required for object copy, lifecycle, retention, or service action. |
| Restore drill summary | <= 30 days | > 30 days and <= 45 days | > 45 days or missing | Placeholder: disposable-target drill summary with target name, timestamp, duration, and smoke results. | High if stale because backup artifacts may be unrestorable. | Prepare owner-approved disposable restore drill. | Drop only disposable target after approval; retain drill summary. | Explicit owner approval before any restore using production-derived data. |

## Slice 18: Disposable-Target Restore Drill Checklist

This checklist intentionally has no production overwrite path. If any command
targets the production database, production Docker volume, production MinIO
bucket, or live service data path, stop and rewrite the drill plan.

| Step | Checklist item | Evidence placeholder or known evidence | Risk | Safe next step | Rollback / undo notes | Approval gate |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Capture current backup confidence evidence. | Attach `make ops-backup-evidence` output and artifact verifier summaries. | Low for read-only capture; high if skipped because the drill may use stale input. | Review output for secrets before attaching to ticket. | Delete only local generated reports if they expose local paths. | No approval for read-only capture. |
| 2 | Name a disposable target that cannot alias production. | Placeholder: target container/database name such as `studio_brain_restore_drill_<date>`. | High if the target can resolve to production. | Require a written target name and connection string redaction check. | Destroy only the disposable target after approval. | Human approval required before creating target with production-derived data. |
| 3 | Verify production is not the restore target. | Placeholder: checklist assertion showing production DB/container/volume names and disposable target names differ. | Critical if not verified. | Compare host, port, database, container, and volume names before restore. | Stop before restore; no rollback needed if not executed. | Human approval required to proceed to restore step. |
| 4 | Validate dump readability without restoring. | Placeholder: `pg_restore --list <dump>` summary, not full dump contents. | Medium if skipped; corrupt dump may be discovered too late. | Run list/readiness check and capture exit status. | No production state changed; delete local generated list if sensitive. | No approval if read-only and dump access is already approved. |
| 5 | Restore into disposable target only. | Placeholder: command transcript with target redacted, timestamp, duration, and exit status. | High because production-derived data is materialized in a new place. | Run only during approved drill window with restricted access. | Drop disposable database/container/volume after approval and record deletion. | Explicit owner approval required. |
| 6 | Run smoke queries against disposable target. | Placeholder: database size, relation count, migration table status, and selected row-count checks. | Medium; smoke checks can miss logical corruption. | Capture aggregate-only results without row contents or secrets. | Delete generated smoke report if sensitive. | No additional approval if covered by restore-drill approval. |
| 7 | Record drill result and confidence score. | Placeholder: drill summary path, score band, failures, follow-up tickets. | Medium if not recorded; dashboard remains stale. | Attach summary to backlog ticket and Mission Control evidence link. | Revert docs/dashboard references if summary is wrong. | Approval required only for publishing sensitive artifact paths. |
| 8 | Clean up disposable target. | Placeholder: approved cleanup command and post-cleanup proof target is gone. | High if cleanup accidentally targets production. | Confirm target name twice and keep production names out of cleanup command. | If cleanup fails, isolate target and open owner ticket; do not broaden deletion. | Explicit owner approval required for destructive cleanup, even on disposable target. |

Hard stop rule matrix:

| Rule | Evidence placeholder or known evidence | Risk | Safe next step | Rollback / undo notes | Approval gate |
| --- | --- | --- | --- | --- | --- |
| Do not run `pg_restore` against `monsoonfire_studio_os` or the live `studiobrain_postgres` data volume. | Placeholder: drill target assertion proving production and disposable names differ. | Critical production overwrite risk. | Stop and rewrite the drill plan with a disposable target. | If no command ran, no rollback is needed; if any restore began, escalate as an incident and stop further writes. | Explicit owner approval is required for any restore using production-derived data. |
| Do not use `docker compose down -v`, `docker volume rm`, bucket deletion, or broad filesystem deletion as part of a restore drill. | Placeholder: cleanup command preview limited to the disposable target. | Critical data deletion risk. | Replace broad deletion with named disposable-target cleanup. | Restore only from approved backups if production data was affected; otherwise delete only the disposable target after approval. | Explicit owner approval required before destructive cleanup, even for disposable targets. |
| Do not paste dump contents, secrets, connection strings, or raw `.env` values into the drill summary. | Placeholder: redaction review checkbox before attaching drill evidence. | High secret exposure and privacy risk. | Attach aggregate metadata, exit status, duration, and smoke-query counts only. | Remove or replace the sensitive artifact, rotate secrets only if exposure is confirmed and approved. | Owner/security approval required before publishing sensitive artifact paths or rotating secrets. |
| Do not treat `pg_restore --list` as a successful restore drill. | Placeholder: separate fields for list-check result and actual disposable-restore result. | High false-confidence risk. | Open or keep restore-drill evidence ticket until disposable restore succeeds. | Revert any dashboard/doc claim that marked list-only evidence as restored. | Restore execution requires explicit owner approval. |

## Slices 19-20: Issue-Ready Backup Evidence Bodies

Use these bodies when GitHub issue creation is unavailable or when an operator
needs copy-ready review text. Attach only redacted evidence.

### Slice 19 Issue: Stale Backup Evidence

Title:
`[backup] Refresh stale Studio Brain backup evidence`

Body:

```markdown
## Problem
One or more Studio Brain backup evidence families are older than the documented freshness threshold. The dashboard/backlog may overstate restore confidence until evidence is refreshed.

## Evidence
- Known evidence or placeholder:
  - Attach latest `make ops-backup-evidence` output.
  - Attach PostgreSQL artifact verifier output if PostgreSQL dump evidence is stale.
  - Attach Redis/MinIO evidence verifier output if Redis or MinIO scope/evidence is stale.
  - Current known baseline: config/archive metadata was recorded as fresh on 2026-05-06 18:11 UTC in ops docs; PostgreSQL/Redis/MinIO restore confidence still needs current attached proof.

## Risk
Medium to high. Stale evidence can hide a broken backup job, missed PostgreSQL dump, stale object-store backup, or restore drill drift.

## Proposed Fix
Refresh read-only backup evidence, classify each stale family, and update the backup confidence packet or Mission Control evidence link with the new timestamp and score band.

## Safe Next Step
Run `make ops-backup-evidence` and the relevant read-only backup artifact verifier. Review output for secrets or sensitive local paths before attaching it.

## Acceptance Criteria
- The stale artifact family has a fresh timestamp within `docs/ops/23-backup-restore-confidence.md` thresholds.
- Evidence distinguishes config archives, PostgreSQL dump metadata, Redis scope/evidence, MinIO scope/evidence, and restore-drill summary.
- Any still-stale family has a follow-up ticket with owner and approval gate.

## Safety Notes
- Rollback / undo: revert documentation or dashboard link changes if the refreshed evidence is wrong; do not delete existing backups.
- Approval gate: read-only evidence capture does not need approval, but manual dumps, restore execution, backup job changes, retention changes, service restarts, and production data copies require explicit owner approval.
- Production impact: none for read-only evidence capture.

Labels:
ops, reliability, backup, database, docs
```

### Slice 20 Issue: Missing Backup Evidence

Title:
`[backup] Close missing Studio Brain backup evidence gap`

Body:

```markdown
## Problem
One or more Studio Brain backup evidence families are missing, unreadable, or not yet classified as authoritative/regenerable. Restore confidence must stay degraded until the missing family is proven or explicitly marked out of scope.

## Evidence
- Known evidence or placeholder:
  - Attach the `missing`, `unreadable`, `missing_or_permission_denied`, or `authority_unknown` line from the latest backup evidence packet.
  - Attach expected artifact path, service/data family, and whether `sudo_unavailable` or another approval gate blocked verification.
  - Current known baseline: root-owned config/archive metadata exists in ops docs, but PostgreSQL dump restore proof, Redis scope, MinIO scope, and current restore-drill evidence remain incomplete unless fresh verifier output is attached.

## Risk
High. Missing evidence can mean the data family is not backed up, is inaccessible during an incident, or cannot be restored within the expected RPO/RTO.

## Proposed Fix
Classify the missing family, define the authoritative evidence source, and add the least-invasive read-only proof path. If the family is authoritative data, prepare an owner-approved backup or restore-drill plan before any runtime changes.

## Safe Next Step
Use the existing read-only verifier for the affected family. If verification is blocked by permissions, use the privileged evidence capture approval path rather than granting broad agent sudo.

## Acceptance Criteria
- Missing family is classified as backed up, intentionally regenerable/cache-only, or still blocked with an owner-approved next action.
- Evidence artifact includes timestamp, path or redacted source, age, and reviewer.
- Backup confidence score is updated conservatively.
- Any runtime change is deferred to a separate approved PR or maintenance ticket.

## Safety Notes
- Rollback / undo: revert docs/backlog updates if classification is wrong; do not remove backups, buckets, volumes, dumps, or config archives.
- Approval gate: enabling backup jobs, changing paths, copying production data, running restores, changing retention, or using privileged host capture requires explicit owner approval.
- Production impact: none for documentation and read-only verification; possible impact for any future backup/restore implementation, which must be separately approved.

Labels:
ops, reliability, backup, database, storage, docs
```
