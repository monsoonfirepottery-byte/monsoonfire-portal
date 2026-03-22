# P1 — Codex clean-worktree session launcher

Status: Active
Date: 2026-03-21
Priority: P1
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-codex-efficiency-and-startup-reliability.md

## Problem
Dirty main worktrees create repeated branch/status/reconciliation overhead for Codex implementation sessions and increase the risk of accidental scope bleed.

## Tasks
1. Add a dedicated clean-worktree launcher for Codex sessions.
2. Make `scripts/codex-shell.mjs` create or reuse that clean worktree by default, with explicit opt-out for the current worktree.
3. Surface repo root, launch cwd, clean-worktree state, and branch-prefix validity before Codex launch.
4. Make the runbook point to the clean-worktree launcher as the canonical mutation-heavy path.

## Acceptance Criteria
1. `npm run codex:shell` defaults to a clean dedicated worktree.
2. `node ./scripts/codex-worktree-launcher.mjs --json` reports launcher state, workspace path, and branch-prefix validity.
3. Users can opt out with `--current-worktree` when they intentionally want the dirty repo.

## Dependencies
- `scripts/codex-shell.mjs`
- `scripts/codex-worktree-launcher.mjs`
- `scripts/lib/codex-worktree-utils.mjs`
- `docs/runbooks/MCP_OPERATIONS.md`
