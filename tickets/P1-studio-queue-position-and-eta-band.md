# P1 — Reservation Queue Position and ETA Band Visibility

Status: Completed
Date: 2026-02-17

## Problem
Users cannot easily tell where they are in line or what to expect for their firing window, so they repeatedly check and contact staff.

## Objective
Expose fair, explainable queue placement and ETA windows with clear confidence bands across staff and member UIs.

## Scope
- `web/src/lib/normalizers/reservations.ts`
- `web/src/views/ReservationsView.tsx`
- `web/src/views/KilnLaunchView.tsx`
- `functions/src` (server queue metadata updates)
- `functions/src/createReservation.ts` (metadata defaults)
- `docs/SCHEMA_RESERVATIONS.md`

## Tasks
1. Define queue ranking rules:
   - status priority (active queue -> confirmed -> waitlisted -> canceled)
   - same status ordering by `createdAt`, then reservation metadata signals (no-shows, size, rush/whole kiln flags).
2. Compute and persist a client-safe queue hint:
   - `queuePositionHint`
   - optional estimated ready window (`estimatedWindow.currentStart/currentEnd`) and confidence label (`high|medium|low`).
3. Extend schema/docs to keep these fields explicit and deterministic.
4. Update reservation cards:
   - show queue position band (eg. `3-4 in queue`)
   - show ETA window copy with reason from last transition.
5. Update staff queue view:
   - show why ordering changed (waitlist, load priority, no-show repositioning)
   - support quick filter by ETA impact and queued age.

## Acceptance
- all reservation cards show an ETA band and a queue context field when reservation is in-flight.
- position/eta updates are derived from server-computed fields, not ad-hoc client sorting alone.
- unknown ETA state displays stable copy instead of blank states.
- queue calculations are deterministic across clients.

## Dependencies
- `tickets/P1-studio-reservation-stage-timeline-and-audit.md`
- `tickets/P1-studio-reservation-status-api.md`
- `tickets/P1-studio-reservation-queue-ops-ui.md`

## Completion Evidence (2026-02-23)
- Server-side deterministic queue hints now computed per station in v1 reservation mutation flows:
  - recompute on `reservations.create`, `reservations.update`, and `reservations.assignStation`
  - writes `queuePositionHint` + `estimatedWindow { currentStart, currentEnd, updatedAt, slaState, confidence }`
  - file: `functions/src/apiV1.ts`
- Queue ranking rules are deterministic and include:
  - status priority, rush/whole-kiln priority, no-show penalty, estimated size, createdAt, id tiebreaker
  - file: `functions/src/apiV1.ts`
- Reservation cards now show queue context + ETA/readiness band in client/staff UI:
  - queue position (server hint first, client fallback)
  - readiness/ETA band with confidence where available
  - file: `web/src/views/ReservationsView.tsx`
- Reservation model includes queue hint/ETA fields for UI normalization:
  - file: `web/src/lib/normalizers/reservations.ts`
- Schema docs updated to explicitly include `estimatedWindow.confidence` and queue ranking semantics:
  - file: `docs/SCHEMA_RESERVATIONS.md`
- Validation runs:
  - `npm --prefix functions run build && node --test "functions/lib/apiV1.test.js"` (pass)
  - `npm --prefix web run test:run -- src/views/ReservationsView.test.ts` (pass)
  - `npm --prefix web run build` (pass)
