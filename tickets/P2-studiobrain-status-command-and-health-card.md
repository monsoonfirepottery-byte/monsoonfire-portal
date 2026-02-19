# P2 — `studiobrain status` Command and Health Card

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Operations teams must run multiple commands to understand system state, creating fragmentation and inconsistent diagnostics.

## Objective

Add a unified status command that prints one-line and expanded health summaries for local/studiobrain readiness.

## Scope

- `scripts/studiobrain-status.mjs` (new)
- `package.json` scripts (or workspace aggregate script)
- `studio-brain/src/cli/status.ts` (optional)
- `studio-brain/scripts/preflight.mjs`

## Tasks

1. Add `npm run studio:status` command with output:
   - selected profile
   - service ready state
   - emulator/state contract version
   - smoke gate state
2. Add optional JSON output mode for automation: `npm run studio:status -- --json`.
3. Include dependencies in status:
   - database/redis/minio dependency health
   - latest heartbeat/smoke timestamp
   - backup snapshot freshness indicators
4. Add startup guard:
   - if status shows critical drift, prevent destructive or high-risk commands by default.
5. Add command alias for automation: `npm run studio:check`.

## Acceptance Criteria

1. Command runs in under 5 seconds for clean local stack.
2. Operators can answer “is this safe to continue?” from one command.
3. JSON mode is parseable by CI/local automation hooks.
4. Critical drift is explicit in output with remediation links.

## Dependencies

- `studio-brain/scripts/preflight.mjs`
- `studio-brain/src/connectivity/healthcheck.ts`
- `scripts/reliability-hub.mjs`

## Definition of Done

- Status is stable across Linux/macOS and usable as the first command for onboarding.
- Operators can answer “is this safe to continue?” from one command.
- JSON mode is parseable by CI/local automation hooks.
- Critical drift is explicit in output with remediation links.

## Completion notes

- Implemented status safety gate mechanics for risky/high-risk operations.
- Added `--require-safe` to `scripts/studiobrain-status.mjs`; the command now exits non-zero when status is not `pass` and `safeToRunHighRisk` is false.
- Added `npm run studio:check:safe` script (`node ./scripts/studiobrain-status.mjs --require-safe`).
- Updated required gate flows to consume the safe status check:
  - `scripts/pr-gate.mjs` uses `npm run studio:check:safe -- --json`
  - `scripts/studio-cutover-gate.mjs` uses `npm run studio:check:safe`
- Updated PR and emulator runbooks to call safe status checks for cutover and high-risk flows.
