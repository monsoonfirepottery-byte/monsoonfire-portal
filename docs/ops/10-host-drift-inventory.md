# Studio Brain Live Host Drift Inventory

Snapshot: 2026-05-06 01:16 UTC, captured read-only with `scripts/ops/host_drift_inventory.sh` over SSH alias `studiobrain`.

This note is evidence and cleanup planning only. It does not approve `git reset`, `git clean`, branch changes, stashing, file deletion, or live host edits.

## Summary

The live host checkout at `/home/wuff/monsoonfire-portal` is not a clean deploy source:

- Current branch: `codex/next-fix-20260312`.
- Upstream: `origin/codex/next-fix-20260312 [gone]`.
- Current commit: `5cc3fb8e chore(web): rebaseline reservation chunk budgets`.
- Dirty/untracked paths: 512 total.
  - 211 modified tracked paths.
  - 301 untracked paths.
- Classification from path names:
  - 486 `source_or_config`
  - 10 `sensitive_path_name`
  - 16 `unknown`
- Large local directories:
  - `tmp`: 3.6M
  - `output`: 294M
  - `node_modules`: 618M

This is substantial source-control drift, not just generated runtime noise. Treat the host checkout as a live forensic artifact until it is backed up and reconciled.

## Representative Drift Areas

Modified tracked paths include:

- root scripts and package metadata
- `config/studiobrain/systemd/studio-brain-healthcheck.sh`
- Studio Brain environment schema/example/integrity files
- Studio Brain Docker Compose and Caddy/OTel config
- Studio Brain docs and migrations through `017_memory_recent_query_acceleration.sql`
- Studio Brain runtime source under `studio-brain/lib` and `studio-brain/src`
- website deploy/serve scripts

Untracked paths include:

- `.governance/planning/`
- `config/studiobrain/ansible/`
- `config/studiobrain/discord/`
- `config/studiobrain/monitoring/`
- many `config/studiobrain/systemd/*` service/timer files
- Studio Brain control tower, ops, partner, planning, support, wiki, and agent runtime source folders
- additional Studio Brain migrations beyond the tracked baseline

The report classifies path names only. It does not read file contents and does not prove whether any path is safe to delete.

## Risk

Likely impacts:

- Deploys can accidentally package host-only code.
- Rollbacks are hard because the live host branch no longer maps cleanly to an upstream branch.
- Reconciliation can lose work if the dirty tree is reset before a backup branch or patch bundle exists.
- Sensitive-looking paths need security-aware handling even when they are examples or schema files, because contents were not inspected in this slice.

## Safe Next Step

1. Capture a backup branch on the host before cleanup:
   - `git -C /home/wuff/monsoonfire-portal branch backup/live-drift-20260506`
2. Capture a restricted patch bundle:
   - `install -d -m 700 /home/wuff/ops-evidence`
   - `git -C /home/wuff/monsoonfire-portal diff > /home/wuff/ops-evidence/live-drift-20260506.patch`
3. Capture untracked path manifest without contents:
   - `git -C /home/wuff/monsoonfire-portal status --porcelain=v1 --untracked-files=all > /home/wuff/ops-evidence/live-drift-20260506.status`
4. Review diffs by area:
   - systemd and host ops config
   - Studio Brain Docker/config
   - Studio Brain migrations and source
   - scripts and deployment tooling
   - website deploy scripts
5. Convert accepted source changes into small PRs.
6. Only after accepted work is preserved, plan generated-artifact cleanup.

## Cleanup Classification

| Candidate | Classification | Rationale | Approval |
| --- | --- | --- | --- |
| Modified source/config/docs | requires human approval | 211 tracked modifications may include live fixes | inspect diff and preserve backup first |
| Untracked source/config/docs | requires human approval | 301 untracked paths include systemd, monitoring, migrations, and runtime source | classify and PR accepted work |
| Sensitive path names | do not touch automatically | path names suggest env/auth/credential-adjacent files | security-aware review only |
| `output` directory | safe with backup | likely generated evidence, but may contain backup/ops proof | review manifest before deleting |
| `node_modules` | safe with backup/service window | reinstallable dependency cache, but live scripts may rely on it | delete only in a planned cleanup |
| Gone upstream branch | requires human approval | reset/rebase can discard unreviewed host-only work | backup branch/patch first |

## Rollback Notes

- Documentation and script changes in this PR are reversible through Git.
- No host cleanup has been performed.
- If future cleanup is approved and goes wrong, restore from the backup branch or patch bundle before restarting services.

## PR Boundary

This slice adds drift inventory tooling and documents current evidence. It intentionally does not reconcile, delete, reset, stash, or move any live host files.

## Systemd Drift Follow-Up

Use `scripts/ops/systemd_drift_review.sh` or `make ops-systemd-drift` for the narrower host-unit check added after the idle-worker drop-in reconciliation. It compares tracked files under `config/studiobrain/systemd/` with installed paths on the host by normalized text checksum only:

- `.service`, `.timer`, and drop-in `.conf` files map to `/etc/systemd/system/...`.
- tracked `.sh` helper scripts map to `/usr/local/bin/...`.
- CRLF/LF line-ending differences are normalized so Windows checkout metadata does not create false drift.
- output classifies `matched`, `drift`, `missing_remote`, `unreadable_remote`, and `untracked_remote` candidates.
- strict mode exits non-zero on drift, but default mode is report-only.

This is still evidence only. It does not run `systemctl daemon-reload`, restart timers, install files, remove stale files, or decide whether the repo or host copy should win.

Read-only live check on 2026-05-06 after normalizing line endings:

- 23 tracked unit/script/drop-in files matched the installed host copies.
- 0 tracked files showed content drift.
- 0 tracked files were missing or unreadable.
- 2 installed unit files were untracked by `config/studiobrain/systemd/`:
  - `/etc/systemd/system/studio-brain-control-tower-proxy.service`
  - `/etc/systemd/system/studio-brain-namecheap-tunnel.service`

Safe next step: capture those two untracked unit definitions into a follow-up source-control PR or explicitly classify them as host-local exceptions. Do not overwrite or remove either service from this report alone.
