# Ops Swarm Wave 1 Slice 02 Operating Contract

Captured: 2026-05-06

Purpose: keep multiple workers productive in the same repo without clobbering each other or crossing host-mutation boundaries.

## Roles

| Worker | Lane | Owns | Must not touch |
| --- | --- | --- | --- |
| Worker A | Docs/backlog | `docs/ops/**` planning docs, issue-ready backlog, roadmap, ops index updates | scripts, Makefile, package files, Mission Control source, host files |
| Worker B | Evidence/read-only probes | generated evidence packets, read-only command output, current host facts | docs owned by Worker A unless coordinating, any mutating host action |
| Worker C | Script hardening | read-only ops script fixes and tests | docs roadmap/backlog ownership unless requested, host mutation |
| Worker D | Mission Control admin | Mission Control UI/admin cards in `D:\kanban` | portal ops docs except links to shipped evidence |
| Human owner | Approval authority | service windows, destructive cleanup, privileged host changes, deploy approvals | none |

## Write Ownership

- Worker A owns Markdown-only planning files under `docs/ops/` for slices 1-3 and 48-49.
- Every worker checks `git status --short --branch` before edits and before handoff.
- Do not revert, reformat, or "clean up" files outside the worker's lane.
- If a needed file is already modified by another worker, stop and coordinate rather than overwriting it.
- Generated evidence belongs under existing ignored output locations unless a worker is explicitly asked to promote a redacted packet into docs.

## Branch Naming

Use short, slice-scoped branches:

| Slice family | Branch pattern | Example |
| --- | --- | --- |
| Docs/backlog | `codex/ops-swarm-wave1-docs-sXX` | `codex/ops-swarm-wave1-docs-s48` |
| Read-only evidence | `codex/ops-swarm-wave1-evidence-sXX` | `codex/ops-swarm-wave1-evidence-s22` |
| Script hardening | `codex/ops-swarm-wave1-scripts-sXX` | `codex/ops-swarm-wave1-scripts-s31` |
| Mission Control | `codex/admin-swarm-wave1-sXX` | `codex/admin-swarm-wave1-s50` |
| Cleanup after merge | `codex/ops-swarm-wave1-cleanup-sXX` | `codex/ops-swarm-wave1-cleanup-s60` |

Branch names should include the slice number when known. If a branch collects multiple small doc-only slices, use the lowest slice number and mention all covered slices in the PR body.

## Safety Gates

These actions require explicit human approval in the current thread before execution:

- service restarts, deploys, systemd timer installation, or reconcile actions
- package upgrades, kernel updates, or reboot
- firewall, SSH, sudoers, user, or credential changes
- Docker prune, volume deletion, container removal, image pull, or tag pin rollout
- database schema changes, production restore, vacuum full, reindex, delete, or manual data mutation
- deleting, moving, compressing, truncating, or archiving logs, backups, imports, temp files, or generated artifacts
- secret rotation or token inspection that would expose raw values

Read-only checks may proceed when they avoid env dumps, secret material, and content-heavy imports.

## Verification Packets

Every swarm PR should include a verification packet with:

- slice numbers covered
- files changed
- commands run, including local limitations such as missing `make`
- host actions not performed
- approval gates opened or closed
- rollback notes for any shipped repo change
- follow-up issue entries when approval is still needed

Markdown-only Worker A packets should run at minimum:

```bash
git diff --check
```

When available, also run a link sanity check that verifies relative `docs/ops/*.md` references resolve.

## Handoff Rules

- End with current branch, dirty state, changed files, slice numbers, and verification commands.
- If blocked, name the exact blocker and the smallest next action.
- If memory or live host evidence was unavailable, say so explicitly.
- Do not mark an approval gate complete because a doc exists; gates close only after approved execution and verification.
