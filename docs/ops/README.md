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
| `24-proactive-admin-loop-wave1.md` | First proactive admin loop plan: radar, selectors, effectivity, and loop closeout. |
| `25-proactive-admin-loop-wave2.md` | Second proactive admin loop plan: dependency, producer, PR stack, and evidence refresh lanes. |
| `26-dependency-security-cadence.md` | Daily/weekly dependency guard cadence, stale-alert handling, and safe lockfile refresh workflow. |
| `27-proactive-admin-loop-wave3.md` | Third proactive admin loop plan: selector fixtures, command policy, producer schemas, host/DB/Docker semantics, and Mission Control import contracts. |
| `28-proactive-admin-loop-wave4.md` | Fourth proactive admin loop plan: dependency remediation, PR-stack approval packets, producer fallback evidence, retention, DBA/backup, Docker, CI, and Mission Control import contracts. |

## Safe Commands

These commands are read-only by default:

```bash
make ops-check
make ops-inventory
make ops-postgres-review
make ops-docker-review
make ops-docker-posture
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
make ops-command-manifest
make ops-output-retention
make ops-producer-refresh
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
make ops-dependency-inventory
make ops-dependency-cadence
make ops-dependency-security-scout
make ops-dependency-remediation-packet
make ops-dependency-upstream-watch
make ops-dependency-zero-baseline
make ops-postgres-snapshot
make ops-postgres-top-queries
make ops-postgres-query-tasks
make ops-postgres-growth-snapshot
make ops-postgres-autovacuum-stats
make ops-postgres-roles-extensions
make ops-idle-worker-effectivity
make ops-effectivity-report
make ops-evidence-freshness
make ops-slice-ledger
make ops-tool-inventory
make ops-admin-effectivity-audit
make ops-proactive-radar
make ops-next-slice-selector
make ops-pr-stack-readiness
make ops-pr-conflict-packets
make ops-pr-backlog-packets
make ops-privileged-evidence-read
make ops-privileged-evidence-capture-smoke
make ops-work-packet
make ops-incident-bundle
make ops-incident-bundle-v2
make ops-ci-validate
make ops-post-deploy-verify
make ops-docs
make ops-backlog
make ops-report
```

Windows-friendly npm equivalent:

```bash
npm run ops:proactive:radar
npm run ops:pr-stack:readiness
npm run ops:evidence:freshness
npm run ops:db-docker-backup:rollup
npm run ops:command-surface:guard
npm run ops:command-manifest
npm run ops:output:retention
npm run ops:producer:refresh
npm run ops:next-slice:selector
npm run ops:privileged-evidence:read
npm run ops:pr-conflict:packets
npm run ops:pr-backlog:packets
npm run ops:dependency:cadence
npm run ops:dependency:security-scout
npm run ops:dependency:remediation-packet
npm run ops:dependency:upstream-watch
npm run ops:dependency:zero-baseline
npm run ops:dependency:inventory
npm run ops:postgres:snapshot
npm run ops:docker:tag-policy
npm run ops:incident:bundle
npm run ops:incident:bundle:v2
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
node scripts/ops/ops_command_manifest.mjs --write
node scripts/ops/output_retention_scanner.mjs --write
node scripts/ops/producer_refresh_runner.mjs --write
node scripts/ops/next_slice_selector.mjs --refresh --write
node scripts/ops/pr_conflict_packets.mjs --refresh --write
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

`ops-privileged-evidence-capture` is intentionally not a normal safe command. It is the approval-gated host capture path for sudo-unavailable agents. Run it only under the narrow procedure in `22-privileged-evidence-capture.md`, with explicit owner approval and a bounded output directory.

`ops-proactive-radar` is a read-only loop-start command. It looks for merge-blocked PRs, stacked draft PR pressure, stale ops artifacts, dirty worktree risk, and hidden ops scripts without printing secrets or mutating the host. It also reads `docs/ops/output-artifact-producers.json` so stale producer evidence points to exact `output/ops/...` paths and safe refresh commands.

`ops-next-slice-selector` refreshes the proactive radar, then emits the single highest-ranked producer refresh task plus a short ranked preview. It writes under `output/ops/next-slice-selector` and never runs the selected refresh command for you.

Selector statuses are intentionally conservative:

- `action_ready`: a safe read-only command or producer refresh is available to run.
- `blocked_on_approval`: the highest-value remaining work is represented by approval-gated packets, such as dirty PR conflict packets or stacked draft owner decisions.
- `manual_review`: the next item is commandless planning/review work, not executable automation.
- `ok`: no producer refresh or radar recommendation task is currently selected.
- `blocked`: selector input could not be read or refreshed.

`ops-producer-refresh` reads `docs/ops/output-artifact-producers.json` and creates a safe refresh plan for stale producer evidence. It is plan-only by default; pass `-- --execute` through npm, or run the node script with `--execute`, when you intentionally want it to run selected read-only refresh commands. Live probes and approval-gated commands are skipped unless explicitly included.

`ops-pr-stack-readiness` is a read-only GitHub PR-stack packet. It groups open PRs by stack, identifies dirty non-draft PRs, stale PRs, and non-main draft chains, and writes artifacts under `output/ops/pr-stack`.

`ops-pr-conflict-packets` consumes the PR-stack packet and writes focused issue-ready conflict-resolution packets for dirty non-draft PRs under `output/ops/pr-conflict-packets`. It never rebases, force-pushes, closes PRs, deletes branches, or edits worktrees.

`ops-pr-backlog-packets` consumes the PR-stack packet and writes grouped owner-decision packets for stale drafts, stacked draft chains, unstable non-draft PRs, and dirty-PR handoffs under `output/ops/pr-backlog-decision-packets`. It is read-only and never closes PRs, rebases branches, force-pushes, deletes branches, or edits worktrees.

`ops-evidence-freshness` checks whether the main ops evidence artifacts are recent enough to trust and writes issue-ready refresh tasks under `output/ops/evidence-freshness`.

`ops-db-docker-backup-rollup` runs the existing read-only Docker, PostgreSQL, backup, Redis/MinIO, and restore-prerequisite packets, stores their text evidence under `output/ops/db-docker-backup`, and summarizes degraded lanes with issue-ready follow-up tasks.

`ops-command-surface-guard` checks that documented `make`, `npm run`, and direct `scripts/ops` commands still resolve. It writes artifacts under `output/ops/command-surface-guard` and is meant to catch command-wrapper drift before PRs stack up.

`ops-command-manifest` writes a machine-readable inventory of Make targets, npm wrappers, direct ops scripts, docs coverage, lane classification, approval class, and output producer policy links. It writes under `output/ops/command-manifest` and does not execute the cataloged commands.

`ops-dependency-inventory` prints read-only local tool versions plus ops/studio package scripts. It is also included inside incident bundles and avoids reading `.env` values.

`ops-postgres-snapshot` writes redacted PostgreSQL DBA evidence under `output/ops/postgres/<timestamp>` using direct `psql` or the local Studio Brain Postgres container when available. It wraps packets in read-only transactions and degrades to skipped reports when credentials, Docker, or PostgreSQL are unavailable.

The specialist PostgreSQL targets `ops-postgres-top-queries`, `ops-postgres-query-tasks`, `ops-postgres-growth-snapshot`, `ops-postgres-autovacuum-stats`, and `ops-postgres-roles-extensions` run one read-only DBA packet at a time through `ops-postgres-sql`. Use them when a focused DBA artifact is easier to review than the full snapshot bundle. They do not change schema, roles, indexes, settings, or data.

`ops-docker-posture` runs the Docker posture review directly when a focused container/config report is enough and the broader Docker review would be noisy. It is read-only and does not pull, restart, prune, or remove Docker resources.

`ops-slice-ledger` summarizes recent slice work and evidence into a local automation ledger. `ops-admin-effectivity-audit` reviews whether the admin/ops loop is producing useful evidence rather than no-op churn. `ops-tool-inventory` captures local tool/version posture. These are local read-only operator aids.

`ops-docs` and `ops-backlog` are convenience wrappers for regenerating or reviewing the durable Markdown ops artifacts; they do not approve any host mutation by themselves.

`ops-output-retention` scans ignored `output/ops` artifacts for file count, total size, largest producers, stale files, and retention recommendations. It writes under `output/ops/output-retention` and never deletes, rotates, compresses, or prunes artifacts.

The scanner reads producer freshness expectations from `docs/ops/output-artifact-producers.json`; missing producers fall back to a conservative 14-day review window and human-approved cleanup.

`ops-dependency-security-scout` compares open Dependabot alerts, open Dependabot PR readiness, and local `npm audit` summaries across the repo's package surfaces. It writes issue-ready follow-up tasks under `output/ops/dependency-security-scout` and does not install, update, or fix packages.

`ops-dependency-cadence` refreshes the dependency scout, upstream-watch, and zero-baseline producers, then writes one operator packet under `output/ops/dependency-cadence`. It does not install, update, audit-fix, override, remove, or rewrite dependencies.

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
