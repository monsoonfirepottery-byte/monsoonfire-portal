# P2 — Destructive Action Controls and Audit Trail

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Platform + Security
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Commands with destructive impact (reset, flush, destructive redeploy) are too easy to run and difficult to trace after incidents.

## Objective

Add explicit confirmations, guardrails, and local audit logging for sensitive actions.

## Scope

- command handlers under `studio-brain/scripts`
- `scripts/reliability-hub.mjs`
- `scripts/cutover-watchdog.mjs`
- operation docs and runbooks

## Tasks

1. Add destructive command classification:
   - read-only
   - restart-only
   - data destructive
2. Add confirmation patterns:
   - `--yes-i-know` for non-interactive mode
   - interactive confirmation with clear impact summary
3. Add role-based-ish gate where possible:
   - operator token/flag requirement
   - maintenance-mode override token
4. Add local immutable audit log entries for each destructive run:
   - who/what/when/why
   - command arguments
   - resulting exit state
5. Add post-action summary and rollback hints in output.

## Acceptance Criteria

1. No destructive flow can run without explicit confirmation in default mode.
2. Audit logs include actionable context and are not removable by normal command flows.
3. Common recovery paths are suggested automatically after a destructive run.

## Dependencies

- `studio-brain/scripts/*.mjs`
- `scripts/cutover-watchdog.mjs`
- `docs/runbooks/EXTERNAL_CUTOVER_EXECUTION.md`

## Definition of Done

- Destructive actions are no longer silent or easily confused with routine operations.
