# Epic: P1 — Codex Efficiency and Startup Reliability

Status: Active
Date: 2026-03-21
Priority: P1
Owner: Platform
Type: Epic

## Problem
Codex sessions still lose time and tokens to startup ambiguity, cross-platform wrapper drift, and dirty-worktree friction before real implementation work begins.

## Objective
Make Codex startup deterministic, cross-platform script behavior consistent, and implementation sessions clean-by-default without reopening older completed cutover tickets.

## Historical Context
- `tickets/P2-studiobrain-cross-platform-tooling-and-script-replacements.md`
- `tickets/P2-studiobrain-windows-script-elimination-and-shims.md`
- `tickets/P1-release-branch-hygiene.md`

## Tickets
- `tickets/P1-codex-startup-memory-reliability-and-auth-contract.md`
- `tickets/P1-cross-platform-command-runner-and-wrapper-audit.md`
- `tickets/P1-codex-clean-worktree-session-launcher.md`
- `tickets/P2-selective-firestore-rules-runner.md`
- `tickets/P2-codex-planning-council-handoff-shortcut.md`
- `tickets/P3-firestore-rules-log-noise-normalization.md`
- `tickets/P3-codex-session-friction-catchall.md`

## Scope
1. Normalize startup-memory failures into stable reason codes with explicit recovery steps.
2. Move known hot-path wrappers onto a shared cross-platform command runner and audit them.
3. Default Codex implementation sessions into a clean dedicated worktree with explicit opt-out.
4. Pin follow-on medium/low operator-friction items in markdown-first tickets.

## Acceptance Criteria
1. `npm run codex:doctor` reports startup readiness, wrapper audit status, and actionable recovery guidance.
2. `npm run codex:shell` prints clean-worktree status and startup failure reason codes before launch.
3. The known Firebase/emulator hot paths no longer rely on ad hoc `npx`/`npm`/PATH handling.
4. All medium/low follow-ups are linked from this epic and no longer exist only in chat history.
