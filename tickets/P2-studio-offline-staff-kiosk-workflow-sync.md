# P2 — Offline-Resilient Staff Queue Workflow Sync

Status: Completed
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

## Completion Evidence (2026-02-24)
- Offline-safe queue actions implemented in portal Reservations staff tools:
  - status transition updates,
  - station assignment updates,
  - pickup-window staff actions,
  - queue fairness actions.
  - file: `web/src/views/ReservationsView.tsx`
- Local persisted action queue shipped:
  - storage key: `mf_staff_queue_offline_actions_v1`
  - payload includes action type, reservation id, actor uid/role, queue revision, correlation id, and request payload.
  - file: `web/src/views/ReservationsView.tsx`
- Retry + conflict handling added:
  - network/offline failures are queued and retried with jitter,
  - stale/conflict/permission failures are marked `failed` for manual correction,
  - unresolved failures remain visible until corrected/cleared.
  - file: `web/src/views/ReservationsView.tsx`
- Connection-state UX added:
  - online/offline state indicator
  - queue counts (`queued`, `pending`, `failed`)
  - sync controls (`Sync now`, `Clear failed`)
  - user-facing warning/notice messaging during offline mode
  - files: `web/src/views/ReservationsView.tsx`, `web/src/views/ReservationsView.css`
- Server-side reconciliation guards leveraged and documented:
  - station assignment route returns idempotent replay on no-op requests
  - pickup-window and queue-fairness routes include action guards/conflict checks
  - route-level request handling remains deterministic under retries
  - file: `functions/src/apiV1.ts`
- Operational playbook updated with offline fallback procedure and correction workflow:
  - file: `docs/runbooks/STUDIO_RESERVATION_OPERATIONS_PLAYBOOK.md`
