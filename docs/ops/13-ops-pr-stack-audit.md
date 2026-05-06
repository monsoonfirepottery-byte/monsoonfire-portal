# Ops PR Stack Audit

Captured: 2026-05-06

This audit inventories current Studio Brain / ops-adjacent pull requests and separates merge order from runtime approval. It is read-only evidence gathered from GitHub metadata.

## Current State

- The first ops-doctor portal stack has landed through PR #580.
- The Mission Control ingest/deploy hardening stack has landed through Mission Control PR #5.
- The `studio-brain-mission-control` repo has no open PRs in the observed snapshot.
- Remaining open portal PRs are older dependabot, draft, or dirty branches. Treat them as independent triage work, not blockers for the ops-doctor docs/scripts lane.

## Recently Landed Portal Ops PRs

| PR | Title | Merge commit | Notes |
| --- | --- | --- | --- |
| [#574](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/574) | `[ops] Add post-merge ops doctor handoff` | `73fb3b944bdc0a4f91175b046743a97c6319c055` | Post-merge verification packet and handoff. |
| [#575](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/575) | `[ops] Add machine-readable ops report summary` | `cfaf8f652950b971a621c1fe6c4cba8ecbebada7` | Adds ops report summary JSON. |
| [#576](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/576) | `[ops] Track idle-worker live systemd drop-ins` | `a0b4b86c41ea23caa88246e11e3148fc7794eb69` | Tracks live idle-worker drop-ins; host install remains approval-gated. |
| [#577](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/577) | `[ops] Add systemd drift review` | `2d6ef800c40783c89c3f31c2ff849113a2c4b993` | Adds read-only tracked-vs-installed systemd comparison. |
| [#578](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/578) | `[ops] Classify portal bridge systemd services` | `d3eb3823c4f6be4744634c1377ee029bb963472c` | Classifies generated portal bridge units. |
| [#579](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/579) | `[ops] Add portal bridge review` | `38f6c3d9f548f7bc428b6db55a3683f8432d6ce2` | Adds read-only portal bridge service review. |
| [#580](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/580) | `[ops] Add portal bridge restart watch item` | `d1aa553138a0fd66e71e525d3116d68156663ff9` | Adds restart-history risk/backlog/calendar coverage. |

## Recently Landed Mission Control PRs

| PR | Title | Merge commit | Operational note |
| --- | --- | --- | --- |
| [#1](https://github.com/monsoonfirepottery-byte/studio-brain-mission-control/pull/1) | `[mission-control] Harden operator surface and ingest pressure` | `4406b94f014a60f987f31192ed2ae80789699d8a` | Published the CPU/backpressure fix and telemetry. |
| [#2](https://github.com/monsoonfirepottery-byte/studio-brain-mission-control/pull/2) | `[mission-control] Add post-merge deploy packet` | `68337f525441cda6faec2b82b99bf1e32522cd83` | Adds deployment packet and verification notes. |
| [#3](https://github.com/monsoonfirepottery-byte/studio-brain-mission-control/pull/3) | `[mission-control] Add read-only gateway status probe` | `960b86f53767392b6d87fa9e1f5223c31e028020` | Adds laptop gateway status visibility. |
| [#4](https://github.com/monsoonfirepottery-byte/studio-brain-mission-control/pull/4) | `[deploy] Document user-service Mission Control deploy target` | `baadf0777fb31c2d8eb6b2ede88e101548e25a9e` | Documents the actual user systemd service target. |
| [#5](https://github.com/monsoonfirepottery-byte/studio-brain-mission-control/pull/5) | `[deploy] Guard Mission Control production deploy refs` | `c10351ad9ed157018d271df311dc9e7d7e44a024` | Prevents accidental production deploys from non-main refs unless explicitly overridden. |

## Current Open Portal PRs

| PR | Head | Draft | Merge state | Recommended disposition |
| --- | --- | --- | --- | --- |
| [#552 `chore(deps): bump ip-address`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/552) | `dependabot/npm_and_yarn/studio-brain/ip-address-10.2.0` | no | behind | Rebase/update and run dependency/security checks as a separate slice. |
| [#550 `[codex] Ship Monsoon Fire website v2.1.4`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/550) | `codex/website-v2-1-4-footer` | yes | behind | Keep preview-only unless the owner approves production website work. |
| [#547 `chore(deps): bump the routine-version-updates group`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/547) | `dependabot/npm_and_yarn/studio-brain/routine-version-updates-0d915e92d5` | no | behind | Rebase/update and validate in dependency lane. |
| [#546 `chore(deps): bump zod`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/546) | `dependabot/npm_and_yarn/functions/routine-version-updates-8616668734` | no | behind | Rebase/update and validate functions tests. |
| [#530 `[codex] Add polished firing care preview site`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/530) | `codex/firing-care-preview-copy-polish` | yes | behind | Preserve preview boundary; owner decision needed. |
| [#529 `chore(deps): bump the routine-version-updates group`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/529) | `dependabot/npm_and_yarn/routine-version-updates-f507880656` | no | behind | Rebase/update and validate root dependency checks. |
| [#527 `[codex] Add Postgres-backed agent wiki`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/527) | `codex/auto` | yes | dirty | Needs owner decision: refresh, supersede, or close. |
| [#525 `[codex] Harden agentic audit guardrails`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/525) | `codex/agentic-audit-guardrails` | yes | dirty | Needs owner decision and conflict triage. |
| [#519 `chore(deps-dev): bump typescript-eslint`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/519) | `dependabot/npm_and_yarn/web/routine-version-updates-ac3af5607b` | no | behind | Rebase/update and validate web lint/test lane. |
| [#512 `[codex] Add memory ops sidecar`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/512) | `codex/memory-ops-sidecar` | yes | dirty | Likely superseded; needs explicit review before reviving. |
| [#492 `[codex] Replace public ops portal bridge`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/492) | `codex/ops-bridge-replace-472` | no | dirty | Do not merge without a fresh bridge design review. |
| [#490 `Align redacted curl output with actual headers`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/490) | `codex/review-model-coding-issues-and-submit-pr` | no | behind | Rebase/update or close after checking whether the fix is already present. |

## Recommended Next Actions

1. Keep ops-doctor work on fresh `origin/main` branches with one small PR per documentation or read-only script slice.
2. Triage Dependabot PR #552 first among dependency PRs because it is security-adjacent and scoped to `studio-brain`.
3. Treat dirty draft PRs as owner-decision cleanup, not routine merge candidates.
4. Preserve preview-only website boundaries for PRs #550 and #530.
5. Do not use old portal bridge PR #492 as an implementation base until it is compared against the current portal bridge review in `docs/ops/15-portal-bridge-review.md`.

## Evidence Commands

```bash
gh pr list --repo monsoonfirepottery-byte/monsoonfire-portal --state open --limit 30 --json number,title,headRefName,isDraft,mergeStateStatus,updatedAt
gh pr list --repo monsoonfirepottery-byte/studio-brain-mission-control --state open --limit 30 --json number,title,headRefName,isDraft,mergeStateStatus,updatedAt
gh pr list --repo monsoonfirepottery-byte/studio-brain-mission-control --state merged --limit 8 --json number,title,headRefName,mergedAt,mergeCommit
git log origin/main --oneline -12
```
