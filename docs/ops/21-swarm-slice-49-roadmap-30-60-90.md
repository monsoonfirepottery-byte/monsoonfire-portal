# Ops Swarm Wave 1 Slice 49 Roadmap 30/60/90

Captured: 2026-05-06

Purpose: refresh the Studio Brain ops roadmap after PR #596 and Mission Control commit `9583f7f`.

## 30 Days

Goal: close evidence gaps without mutating production by accident.

| Outcome | Work | Verification |
| --- | --- | --- |
| Restore confidence has a real baseline | Prove PostgreSQL dump presence and document disposable restore prerequisites | redacted backup packet with dump age, size, tool availability, and restore-drill status |
| Backup scope is explicit | Classify Redis and MinIO as authoritative or regenerable | docs updated and Mission Control backup gap card disposition recorded |
| Failed units are no longer ambiguous | Capture privileged journals for AIDE, Livepatch, and network-online | issue-ready repair/disable/ignore recommendation per unit |
| Swarm stays coordinated | Use the operating contract and clean worktree lanes for every wave-1 slice | PRs include slice numbers, ownership, verification, and untouched approval gates |
| Mission Control reflects ops gaps | Preserve backup confidence gap signal and add links to current packets | admin surface shows actionable backup gaps without hiding approvals |

## 60 Days

Goal: turn evidence into approved, reversible operational improvements.

| Outcome | Work | Verification |
| --- | --- | --- |
| Restore drill is current | Run approved disposable-target restore drill | drill result, recovery time notes, and rollback evidence are captured |
| Package maintenance is supervised | Execute approved package update/reboot window if still needed | health, readiness, Docker, Mission Control, and backup evidence pass after reboot |
| Network hardening is ready or complete | Confirm clients, firewall, SSH keys, and rollback path | key-only SSH and PostgreSQL bind/firewall plan is approved or shipped with post-checks |
| Runtime logs are measurable | Add privileged Docker log size evidence and rotation recommendation | capacity report includes log sizes without contents |
| Idle-worker warning debt is owner-reviewed | Process or defer human-gated wiki claims | effectivity audit warning count is reduced or justified |

## 90 Days

Goal: make ops posture trend-based instead of snapshot-based.

| Outcome | Work | Verification |
| --- | --- | --- |
| Backup health is trendable | Weekly backup evidence includes config, PostgreSQL, Redis/MinIO scope, and restore recency | Mission Control and docs show backup confidence state over time |
| Capacity planning is predictive | Four or more weekly samples feed 30/60/90 projections | capacity plan includes growth trend for Postgres, imports, Docker, logs, and backups |
| Host drift is controlled | Host checkout drift is classified and reconciled through PRs | clean lane is deploy source and host drift report has no unknown source/config surprises |
| Security posture has an audit trail | SSH, firewall, DB exposure, and package decisions are documented | approval packets link to post-change verification or explicit deferral |
| Swarm process is repeatable | Wave 1 contract becomes the standing ops swarm template | next swarm wave can start from docs without reconstructing roles or safety gates |

## Roadmap Guardrails

- Evidence-first work can proceed without host mutation.
- Runtime changes require explicit approval, rollback notes, and post-checks.
- Mission Control should expose human-actionable gaps, not raw debug noise.
- Backup and restore confidence outrank cleanup convenience.
- Do not hide warning states by narrowing checks; resolve or explicitly defer them.

## Review Cadence

- Weekly: run read-only ops evidence and update approval backlog statuses.
- Monthly: refresh roadmap progress and retire completed gates.
- After every approved runtime change: add a post-change verification packet before closing the issue.
