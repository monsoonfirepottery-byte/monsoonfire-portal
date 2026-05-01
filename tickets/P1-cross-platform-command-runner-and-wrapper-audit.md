# P1 — Cross-platform command runner and wrapper audit

Status: Completed
Date: 2026-03-21
Priority: P1
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-codex-efficiency-and-startup-reliability.md

## Problem
Several high-use scripts still duplicate platform-specific command lookup and PATH handling, which recreates Windows/Linux drift and wrapper bugs.

## Tasks
1. Add one shared `scripts/lib` command-runner helper for command resolution, PATH prepending, and Firebase CLI invocation.
2. Migrate these hot paths first:
   - `scripts/test-rules.mjs`
   - `scripts/start-emulators.mjs`
   - `scripts/portal-pr-functional-gate.mjs`
   - `scripts/deploy-firebase-safe.mjs`
3. Add a static audit that fails on unsafe wrapper patterns in the tracked hot paths.
4. Wire the audit into `npm run codex:doctor`.

## Acceptance Criteria
1. The hot-path scripts no longer spawn bare `npx`/`npm` or hard-code PATH delimiters.
2. The wrapper audit passes locally and runs inside Codex doctor.
3. Shared helper logic is the canonical command-resolution path for the tracked surfaces.

## Completion Notes
- Verified `scripts/lib/command-runner.mjs` is the shared command-resolution, PATH-prepend, and Firebase CLI invocation helper used by the tracked hot paths.
- Verified `scripts/audit-cross-platform-wrappers.mjs` scans the hot-path scripts and reports no unsafe bare `npx`/`npm`, hard-coded PATH separator, or `shell: true` wrapper patterns.
- Verified `scripts/codex-doctor.mjs` runs the cross-platform wrapper audit and reports it as `codex-cross-platform-wrapper-audit`.

## Verification
- `node scripts/audit-cross-platform-wrappers.mjs`
- `node ./scripts/codex-doctor.mjs --json`
- `node --test scripts/lib/command-runner.test.mjs scripts/audit-cross-platform-wrappers.test.mjs scripts/codex-doctor.test.mjs`

## Dependencies
- `scripts/lib/command-runner.mjs`
- `scripts/audit-cross-platform-wrappers.mjs`
- `scripts/codex-doctor.mjs`
