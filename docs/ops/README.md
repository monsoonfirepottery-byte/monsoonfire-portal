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

## Safe Commands

These commands are read-only by default:

```bash
make ops-check
make ops-inventory
make ops-postgres-review
make ops-docker-review
make ops-capacity
make ops-import-pressure
make ops-cleanup-candidates
make ops-backup-evidence
make ops-ubuntu-review
make ops-network-review
make ops-host-drift
make ops-systemd-drift
make ops-portal-bridge-review
make ops-app-review
make ops-dependency-review
make ops-incident-bundle
make ops-report
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
```

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
