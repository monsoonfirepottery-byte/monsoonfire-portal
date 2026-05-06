# Studio Brain Ops Kanban Backlog

Each item is issue-ready and intentionally separates investigation from changes that need a service window or approval.

Post-merge note: the first ops-doctor stack has landed in `main`. The items below now emphasize verification, approval-gated runtime work, and the next safe operational surfaces instead of merge sequencing.

## Now

### [ops] Keep open PR stack audit current

- Type: reliability, cleanup, documentation
- Priority: P1
- Effort: S
- Risk: low
- Acceptance criteria:
  - Open portal and Mission Control PRs are listed with merge state, draft state, and recommended disposition.
  - Recently merged ops/admin PRs are recorded with merge commits.
  - Dirty or preview-only branches are separated from dependency updates and ops-doctor work.
- Status: current snapshot captured in `docs/ops/13-ops-pr-stack-audit.md`.
- Recommended owner: Codex
- Suggested branch name: `codex/ops-pr-stack-refresh`
- Suggested PR title: `[ops] Refresh ops PR stack audit`

### [ops] Verify merged ops-doctor stack from main

- Type: reliability, documentation
- Priority: P1
- Effort: S
- Risk: low
- Acceptance criteria:
  - Post-merge evidence lists merged PRs, merge commits, and superseded PR disposition.
  - Safe command smoke checks pass or have documented local-tool limitations.
  - Runtime deploy/install actions remain separated from repo merge work.
  - The ops docs index points operators to the current post-merge handoff.
- Status: follow-up prepared in `docs/ops/14-post-merge-verification.md`.
- Recommended owner: Codex
- Suggested branch name: `codex/ops-admin-next`
- Suggested PR title: `[ops] Add post-merge ops doctor handoff`

### [backup] Unify backup evidence and restore confidence

- Type: reliability, database, capacity
- Priority: P0
- Effort: M
- Risk: low for diagnostics, high for any backup-path change
- Status: backup evidence scripts and docs are merged; restore confidence still needs an approval-gated drill.
- Acceptance criteria:
  - Backup report distinguishes config archives, PostgreSQL dump, Redis state, MinIO data, and restore drill status.
  - Latest backup evidence is current within the documented threshold.
  - Restore-prerequisite drill is documented and can run without exposing secrets.
- Recommended owner: Codex, DBA review
- Suggested branch name: `codex/ops-backup-evidence`
- Suggested PR title: `[ops] Add Studio Brain backup evidence and restore drill report`

### [ubuntu] Triage apt OOM and failed system units

- Type: ubuntu, security, reliability
- Priority: P1
- Effort: M
- Risk: low for diagnostics, medium for package changes
- Status: diagnostic scripts and maintenance workflow are merged; package remediation remains approval-gated.
- Acceptance criteria:
  - `apt-daily-upgrade.service` OOM root cause is documented.
  - Failed `dailyaidecheck`, livepatch, and network-wait units have disposition: repair, disable intentionally, or ignore with reason.
  - Maintenance-window checklist exists for pending updates.
- Recommended owner: human, Codex
- Suggested branch name: `codex/ops-apt-failed-units-runbook`
- Suggested PR title: `[ops] Document apt OOM and failed-unit maintenance workflow`

### [security] Review DB and SSH network exposure

- Type: security, ubuntu, database
- Priority: P1
- Effort: M
- Risk: medium
- Status: network exposure review is merged; any firewall, bind-address, or SSH hardening remains approval-gated.
- Acceptance criteria:
  - Current listeners are captured in a redacted report.
  - Legitimate PostgreSQL clients are identified.
  - SSH password-auth usage is confirmed before any config change.
  - Any proposed bind/firewall/SSH change includes rollback and console access notes.
- Recommended owner: human, security review
- Suggested branch name: `codex/ops-network-exposure-review`
- Suggested PR title: `[ops] Add network exposure review and hardening checklist`

### [drift] Inventory live host checkout drift

- Type: reliability, cleanup, app
- Priority: P1
- Effort: M
- Risk: low for inventory, high for cleanup
- Status: host drift inventory workflow is merged; cleanup/reset actions remain approval-gated.
- Acceptance criteria:
  - Live dirty-file manifest exists with generated/artifact/source classifications.
  - Gone branch status is documented.
  - No host reset is performed without explicit approval.
- Recommended owner: Codex, human
- Suggested branch name: `codex/ops-host-drift-inventory`
- Suggested PR title: `[ops] Add live host drift inventory workflow`

### [capacity] Classify import pressure artifacts

- Type: capacity, cleanup, app
- Priority: P1
- Effort: S
- Risk: low for diagnostics, medium for any cleanup
- Acceptance criteria:
  - `/home/wuff/imports` immediate children are listed by size and age without printing imported content.
  - Cleanup candidates are classified as safe to automate, safe with backup, service-window, approval-only, or do not touch.
  - The report captures growth deltas when prior snapshots exist.
  - No files are deleted, compressed, moved, or modified.
- Status: read-only script prepared as `scripts/ops/import_pressure.sh`; live output shows two 22G PST files plus smaller zip archives under `/home/wuff/imports`, all classified `requires_human_approval`.
- Recommended owner: Codex, human
- Suggested branch name: `codex/ops-import-pressure-report`
- Suggested PR title: `[ops] Add import growth pressure report`

### [cleanup] Generate approval-gated cleanup candidate packets

- Type: cleanup, capacity, docker, ubuntu, documentation
- Priority: P1
- Effort: S
- Risk: low for diagnostics, high for any cleanup action
- Acceptance criteria:
  - A read-only command inventories Docker artifacts, large logs, old temp files, imports, and backup candidates.
  - Each cleanup family is classified as safe to automate, safe with backup, requires service window, requires human approval, or do not touch.
  - The report does not delete, prune, truncate, move, compress, restart, or expose environment values.
  - The maintenance calendar requires this packet before cleanup proposals.
- Status: read-only generator prepared as `scripts/ops/cleanup_candidates.sh` and wrapped by `make ops-cleanup-candidates`.
- Recommended owner: Codex, human
- Suggested branch name: `codex/ops-cleanup-candidates`
- Suggested PR title: `[ops] Add cleanup candidate generator`

## Next

### [systemd] Source-control idle-worker timers

- Type: reliability, documentation
- Priority: P2
- Effort: S
- Risk: low
- Acceptance criteria:
  - `studio-brain-idle-worker` and overnight unit files are tracked under `config/studiobrain/systemd`.
  - Install/reconcile scripts include them.
  - Docs list cadence and safety mode.
- Status: source-controlled timer and drop-in files are merged; live installation remains approval-gated.
- Recommended owner: Codex
- Suggested branch name: `codex/ops-idle-worker-systemd`
- Suggested PR title: `[ops] Track Studio Brain idle-worker systemd timers`

### [docker] Add missing container healthchecks

- Type: docker, reliability
- Priority: P2
- Effort: M
- Risk: medium
- Acceptance criteria:
  - Monitoring proxy and SearXNG healthchecks use stable local endpoints.
  - Compose validation passes.
  - Rollback is removing the healthcheck stanzas.
- Recommended owner: Codex
- Suggested branch name: `codex/ops-docker-healthchecks`
- Suggested PR title: `[ops] Add non-invasive Docker healthchecks`

### [database] Schedule weekly PostgreSQL size and activity snapshots

- Type: database, capacity, performance
- Priority: P2
- Effort: S
- Risk: low
- Acceptance criteria:
  - Read-only SQL scripts capture database sizes, largest tables/indexes, dead tuples, locks, active sessions, and key settings.
  - Output avoids secrets and query parameter values where practical.
  - Runbook explains how to store snapshots.
- Recommended owner: Codex, DBA review
- Suggested branch name: `codex/ops-postgres-readonly-review`
- Suggested PR title: `[ops] Add read-only PostgreSQL DBA review scripts`

### [sre] Capture redacted incident evidence bundles

- Type: reliability, documentation, app, ubuntu, docker, database
- Priority: P2
- Effort: S
- Risk: low
- Acceptance criteria:
  - One command captures read-only app status, process pressure, socket pressure, Docker, PostgreSQL, backup, network, and host drift evidence.
  - Raw journals are skipped by default or redacted when explicitly requested.
  - Runbook tells operators to capture evidence before restarts or cleanup.
- Recommended owner: Codex
- Suggested branch name: `codex/ops-incident-bundle`
- Suggested PR title: `[ops] Add Studio Brain incident evidence bundle`

### [app] Review app status beyond liveness checks

- Type: reliability, app, documentation
- Priority: P2
- Effort: S
- Risk: low
- Acceptance criteria:
  - Read-only app review checks `/healthz`, `/api/status`, and Mission Control health/pressure.
  - Output redacts token-like keys and avoids environment dumps.
  - Maintenance calendar includes the check in daily or incident workflows.
- Recommended owner: Codex
- Suggested branch name: `codex/ops-app-status-review`
- Suggested PR title: `[ops] Add Studio Brain app status review`

### [app] Inventory Node dependency audit posture

- Type: app, security, cleanup, documentation
- Priority: P2
- Effort: S
- Risk: low
- Acceptance criteria:
  - A read-only command inventories npm workspaces, package-lock coverage, dependency counts, declared engines, overrides, and npm audit severity totals.
  - Workspaces without lockfiles are classified as skipped instead of failing noisily.
  - The command does not install packages, update lockfiles, run `npm audit fix`, or print environment values.
  - Non-clean findings are treated as issue evidence for small dependency PRs with package-specific tests.
- Status: read-only script prepared as `scripts/ops/npm_audit_inventory.sh` and wrapped by `make ops-dependency-review`.
- Recommended owner: Codex, security review
- Suggested branch name: `codex/ops-npm-audit-inventory`
- Suggested PR title: `[ops] Add npm audit inventory report`

### [mission-control] Manage laptop watcher lifecycle safely

- Type: reliability, app, documentation
- Priority: P2
- Effort: S
- Risk: low for documentation, medium for pause/restart actions
- Acceptance criteria:
  - The laptop Mission Control gateway, SSH tunnel, and `mission:codex-laptop-watch` process roles are documented.
  - Read-only status commands show scheduled task state, tunnel listener state, process identity, and recent logs.
  - Pause, resume, disable, enable, and process stop actions are clearly marked approval-gated.
  - Rollback and post-checks include tunnel health, Mission Control UI reachability, and duplicate watcher checks.
- Status: documentation prepared; runtime pause/restart remains approval-gated.
- Recommended owner: Codex, human
- Suggested branch name: `codex/ops-mission-control-watcher-plan`
- Suggested PR title: `[ops] Document Mission Control watcher lifecycle`

### [ops] Watch portal bridge tunnel restart history

- Type: reliability, app, ubuntu
- Priority: P2
- Effort: S
- Risk: low for diagnostics, medium for service changes
- Acceptance criteria:
  - Portal bridge review reports proxy/tunnel active state, restart count, and localhost listener posture without dumping env or key material.
  - A restart-count increase is classified as a watch item with safe next steps before any service action.
  - Maintenance calendar or weekly ops checks include the portal bridge review command.
- Status: review script/docs prepared; runtime restart/rekey remains approval-gated.
- Recommended owner: Codex, human
- Suggested branch name: `codex/ops-portal-bridge-review`
- Suggested PR title: `[ops] Add portal bridge review`

### [docker] Pin floating image tags

- Type: docker, security, reliability
- Priority: P2
- Effort: M
- Risk: medium
- Acceptance criteria:
  - Floating tags are listed.
  - Update policy and rollback command are documented.
  - Image pin changes, if made, are one service group per PR.
- Recommended owner: Codex, human
- Suggested branch name: `codex/ops-docker-image-pinning`
- Suggested PR title: `[ops] Document Docker image pinning plan`

## Later

### [capacity] Add growth trend reporting

- Type: capacity, database, docker
- Priority: P3
- Effort: M
- Risk: low
- Acceptance criteria:
  - Weekly snapshots include `/home/wuff`, Docker, Postgres relation sizes, logs, and backup sizes.
  - 30/60/90 day projections are generated from at least 4 samples.
- Recommended owner: Codex
- Suggested branch name: `codex/ops-capacity-trends`
- Suggested PR title: `[ops] Add capacity trend snapshot format`

### [observability] Convert overseer critical gaps into tickets

- Type: app, reliability, documentation
- Priority: P3
- Effort: M
- Risk: low
- Acceptance criteria:
  - Current overseer gaps are exported into issue-ready markdown.
  - Stale/accepted gaps can be acknowledged with reason.
- Recommended owner: Codex, human
- Suggested branch name: `codex/ops-overseer-gap-backlog`
- Suggested PR title: `[ops] Export overseer gaps into reviewable backlog`

### [cleanup] Classify Docker anonymous volumes

- Type: docker, cleanup, capacity
- Priority: P3
- Effort: S
- Risk: low for classification, high for deletion
- Acceptance criteria:
  - Anonymous volumes are mapped to containers/projects or marked unknown.
  - Cleanup candidates are classified as safe to automate, safe with backup, requires service window, requires human approval, or do not touch.
- Recommended owner: Codex
- Suggested branch name: `codex/ops-docker-volume-inventory`
- Suggested PR title: `[ops] Add Docker volume cleanup inventory`

## Waiting / Needs Human Approval

### [security] Bind PostgreSQL to loopback or add firewall rules

- Type: security, database, ubuntu
- Priority: P1
- Effort: M
- Risk: high
- Acceptance criteria:
  - Approved client list exists.
  - Rollback and service-window plan exists.
  - App, backups, and DBA probes still connect after the change.
- Recommended owner: human, DBA review, security review
- Suggested branch name: `codex/ops-postgres-bind-hardening`
- Suggested PR title: `[ops] Harden PostgreSQL host binding`

### [security] Move SSH to key-only auth

- Type: security, ubuntu
- Priority: P2
- Effort: M
- Risk: high
- Acceptance criteria:
  - At least two working keys or an out-of-band console path are verified.
  - Password and keyboard-interactive auth are disabled.
  - Fail2ban remains active.
- Recommended owner: human, security review
- Suggested branch name: `codex/ops-ssh-key-only-plan`
- Suggested PR title: `[ops] Plan Studio Brain SSH key-only hardening`

### [ubuntu] Apply pending package updates

- Type: ubuntu, security
- Priority: P1
- Effort: M
- Risk: medium
- Acceptance criteria:
  - Maintenance window is approved.
  - Pre-checks and rollback notes are captured.
  - Post-checks include Studio Brain health, Docker health, Mission Control health, and backup evidence.
- Recommended owner: human
- Suggested branch name: `codex/ops-package-update-window`
- Suggested PR title: `[ops] Prepare Studio Brain package update window`
