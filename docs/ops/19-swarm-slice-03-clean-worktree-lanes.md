# Ops Swarm Wave 1 Slice 03 Clean Worktree Lane Setup

Captured: 2026-05-06

Purpose: let swarm workers move independently while preserving the dirty primary checkout and avoiding accidental host or Mission Control edits from the wrong lane.

## Lane Principles

- Start every slice from a clean `origin/main` worktree unless the slice explicitly depends on an existing branch.
- Keep the primary checkout untouched when it contains unrelated local changes.
- Prefer one worktree per worker lane and one branch per reviewable slice group.
- Never use `git reset --hard` or checkout over another worker's changes to make a lane clean.
- Do not run portal repo edits from `D:\sb`; use the requested portal worktree.

## Recommended Lanes

| Lane | Path | Branch | Owner | Purpose |
| --- | --- | --- | --- | --- |
| Docs/backlog | `D:\monsoonfire-portal-ops-swarm-wave1` | `codex/ops-swarm-wave1` | Worker A | slices 1-3 and 48-49 Markdown-only packet |
| Evidence | `D:\monsoonfire-portal-ops-swarm-wave1-evidence` | `codex/ops-swarm-wave1-evidence` | Worker B | read-only evidence refreshes and redacted generated packets |
| Script hardening | `D:\monsoonfire-portal-ops-swarm-wave1-scripts` | `codex/ops-swarm-wave1-scripts` | Worker C | focused read-only ops script fixes |
| Mission Control | `D:\kanban` or a clean `D:\kanban-ops-swarm-wave1` worktree | `codex/admin-swarm-wave1` | Worker D | admin cards and Mission Control verification |

## Setup Commands

From a neutral directory, after checking the target path does not already exist:

```bash
git -C D:\monsoonfire-portal fetch origin main
git -C D:\monsoonfire-portal worktree add -b codex/ops-swarm-wave1-evidence D:\monsoonfire-portal-ops-swarm-wave1-evidence origin/main
git -C D:\monsoonfire-portal worktree add -b codex/ops-swarm-wave1-scripts D:\monsoonfire-portal-ops-swarm-wave1-scripts origin/main
```

For Mission Control:

```bash
git -C D:\kanban fetch origin main
git -C D:\kanban worktree add -b codex/admin-swarm-wave1 D:\kanban-ops-swarm-wave1 origin/main
```

If Git reports that a branch is already attached to a worktree, inspect first:

```bash
git -C D:\monsoonfire-portal worktree list --porcelain
git -C D:\kanban worktree list --porcelain
```

Then either reuse the attached worktree or create a uniquely named branch. Do not force-detach another worker's branch.

## Preflight Checklist

Run before each slice:

```bash
git status --short --branch
git log --oneline -5
```

Confirm:

- branch name matches the slice lane
- worktree is clean or only contains your own edits
- `origin/main` is the base unless a prior slice branch is intentionally stacked
- no files outside your ownership lane are modified

## Merge And Cleanup

- PR bodies should list slice numbers, changed files, verification, and untouched approval gates.
- Merge from the clean lane only after review or explicit owner direction.
- After merge, remove only the branch/worktree you own.
- Preserve backup branches when a lane accidentally contains older unrelated work.

## Worker A Boundary

For this docs/backlog slice, allowed edits are:

- `docs/ops/17-swarm-slice-01-baseline-handoff.md`
- `docs/ops/18-swarm-slice-02-operating-contract.md`
- `docs/ops/19-swarm-slice-03-clean-worktree-lanes.md`
- `docs/ops/20-swarm-slice-48-approval-backlog.md`
- `docs/ops/21-swarm-slice-49-roadmap-30-60-90.md`
- `docs/ops/README.md`

Do not edit scripts, Makefile, package files, app source, systemd files, or Mission Control files from this lane.
