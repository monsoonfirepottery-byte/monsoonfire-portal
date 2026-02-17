# P2 — Offline-Resilient Staff Queue Workflow Sync

Status: Open
Date: 2026-02-17

## Problem
Operational updates in kiln-studio environments often happen on shared phones/tablets with spotty connectivity. Current queue actions are not documented as offline-safe, creating missed clicks and rework when network quality degrades.

## Objective
Introduce an offline-capable workflow for staff queue operations so status changes and notes can be captured offline and synchronized automatically when connectivity returns.

## Scope
- Staff queue surfaces in `web/src/views/KilnLaunchView.tsx` and related queue controls
- Queue write path in `functions/src` and API contract layer
- Firestore write strategy for idempotent reconciliation
- Local persistence strategy in web client (if needed; e.g. IndexedDB/local cache)

## Tasks
1. Inventory staff actions currently used in queue operations and classify which must be sync-safe.
2. Add local action queue with minimal persisted payload:
   - action type
   - reservation id
   - actor identity
   - request payload + monotonic revision hint
   - client-side correlation id
3. Implement retry policy with jitter and conflict resolution:
   - idempotent replay
   - stale action rejection messaging
   - visibility of unresolved conflicts to staff
4. Add connection state UX:
   - offline queue length
   - sync status (`pending` / `synced` / `failed`)
   - user warning when edits are not yet persisted.
5. Add server reconciliation guards for duplicate/out-of-order offline actions to prevent duplicate transitions.
6. Document operational playbook for fallback mode when offline backlog grows too large.

## Acceptance
- Staff can execute queue status transitions while offline and retain them in local queue.
- Offline actions sync automatically once network recovers and do not apply twice.
- Staff sees clear sync-state indicators and has guidance when actions require manual correction.
- Failed sync cases are explicitly surfaced and recoverable.

## Dependencies
- `tickets/P1-studio-reservation-status-api.md`
- `tickets/P1-studio-reservation-stage-timeline-and-audit.md`

