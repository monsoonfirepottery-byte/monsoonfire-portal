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

## Safe Commands

These commands are read-only by default:

```bash
make ops-check
make ops-inventory
make ops-postgres-review
make ops-docker-review
make ops-capacity
make ops-backup-evidence
make ops-ubuntu-review
make ops-network-review
make ops-host-drift
make ops-app-review
make ops-incident-bundle
make ops-report
```

The scripts under `scripts/ops/` avoid environment dumps and degrade when Docker, PostgreSQL, or host-only tools are unavailable.

On Windows shells without `make`, run the script directly with Bash, for example:

```bash
bash scripts/ops/app_status_review.sh
bash scripts/ops/incident_bundle.sh output/ops/incidents/manual-smoke
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

The first ops-doctor stack is merged into `main`. Runtime installation and deploy work remain separate:

- Mission Control final deploy is approval-gated.
- idle-worker systemd timer installation is approval-gated.
- package update remediation is approval-gated.
- network/SSH/PostgreSQL hardening is approval-gated.

Use `02-kanban-backlog.md` for the next issue-ready slices.
