# Ops Swarm Wave 1 Slice 01 Baseline Handoff

Captured: 2026-05-06

Owner lane: Worker A, docs/backlog.

Scope: baseline handoff from merged portal PR #596 and Mission Control commit `9583f7f`. This is an evidence packet, not approval to mutate the Studio Brain host.

## Baseline State

| Surface | Current baseline | Evidence |
| --- | --- | --- |
| Portal ops PR | PR #596 merged into `main` | merge commit `19a3614c0ffe5e48379936c41a69a84345670814` |
| Portal branch | `codex/ops-admin-remediation-20260506` | merged by PR #596 |
| Mission Control | backup confidence gaps surfaced in admin wall | commit `9583f7f` in `D:\kanban`, `mission-control: surface backup confidence gaps` |
| Studio Brain API | healthy and ready in PR #596 evidence | `healthz` and `readyz` passed on `http://192.168.1.226:8787` |
| Idle worker | operating but still warning on human-gated wiki claims | complete score `97`, current and history health `pass` |
| Backup posture | fresher config metadata, incomplete restore confidence | PostgreSQL, Redis, MinIO artifacts and current restore drill still unproven |

## What PR #596 Shipped

- Aligned overnight idle-worker systemd evidence with the clean-host lane.
- Added idle-worker effectivity and backup-evidence support paths to the host sync bundle.
- Added redacted root-owned backup metadata so non-root checks can prove config archive freshness without exposing archive contents or env values.
- Updated ops docs, runbooks, and integrity manifest entries for the new support files.

## Mission Control `9583f7f` Baseline

Mission Control main is at `9583f7f` in `D:\kanban`. The commit adds the operator-facing backup confidence gap card to the Mission Control admin surface and extends the corresponding app test coverage.

Treat this as the current human-facing admin baseline for backup confidence. Any later Mission Control work should preserve the backup gap signal until PostgreSQL dump evidence, Redis/MinIO scope, and restore drill evidence are either proven or explicitly closed.

## Carry-Forward Risks

| Risk | Current status | Next safe action |
| --- | --- | --- |
| Backup restore confidence | still incomplete | write an approval-ready restore-prerequisite packet before any restore drill |
| Human-gated wiki claims | 21 claims keep idle-worker audit in warning state | prepare owner review queue, do not auto-mutate wiki claims |
| Failed units | AIDE, Livepatch, and network-online need privileged review | gather journals in a read-only privileged packet |
| Docker log sizing | exact json-log sizes require privileged host read | add evidence slot and approval gate |
| Host drift cleanup | host drift is known risky | use a clean-lane plan before any reset, deploy, or cleanup |

## Handoff

Next workers should start from this baseline, then read:

- `docs/ops/18-swarm-slice-02-operating-contract.md`
- `docs/ops/19-swarm-slice-03-clean-worktree-lanes.md`
- `docs/ops/20-swarm-slice-48-approval-backlog.md`
- `docs/ops/21-swarm-slice-49-roadmap-30-60-90.md`

Do not use this packet to justify restarts, deploys, package updates, firewall changes, pruning, database writes, secret rotation, or cleanup. Those remain explicit approval gates.
