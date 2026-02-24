# P2 — Pickup Window Booking, Notifications, and Storage Escalation

Status: Completed
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

## Completion Evidence (2026-02-23)
- Pickup-window state model and constraints shipped in API v1:
  - action route: `POST /apiV1/v1/reservations.pickupWindow`
  - supported statuses: `open`, `confirmed`, `missed`, `expired`, `completed`
  - actions enforce role boundaries and transition guards:
    - `staff_set_open_window`
    - `member_confirm_window`
    - `member_request_reschedule` (one-request cap unless `force`)
    - `staff_mark_missed`
    - `staff_mark_completed`
  - files: `functions/src/apiV1.ts`, `web/src/api/portalContracts.ts`, `web/src/api/portalApi.ts`
- Maker-facing confirmation/reschedule flow added to portal reservation cards:
  - member can confirm open windows
  - member can request one reschedule window
  - staff can open windows and mark missed/completed
  - files: `web/src/views/ReservationsView.tsx`, `web/src/views/ReservationsView.css`, `web/src/lib/normalizers/reservations.ts`
- Reminder cadence by state implemented:
  - immediate reminder when pickup window opens
  - scheduled reminder ~24h before confirmed window end
  - missed-window escalation reminder when window elapses
  - file: `functions/src/notifications.ts`
- Storage escalation from repeated misses is automatic:
  - scheduler auto-marks elapsed open/confirmed windows as `missed`
  - first miss -> `hold_pending`
  - repeated miss -> `stored_by_policy`
  - writes `storageNoticeHistory` + `reservationStorageAudit` events
  - file: `functions/src/notifications.ts`
- Schema + policy docs updated:
  - file: `docs/SCHEMA_RESERVATIONS.md`
  - file: `docs/policies/firing-scheduling.md`
  - file: `docs/policies/storage-abandoned-work.md`
- Validation runs:
  - `npm --prefix functions run build`
  - `node --test "functions/lib/apiV1.test.js"`
  - `npm --prefix web run build`
  - `npm --prefix web run test:run -- src/views/ReservationsView.test.ts`
