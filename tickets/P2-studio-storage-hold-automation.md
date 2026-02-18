# P2 — Reservation Storage Hold Automation

Status: Open
Date: 2026-02-17

## Problem
`docs/policies/storage-abandoned-work.md` defines storage hold expectations, but the operational flow does not currently enforce pickup reminders, hold states, and escalation steps against active reservation records.

Without hold logic, retention becomes manual and hard to audit, especially when users are on waiting lists or delay pickup.

## Scope
- `functions/src/createReservation.ts` or dedicated reservation job handler
- `firestore.rules` (new hold/retry counters)
- `functions/src/notifications.ts` / notification scheduler job
- `web/src/views/ReservationsView.tsx`
- `docs/policies/storage-abandoned-work.md`

## Tasks
1. Add storage policy metadata fields in reservation documents:
   - `readyForPickupAt`,
   - `pickupReminderCount`,
   - `lastReminderAt`,
   - `storageStatus` (`active`, `reminder_pending`, `hold_pending`, `stored_by_policy`).
2. Add scheduled task that evaluates stale ready items:
   - computes age since `readyForPickupAt`,
   - sends reminder 1, 2, and 3 according to policy.
3. Add staff triage list/filter:
   - items entering hold,
   - items with repeated notice failures,
   - pickup windows approaching policy cap.
4. Add explicit UI affordance in reservation cards:
   - status chip showing storage disposition,
   - date-by-date notice history.
5. Add audit log events for escalation transitions and notices (for review and defensibility).

## Acceptance
- Items that age past policy thresholds trigger reminders without manual intervention.
- Staff can see and act on storage-risk items from one queue.
- Storage transitions are recorded and queryable (`storageStatus` + timestamp).
- Repeated failed reminders are visible and do not fail silently.

## Dependencies
- `tickets/P1-studio-notification-sla-journey.md`
- `tickets/P1-studio-reservation-status-api.md`
