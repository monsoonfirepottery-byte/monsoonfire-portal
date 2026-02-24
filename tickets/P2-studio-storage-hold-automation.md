# P2 — Reservation Storage Hold Automation

Status: Completed
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

## Completion Evidence (2026-02-23)
- Storage policy metadata is now persisted and maintained on reservation documents:
  - `readyForPickupAt`
  - `pickupReminderCount`
  - `lastReminderAt`
  - `pickupReminderFailureCount`
  - `lastReminderFailureAt`
  - `storageStatus`
  - `storageNoticeHistory`
  - files: `functions/src/apiV1.ts`, `functions/src/createReservation.ts`, `functions/src/notifications.ts`
- Scheduled hold evaluator implemented:
  - `evaluateReservationStorageHolds` runs hourly and advances reminder/escalation states (`active`, `reminder_pending`, `hold_pending`, `stored_by_policy`)
  - queues pickup reminder jobs at policy thresholds and records audit rows
  - files: `functions/src/notifications.ts`, `functions/src/index.ts`
- Staff triage list/filter and card visibility shipped in portal:
  - new `Storage risk` filter
  - triage summary strip (entering hold, stored by policy, reminder failures, approaching cap)
  - storage status chips + warning affordances + notice history timeline
  - files: `web/src/views/ReservationsView.tsx`, `web/src/views/ReservationsView.css`, `web/src/lib/normalizers/reservations.ts`
- Escalation and reminder events are audit-visible:
  - `reservationStorageAudit` records policy transitions, reminders, and reminder failures
  - file: `functions/src/notifications.ts`
- Policy/docs aligned with runtime behavior:
  - files: `docs/policies/storage-abandoned-work.md`, `docs/SCHEMA_RESERVATIONS.md`, `docs/EMAIL_NOTIFICATIONS.md`
- Validation runs:
  - `npm --prefix functions run build`
  - `node --test "functions/lib/apiV1.test.js"`
  - `npm --prefix web run build`
  - `npm --prefix web run test:run -- src/views/ReservationsView.test.ts`
