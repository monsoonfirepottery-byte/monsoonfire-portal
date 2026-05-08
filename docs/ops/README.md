# Studio Brain Ops Doctor

This directory is the durable operations surface for Studio Brain. It separates evidence, risk, backlog, runbooks, and approval-gated actions so the owner can review and act without reverse-engineering the host.

## Start Here

| File | Purpose |
| --- | --- |
| `00-system-inventory.md` | Current known host, Docker, PostgreSQL, app, and dependency inventory. |
| `01-risk-register.md` | Findings sorted by severity with evidence, impact, next step, rollback, and PR suitability. |
| `02-kanban-backlog.md` | Issue-ready backlog grouped by Now, Next, Later, and Waiting / needs approval. |
| `03-capacity-plan.md` | Disk, Docker, database, log, CPU, memory, backup, and watch-item planning. |
| `04-postgres-dba-review.md` | PostgreSQL DBA notes, read-only queries, and improvement candidates. |
| `05-docker-ops-review.md` | Compose, container, healthcheck, volume, network, image, and cleanup review. |
| `06-runbooks.md` | Operator runbooks for restart, backup, restore, disk pressure, incidents, OOM, migrations, and rollback. |
| `07-maintenance-calendar.md` | Daily, weekly, monthly, and quarterly checks. |
| `13-ops-pr-stack-audit.md` | Historical PR stack audit for the merged ops-doctor stack. |
| `14-post-merge-verification.md` | Post-merge evidence, safe smoke checks, and remaining approval gates. |
| `15-portal-bridge-review.md` | Portal bridge proxy/tunnel service evidence and watch items. |
| `17-swarm-slice-01-baseline-handoff.md` | Wave 1 baseline from merged PR #596 and Mission Control `9583f7f`. |
| `18-swarm-slice-02-operating-contract.md` | Swarm roles, write ownership, branch naming, safety gates, and verification packet rules. |
| `19-swarm-slice-03-clean-worktree-lanes.md` | Clean worktree lane setup plan for multi-worker ops slices. |
| `20-swarm-slice-48-approval-backlog.md` | Issue-ready backlog entries for remaining approval gates. |
| `21-swarm-slice-49-roadmap-30-60-90.md` | Refreshed 30/60/90 Studio Brain ops roadmap. |
| `22-privileged-evidence-capture.md` | Approval-gated workaround for sudo-unavailable agents: a narrow root capture job plus read-only agent reader. |
| `26-dependency-security-cadence.md` | Daily/weekly dependency guard cadence, stale-alert handling, and safe lockfile refresh workflow. |

## Safe Commands

These commands are read-only by default:

```bash
make ops-check
make ops-inventory
make ops-postgres-review
make ops-docker-review
make ops-docker-tag-policy
make ops-capacity
make ops-import-pressure
make ops-cleanup-candidates
make ops-backup-evidence
make ops-postgres-backup-artifacts
make ops-restore-prereq
make ops-redis-minio-backup-evidence
make ops-db-docker-backup-rollup
make ops-command-surface-guard
make ops-output-retention
make ops-ubuntu-review
make ops-host-failed-unit-trends
make ops-package-posture
make ops-time-sync
make ops-network-review
make ops-host-drift
make ops-systemd-drift
make ops-portal-bridge-review
make ops-app-review
make ops-dependency-review
make ops-dependency-security-scout
make ops-dependency-remediation-packet
make ops-dependency-upstream-watch
make ops-dependency-zero-baseline
make ops-idle-worker-effectivity
make ops-effectivity-report
make ops-evidence-freshness
make ops-proactive-radar
make ops-pr-stack-readiness
make ops-privileged-evidence-read
make ops-privileged-evidence-capture-smoke
make ops-work-packet
make ops-incident-bundle
make ops-incident-bundle-v2
make ops-ci-validate
make ops-post-deploy-verify
make ops-report
```

Windows-friendly npm equivalent:

```bash
npm run ops:proactive:radar
npm run ops:pr-stack:readiness
npm run ops:evidence:freshness
npm run ops:db-docker-backup:rollup
npm run ops:command-surface:guard
npm run ops:output:retention
npm run ops:dependency:security-scout
npm run ops:dependency:remediation-packet
npm run ops:dependency:upstream-watch
npm run ops:dependency:zero-baseline
npm run ops:docker:tag-policy
```

The scripts under `scripts/ops/` avoid environment dumps and degrade when Docker, PostgreSQL, or host-only tools are unavailable.

On Windows shells without `make`, run the script directly with Bash, for example:

```bash
bash scripts/ops/app_status_review.sh
bash scripts/ops/incident_bundle.sh output/ops/incidents/manual-smoke
bash scripts/ops/systemd_drift_review.sh --ssh-host studiobrain
bash scripts/ops/portal_bridge_review.sh --ssh-host studiobrain
bash scripts/ops/import_pressure.sh --target /home/wuff/imports
bash scripts/ops/cleanup_candidates.sh --import-target /home/wuff/imports
bash scripts/ops/npm_audit_inventory.sh
bash scripts/ops/effectivity_report.sh
node scripts/ops/proactive_issue_radar.mjs --write
node scripts/ops/command_surface_guard.mjs --write
node scripts/ops/output_retention_scanner.mjs --write
node scripts/ops/dependency_security_scout.mjs --write
node scripts/ops/dependency_remediation_packet.mjs --write
node scripts/ops/dependency_upstream_watch.mjs --write
node scripts/ops/dependency_zero_baseline_guard.mjs --write
node scripts/ops/docker_floating_tag_policy.mjs --write
bash scripts/ops/privileged_evidence_read.sh
bash scripts/ops/privileged_evidence_capture.sh --smoke --output-dir output/ops/privileged-evidence
node scripts/studiobrain-ops-work-packet.mjs --write
bash scripts/ops/incident_bundle_v2.sh output/ops/incidents-v2/manual-smoke
```

`ops-privileged-evidence-capture-smoke` writes a non-root local smoke artifact under `output/ops/privileged-evidence` and is safe for development. Installing the host-side privileged collector, timer, group, or sudoers allowlist is intentionally separate and approval-gated; see `22-privileged-evidence-capture.md`.

`ops-proactive-radar` is a read-only loop-start command. It looks for merge-blocked PRs, stacked draft PR pressure, stale ops artifacts, dirty worktree risk, and hidden ops scripts without printing secrets or mutating the host.

`ops-pr-stack-readiness` is a read-only GitHub PR-stack packet. It groups open PRs by stack, identifies dirty non-draft PRs, stale PRs, and non-main draft chains, and writes artifacts under `output/ops/pr-stack`.

`ops-evidence-freshness` checks whether the main ops evidence artifacts are recent enough to trust and writes issue-ready refresh tasks under `output/ops/evidence-freshness`.

`ops-db-docker-backup-rollup` runs the existing read-only Docker, PostgreSQL, backup, Redis/MinIO, and restore-prerequisite packets, stores their text evidence under `output/ops/db-docker-backup`, and summarizes degraded lanes with issue-ready follow-up tasks.

`ops-command-surface-guard` checks that documented `make`, `npm run`, and direct `scripts/ops` commands still resolve. It writes artifacts under `output/ops/command-surface-guard` and is meant to catch command-wrapper drift before PRs stack up.

`ops-output-retention` scans ignored `output/ops` artifacts for file count, total size, largest producers, stale files, and retention recommendations. It writes under `output/ops/output-retention` and never deletes, rotates, compresses, or prunes artifacts.

`ops-dependency-security-scout` compares open Dependabot alerts, open Dependabot PR readiness, and local `npm audit` summaries across the repo's package surfaces. It writes issue-ready follow-up tasks under `output/ops/dependency-security-scout` and does not install, update, or fix packages.

`ops-dependency-remediation-packet` turns high/critical npm audit findings into a read-only decision packet with dependency chains, owner-package candidates, latest-version hints, safe next steps, acceptance criteria, and rollback notes. It writes under `output/ops/dependency-remediation` and does not install, update, override, or remove dependencies.

`ops-dependency-upstream-watch` checks high/critical npm audit chains against read-only npm registry version metadata and classifies whether the chain has a normal update candidate, still needs upstream movement, or would require a higher-risk override experiment. It writes under `output/ops/dependency-upstream-watch` and does not install, update, override, or remove dependencies.

`ops-dependency-zero-baseline` compares the current dependency scout and upstream-watch output against `docs/ops/dependency-zero-baseline.json`, the all-clean baseline recorded after the `basic-ftp` lockfile refresh. It writes under `output/ops/dependency-zero-baseline`; use `node scripts/ops/dependency_zero_baseline_guard.mjs --strict` when a non-zero exit should fail a guard job. It does not run `npm audit fix`, install, update, override, or remove dependencies.

`ops-docker-tag-policy` scans tracked Compose files and Dockerfiles for `latest`, `stable`, branch-like, broad major-only, and digest-pinned image references. It writes issue-ready follow-ups under `output/ops/docker-tag-policy` and does not pull, recreate, restart, or edit Docker resources.

## Approval Boundaries

Do not treat a report as permission to mutate the host. These actions still require explicit approval:

- service restarts
- deploys
- package upgrades
- firewall, SSH, sudoers, or user changes
- Docker prune, volume deletion, or container removal
- database schema changes, drops, restores over production, or manual vacuum/reindex
- secret rotation
- deleting logs, backups, imports, temp files, or generated artifacts

## Current Merged State

The first ops-doctor stack is merged into `main`, including post-merge verification, machine-readable report summaries, systemd drift review, and portal bridge review coverage. Runtime installation and future host mutation work remain separate:

- Mission Control CPU/backpressure and deploy-ref guard work is merged and deployed; future deploys should use the guarded deploy helper.
- idle-worker systemd timer installation is approval-gated.
- package update remediation is approval-gated.
- Node/npm audit inventory is available with `make ops-dependency-review`; findings are evidence for small dependency PRs, not approval to run `npm audit fix`.
- network/SSH/PostgreSQL hardening is approval-gated.

Use `02-kanban-backlog.md` for the next issue-ready slices, and `13-ops-pr-stack-audit.md` for current open PR triage.
