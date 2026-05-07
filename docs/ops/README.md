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
make ops-postgres-backup-artifacts
make ops-restore-prereq
make ops-redis-minio-backup-evidence
make ops-ubuntu-review
make ops-host-failed-unit-trends
make ops-package-posture
make ops-time-sync
make ops-network-review
make ops-host-drift
make ops-host-drift-manifest
make ops-systemd-drift
make ops-portal-bridge-review
make ops-app-review
make ops-dependency-review
make ops-idle-worker-effectivity
make ops-effectivity-report
make ops-privileged-evidence-read
make ops-privileged-evidence-capture-smoke
make ops-work-packet
make ops-wave-runner
make ops-pr-stack-audit
make ops-incident-bundle
make ops-incident-bundle-v2
make ops-ci-validate
make ops-post-deploy-verify
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
bash scripts/ops/effectivity_report.sh
bash scripts/ops/privileged_evidence_read.sh
bash scripts/ops/privileged_evidence_capture.sh --smoke --output-dir output/ops/privileged-evidence
node scripts/ops/host_drift_manifest.mjs --json --write
node scripts/studiobrain-ops-work-packet.mjs --write
node scripts/ops/ops_wave_runner.mjs --write
node scripts/ops/pr_stack_audit.mjs --write
INCIDENT_BUNDLE_V2_SMOKE=1 INCIDENT_INCLUDE_LOGS=0 bash scripts/ops/incident_bundle_v2.sh output/ops/incidents-v2/manual-smoke
```

`make ops-wave-runner` accepts operator pass-through variables for interrupted or widened waves:

```bash
make ops-wave-runner OPS_WAVE_FROM_STEP=packet-outcome-report
make ops-wave-runner OPS_WAVE_MAX_PACKETS=8 OPS_WAVE_FLAGS=--json
make ops-wave-runner OPS_WAVE_STEPS=swarm-preflight,work-packet,artifact-validation OPS_WAVE_SKIP=tooling-quality
```

`ops-privileged-evidence-capture-smoke` writes a non-root local smoke artifact under `output/ops/privileged-evidence` and is safe for development. Installing the host-side privileged collector, timer, group, or sudoers allowlist is intentionally separate and approval-gated; see `22-privileged-evidence-capture.md`.

`ops-host-drift-manifest` is path-name-only and read-only. It converts a live or captured `git status --porcelain=v1 --untracked-files=all` listing into JSON/Markdown under `output/ops/host-drift`, compares paths with `studio-brain/host-drift-allowlist.json`, redacts sensitive-looking path names by default, and keeps cleanup/reset/stash/delete decisions approval-gated.

`ops-incident-bundle-v2` can run in `INCIDENT_BUNDLE_V2_SMOKE=1` mode for PR and CI evidence. It writes a stable latest summary at `output/ops/incidents-v2/incident-bundle-v2-latest.json` so artifact validation and PR readiness can show whether redacted incident evidence exists before any service-impacting response.

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

Use `02-kanban-backlog.md` for the next issue-ready slices, and `make ops-pr-stack-audit` plus `13-ops-pr-stack-audit.md` for current open PR triage.
