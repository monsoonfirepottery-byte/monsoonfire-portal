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

## Verification Commands

Use a clean `origin/main` worktree:

```bash
git fetch origin main
git log origin/main --oneline -8
bash -n scripts/ops/*.sh
make ops-backlog
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
| Mission Control final deploy | changes host files and may restart service | use Mission Control deploy packet |
| idle-worker timer installation | changes systemd runtime behavior | review `11-idle-worker-systemd.md` |
| package update remediation | touches kernel/Docker/system packages and may require reboot | review `08-ubuntu-failed-unit-triage.md` |
| network/SSH/PostgreSQL hardening | can lock out access or break clients | review `09-network-exposure-review.md` |
| cleanup of logs, backups, Docker artifacts, or temp files | destructive or service-impacting | capture incident/capacity evidence first |

## Next Safe Slices

1. Run post-merge read-only command smoke from `main`.
2. Refresh host inventory from current `.226` evidence.
3. Add machine-readable ops report summary.
4. Add Mission Control import/display for redacted incident summaries.
5. Prepare approval packets for Mission Control deploy and idle-worker timer install.
