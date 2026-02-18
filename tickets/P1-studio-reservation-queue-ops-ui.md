# P1 — Reservation Queue & Staff Workflow UI Controls

Status: Open
Date: 2026-02-17

## Problem
The reservation intake form in `ReservationsView` collects enough operational context, but clients only see a static list and staff have no secure inline controls for confirming/waitlisting/cancelling items in the queue. `KilnLaunchView` already models load-status progression, yet reservation status is still treated mostly as presentation-only.

The repo’s own policy schema and docs describe scheduling windows and access windows, so missing queue UX is now a functional gap.

## Scope
- `web/src/views/ReservationsView.tsx`
- `web/src/views/KilnLaunchView.tsx`
- `web/src/api/portalApi.ts`
- `web/src/api/portalContracts.ts`
- `tickets/P1-studio-reservation-status-api.md` (shared API path)

## Tasks
1. Add staff-only reservation status action bar in the user-visible list:
   - `CONFIRM`, `WAITLIST`, `CANCEL` buttons (or dropdown).
   - confirmation modal and undo/cancel window.
2. Replace any direct `updateDoc` status writes with `PortalApi.updateReservation`.
3. Add quick staff notes field tied to status changes.
4. Add queue context columns in both staff and client views:
   - queue position (approximate),
   - estimated readiness band (currently entered latest date + live estimate),
   - occupancy/capacity pressure indicator for selected kiln.
5. Surface richer card state:
   - last status change timestamp,
   - `notesHistory` snippets if available,
   - whether pickup/return add-ons are attached.
6. Add helper filters on list:
   - `WAITLISTED`, `UPCOMING`, `READY`, `STAFF HOLD`.
7. Add a no-data loading/error parity audit:
   - show explicit messaging when staff-only tools are unavailable due to permissions.

## Acceptance
- Staff can advance a reservation through at least `REQUESTED`, `CONFIRMED`, and `WAITLISTED` from UI.
- Client pages show progress context (position + ETA band once available).
- No status mutation is performed through ad-hoc direct Firestore writes in this flow.
- QA can reproduce status transitions and immediate UI refresh without manual page reload.

## Dependencies
- `tickets/P1-studio-reservation-status-api.md`
- `tickets/P1-studio-notification-sla-journey.md`
