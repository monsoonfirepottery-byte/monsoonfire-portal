# P2 — Pickup Window Booking, Notifications, and Storage Escalation

Status: Open
Date: 2026-02-17

## Problem
Pickup coordination is manual; there is no consistent way for makers to pick a pickup window from staff capacity visibility.

## Objective
Add maker-facing pickup slot choices and automatic storage escalation logic from pickup window expiration.

## Scope
- `functions/src`
- `web/src/api/portalContracts.ts`
- `web/src/views/ReservationsView.tsx`
- `docs/policies/storage-abandoned-work.md`
- `docs/policies/firing-scheduling.md`

## Tasks
1. Add `pickupWindow` states and booking constraints:
   - `open|confirmed|missed|expired|completed`
   - enforce user choices from staff-provided windows.
2. Add maker-driven confirmation flow:
   - confirm chosen slot once staff marks availability
   - allow one reschedule request window before status lock.
3. Add reminder cadence by state:
   - reminder at first open, before expiry, and missed-window escalation.
4. Update storage hold policy:
   - explicit transition to `stored_by_policy` when repeated misses occur.
   - emit notification + audit event for each escalation.

## Acceptance
- users can see available pickup windows and confirm or request alternatives.
- repeated misses escalate automatically to storage policy without staff-only manual edits.
- notifications fire according to policy for each escalation step.
- storage states are queryable from reservation cards and staff queue.

## Dependencies
- `tickets/P1-studio-reservation-stage-timeline-and-audit.md`
- `tickets/P2-studio-storage-hold-automation.md`
