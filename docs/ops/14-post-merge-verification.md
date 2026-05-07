# Ops Doctor Post-Merge Verification

Captured: 2026-05-06

This note records the merged state after the first Studio Brain ops-doctor stack landed. It is not a deploy record and does not imply runtime approval.

## Merged Pull Requests

| PR | Result | Merge commit | Notes |
| --- | --- | --- | --- |
| [#553 `[ops] Add Studio Brain ops doctor first pass`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/553) | merged | `111570e3912cb98b6c84542926ca49f3c83ed3ed` | root ops-doctor inventory, risks, backlog, capacity, DBA, Docker, runbooks, calendar |
| [#568 `[ops] Add Studio Brain backup evidence report`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/568) | merged | `3dbb1400106cc4c29864030b685510e65a332d8f` | backup evidence and restore confidence |
| [#569 `[ops] Document apt OOM and failed-unit workflow`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/569) | merged | `f88d446a6b6fc06ced8324d427640be4e5f70602` | apt OOM and failed-unit workflow |
| [#573 `[ops] Add Studio Brain incident evidence bundle`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/573) | merged | `8dbb048268d8ccafdebed880eff018957ccb204d` | remaining stack: network exposure, host drift, idle-worker timer files, app review, incident bundle, CPU runbook, watcher lifecycle, PR audit |
| [#570](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/570) | closed | landed via #573 | network exposure review |
| [#571](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/571) | closed | landed via #573 | live host drift inventory |
| [#572](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/572) | closed | landed via #573 | idle-worker timer files; runtime installation still approval-gated |
| [#574 `[ops] Add post-merge ops doctor handoff`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/574) | merged | `73fb3b944bdc0a4f91175b046743a97c6319c055` | post-merge verification packet |
| [#575 `[ops] Add machine-readable ops report summary`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/575) | merged | `cfaf8f652950b971a621c1fe6c4cba8ecbebada7` | summary JSON for generated ops reports |
| [#576 `[ops] Track idle-worker live systemd drop-ins`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/576) | merged | `a0b4b86c41ea23caa88246e11e3148fc7794eb69` | source-controls live idle-worker drop-ins; install remains approval-gated |
| [#577 `[ops] Add systemd drift review`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/577) | merged | `2d6ef800c40783c89c3f31c2ff849113a2c4b993` | read-only systemd tracked-vs-installed drift check |
| [#578 `[ops] Classify portal bridge systemd services`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/578) | merged | `d3eb3823c4f6be4744634c1377ee029bb963472c` | generated portal bridge units classified in drift review |
| [#579 `[ops] Add portal bridge review`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/579) | merged | `38f6c3d9f548f7bc428b6db55a3683f8432d6ce2` | read-only portal bridge service and listener review |
| [#580 `[ops] Add portal bridge restart watch item`](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/pull/580) | merged | `d1aa553138a0fd66e71e525d3116d68156663ff9` | risk/backlog/calendar coverage for tunnel restart history |

## Mission Control Deploy State

The Mission Control CPU/backpressure and deploy-guard stack is merged through PR #5 in `studio-brain-mission-control`. The live host was redeployed from main after a stale branch package briefly overwrote the verified release.

Observed live release after repair:

- Git commit: `baadf0777fb31c2d8eb6b2ede88e101548e25a9e`
- Release id: `mission-control-20260506-main-baadf07`
- Package SHA256: `9a1a82c87553d7add51706ba828fc85f5b720056a0ef4fdd90f6ab3375567bbe`
- Service target: user unit `studio-brain-mission-control.service`
- Restart command used: `XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart studio-brain-mission-control.service`
- Health evidence: `/api/mission-control/health` reported `ok: true` with `codexIngest` counters present and Node CPU no longer pegged.

Future production deploys should still use the guarded Mission Control deploy helper and avoid non-main branch deploys unless the owner explicitly passes the branch override.

## Verification Commands

Use a clean `origin/main` worktree:

```bash
git fetch origin main
git log origin/main --oneline -8
bash -n scripts/ops/*.sh
make ops-backlog
node scripts/ops/post_merge_verification_packet.mjs --json --write
```

Optional read-only smoke commands:

```bash
bash scripts/ops/app_status_review.sh
bash scripts/ops/incident_bundle.sh output/ops/incidents/postmerge-smoke
bash scripts/ops/generate_ops_report.sh output/ops/postmerge-smoke
```

Review generated output before sharing it.

## Local Smoke Results

From the clean `codex/ops-admin-next` worktree:

- `bash -n scripts/ops/*.sh` passed.
- `bash scripts/ops/app_status_review.sh` reached Studio Brain `/healthz`, Studio Brain `/api/status`, and Mission Control `/api/mission-control/health`.
- Studio Brain `/api/status` reported `status: critical`; treat that as an investigation signal, not a script failure.
- Mission Control health was reachable through `http://127.0.0.1:4100` and reported storage, cache, request, and metric fields.
- `bash scripts/ops/generate_ops_report.sh output/ops/postmerge-smoke` completed and wrote ignored local report files under `output/ops/postmerge-smoke`.
- `make` was not available in the local Windows shell, so direct Bash script smoke was used instead.

## Not Performed

- no deploy
- no restart
- no timer installation
- no package upgrade
- no firewall, SSH, sudoers, or user change
- no Docker prune or cleanup
- no database schema, restore, vacuum, reindex, or drop
- no secret rotation

## Current Approval Gates

| Gate | Why approval is needed | Pre-check |
| --- | --- | --- |
| Future Mission Control deploys | changes host files and may restart the user service | use the guarded deploy helper and verify branch/ref metadata |
| idle-worker timer installation | changes systemd runtime behavior | review `11-idle-worker-systemd.md` |
| package update remediation | touches kernel/Docker/system packages and may require reboot | review `08-ubuntu-failed-unit-triage.md` |
| network/SSH/PostgreSQL hardening | can lock out access or break clients | review `09-network-exposure-review.md` |
| cleanup of logs, backups, Docker artifacts, or temp files | destructive or service-impacting | capture incident/capacity evidence first |

## Next Safe Slices

1. Refresh host inventory from current `.226` evidence.
2. Triage the currently open dependency PR stack, starting with #552.
3. Add Mission Control import/display for redacted incident summaries.
4. Prepare an approval packet for idle-worker timer installation.
5. Add a weekly comparison note for portal bridge tunnel restart counts.
