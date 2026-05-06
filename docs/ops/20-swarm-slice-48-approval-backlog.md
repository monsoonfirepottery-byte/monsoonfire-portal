# Ops Swarm Wave 1 Slice 48 Approval Backlog

Captured: 2026-05-06

Purpose: refresh the remaining approval gates into issue-ready backlog entries after PR #596 and Mission Control commit `9583f7f`.

## Issue-Ready Backlog

### [backup] Prove PostgreSQL dump and restore prerequisites

- Type: reliability, database, backup
- Priority: P0
- Effort: M
- Risk: low for evidence, high for any restore action
- Current evidence: PR #596 proves fresh config archive metadata, but PostgreSQL dump artifacts and current restore drill evidence remain missing.
- Approval gate: any restore execution, production data copy, or backup-path change.
- Acceptance criteria:
  - Identify expected PostgreSQL dump artifact path and retention policy.
  - Prove dump presence, age, size, and tool readability without printing data.
  - Document disposable-target restore prerequisites and rollback notes.
  - Capture a current restore-drill result or explicitly mark it blocked on owner approval.
- Suggested branch: `codex/ops-backup-restore-prereq`
- Suggested PR title: `[ops] Add PostgreSQL restore prerequisite packet`

### [backup] Classify Redis and MinIO backup authority

- Type: reliability, backup, storage
- Priority: P1
- Effort: S
- Risk: low for documentation, medium for backup changes
- Current evidence: backup evidence reports missing Redis and MinIO artifact directories.
- Approval gate: enabling, moving, deleting, or rewriting backup artifacts.
- Acceptance criteria:
  - Identify whether Redis and MinIO contain authoritative Studio Brain state.
  - If authoritative, define artifact path, freshness threshold, and restore test.
  - If non-authoritative, document why and list regeneration source.
  - Mission Control backup gap card remains visible until disposition is complete.
- Suggested branch: `codex/ops-redis-minio-backup-scope`
- Suggested PR title: `[ops] Classify Redis and MinIO backup scope`

### [wiki] Triage human-gated idle-worker wiki claims

- Type: operations, content governance, memory
- Priority: P1
- Effort: M
- Risk: medium
- Current evidence: idle-worker effectivity audit is otherwise passing but complete score remains `97` because 21 wiki claims require human approval.
- Approval gate: accepting, rejecting, rewriting, or publishing claims.
- Acceptance criteria:
  - Export the 21 claims into a redacted owner-review queue.
  - Group by claim source, impact, and required decision.
  - Provide accept/reject/defer choices with rollback notes.
  - Confirm the idle-worker audit no longer warns after approved decisions are processed.
- Suggested branch: `codex/ops-wiki-claim-review-queue`
- Suggested PR title: `[ops] Prepare idle-worker wiki claim review queue`

### [ubuntu] Review true failed units with privileged journals

- Type: ubuntu, security, reliability
- Priority: P1
- Effort: M
- Risk: low for read-only journals, medium for unit changes
- Current evidence: classifier identifies `dailyaidecheck.service`, `snap.canonical-livepatch.canonical-livepatchd.service`, and `systemd-networkd-wait-online.service` as true failed units.
- Approval gate: disabling, restarting, resetting, reinstalling, or reconfiguring units.
- Acceptance criteria:
  - Capture redacted privileged journal excerpts for each true failed unit.
  - Classify each as repair, intentionally disabled/noisy, upstream issue, or irrelevant.
  - Add post-checks and rollback notes for any proposed unit action.
  - Keep completed one-shot services out of the failure queue.
- Suggested branch: `codex/ops-failed-unit-journal-packet`
- Suggested PR title: `[ops] Add failed-unit privileged review packet`

### [security] Verify PostgreSQL and SSH hardening prerequisites

- Type: security, database, ubuntu
- Priority: P1
- Effort: M
- Risk: high for runtime changes
- Current evidence: PostgreSQL listens on all interfaces through Docker, and readable SSH fragments permit password and keyboard-interactive auth.
- Approval gate: firewall, bind-address, SSH auth, sudoers, user, or service changes.
- Acceptance criteria:
  - List known direct PostgreSQL clients and backup/probe connection paths.
  - Capture privileged firewall and effective SSH configuration.
  - Verify at least two key-based access paths before key-only SSH.
  - Include rollback and console-access notes.
- Suggested branch: `codex/ops-network-hardening-prereqs`
- Suggested PR title: `[ops] Prepare network hardening prerequisite packet`

### [capacity] Capture privileged Docker json-log sizes

- Type: capacity, docker, incident readiness
- Priority: P2
- Effort: S
- Risk: low for read-only privileged size reads, high for truncation/deletion
- Current evidence: Docker log exact sizes under `/var/lib/docker/containers` require privileged host read.
- Approval gate: truncating, deleting, rotating manually, pruning, or restarting containers.
- Acceptance criteria:
  - Capture container json-log sizes without printing log contents.
  - Add largest logs to incident/capacity evidence packet.
  - Propose logrotate or Docker logging options only as a separate approval packet.
- Suggested branch: `codex/ops-docker-log-size-evidence`
- Suggested PR title: `[ops] Add Docker log size evidence packet`

### [capacity] Classify import and cleanup candidates

- Type: capacity, cleanup, retention
- Priority: P2
- Effort: M
- Risk: high for cleanup
- Current evidence: import artifacts include large PST/zip files classified as requiring human approval.
- Approval gate: delete, move, compress, archive, prune, or alter source import artifacts.
- Acceptance criteria:
  - Classify imports as source-of-truth, replayable cache, backup-first cleanup, or do-not-touch.
  - Add owner decision fields and evidence paths.
  - Require backup/restore notes before any cleanup PR.
- Suggested branch: `codex/ops-import-retention-approval`
- Suggested PR title: `[ops] Prepare import retention approval packet`

## Backlog Ordering

1. PostgreSQL dump and restore prerequisites.
2. Redis/MinIO backup authority.
3. Failed-unit privileged review.
4. Network hardening prerequisites.
5. Wiki claim owner review queue.
6. Docker log size evidence.
7. Import and cleanup candidate classification.

This order keeps data recovery and security prerequisites ahead of cosmetic cleanup or runtime changes.
