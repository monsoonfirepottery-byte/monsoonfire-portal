# Ops PR Stack Audit

Captured: 2026-05-06

This audit inventories currently open Studio Brain / ops-adjacent PRs and separates merge order from runtime approval. It is read-only evidence gathered from GitHub metadata.

Post-merge note: this audit is historical. The ops-doctor stack has since landed; see `docs/ops/14-post-merge-verification.md` for the merged state.

## Primary Ops-Doctor Stack

Merge from the bottom upward. Each PR currently reports a clean merge state, but stacked branches should still be refreshed after the PR below lands.

| Order | PR | Head | Base | Draft | Current role |
| ---: | --- | --- | --- | --- | --- |
| 1 | [#553 `[ops] Add Studio Brain ops doctor first pass`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/553) | `codex/studio-brain-ops-doctor` | `main` | yes | Root discovery and ops-doctor artifacts. |
| 2 | [#568 `[ops] Add Studio Brain backup evidence report`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/568) | `codex/ops-backup-evidence` | `codex/studio-brain-ops-doctor` | no | Backup evidence and restore confidence. |
| 3 | [#569 `[ops] Document apt OOM and failed-unit workflow`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/569) | `codex/ops-apt-failed-units-runbook` | `codex/ops-backup-evidence` | no | Ubuntu failed units and apt OOM triage. |
| 4 | [#570 `[ops] Add network exposure review and hardening checklist`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/570) | `codex/ops-network-exposure-review` | `codex/ops-apt-failed-units-runbook` | no | Listener, firewall, SSH, and DB exposure review. |
| 5 | [#571 `[ops] Add live host drift inventory workflow`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/571) | `codex/ops-host-drift-inventory` | `codex/ops-network-exposure-review` | no | Live checkout drift inventory. |
| 6 | [#572 `[ops] Track Studio Brain idle-worker systemd timers`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/572) | `codex/ops-idle-worker-systemd` | `codex/ops-host-drift-inventory` | no | Source-controlled idle-worker timers; installation remains approval-gated. |
| 7 | [#573 `[ops] Add Studio Brain incident evidence bundle`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/573) | `codex/ops-admin-incident-bundle` | `codex/ops-idle-worker-systemd` | yes | Incident bundle, app status review, CPU incident runbook, and watcher lifecycle. |

## Current Check State

- PR #573 is green on the observed checks: `build_and_preview`, `intent-drift`, `lighthouse`, `functional-gate`, `drift-blocker`, `smoke`, `ios-smoke`, and `swift-build`; `supervisor-audit` is skipped.
- PR #573 should remain stacked until #572 lands or is retargeted.
- PR #553 is the root branch and is still draft; it is the first human review decision before the rest of the stack can land cleanly.

## Separate Mission Control PR

| PR | Repo | Head | Base | Draft | Checks | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [#1 `[mission-control] Harden operator surface and ingest pressure`](https://github.com/monsoonfirepottery-byte/studio-brain-mission-control/pull/1) | `studio-brain-mission-control` | `codex/mission-control-ingest-pressure` | `main` | no | `preflight` passed | Publishes the deployed CPU/backpressure hotfix plus follow-up telemetry and CI fixes. Final UI/health telemetry commits still need an approved deploy. |

## Other Open Ops-Adjacent PRs

| PR | Head | Draft | Merge state | Note |
| --- | --- | --- | --- | --- |
| [#552 `chore(deps): bump ip-address`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/552) | `dependabot/npm_and_yarn/studio-brain/ip-address-10.2.0` | no | clean | Dependency/security review candidate. |
| [#547 `chore(deps): bump the routine-version-updates group`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/547) | `dependabot/npm_and_yarn/studio-brain/routine-version-updates-0d915e92d5` | no | unknown | Needs CI/status refresh before merge. |
| [#527 `[codex] Add Postgres-backed agent wiki`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/527) | `codex/auto` | yes | unknown | Older draft; needs owner decision or archival. |
| [#512 `[codex] Add memory ops sidecar`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/512) | `codex/memory-ops-sidecar` | yes | unknown | Older draft; likely superseded or needs rebase. |
| [#492 `[codex] Replace public ops portal bridge`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/492) | `codex/ops-bridge-replace-472` | no | unknown | Older ops bridge change; needs explicit review before touching production surfaces. |

## Recommended Next Actions

1. Review PR #553 first; decide whether the root ops-doctor pass should become ready or remain draft.
2. Merge the ops-doctor stack bottom-up only after each PR is green against its current base.
3. Keep runtime installation/deploy actions separate from merge approval:
   - idle-worker timer installation remains approval-gated
   - Mission Control final deploy remains approval-gated
   - any package, firewall, SSH, Docker prune, or database action remains approval-gated
4. Triage Dependabot PR #552 separately as a security/dependency slice.
5. Ask whether old draft PRs #527, #512, and #492 should be refreshed, superseded, or closed.

## Evidence Commands

```bash
gh pr list --state open --limit 80 --json number,title,headRefName,baseRefName,isDraft,mergeStateStatus,updatedAt,url
gh pr view 573 --json url,title,isDraft,mergeStateStatus,statusCheckRollup,headRefName,baseRefName
gh pr view --repo monsoonfirepottery-byte/studio-brain-mission-control 1 --json url,title,isDraft,mergeStateStatus,statusCheckRollup,headRefName,baseRefName
```
