# P2 — Arrival Check-In and QR Intake for Studio Reservations

Status: Completed
Date: 2026-02-17

## Problem
Staff frequently mediate all arrival and piece intake steps, while users still rely on manual confirmation behavior. Competitor signals indicate QR/intake-style automation is expected in studio operations.

## Objective
Enable members to perform first-step check-in with a reservation-specific code, while preserving staff ownership of final operational transitions.

## Scope
- Member-facing reservation detail UI (or lightweight check-in surface)
- Reservation payload/read model updates
- Optional QR label generation for intake artifacts
- Notification and queue policy surfaces

## Tasks
1. Add member-facing check-in entry for confirmed reservations:
   - confirm arrival window
   - optional photo/doc upload for initial condition evidence
   - optional note entry
2. Generate deterministic, human-readable QR/short-code token at reservation confirmation for intake and station lookup.
3. Add staff scan/lookup path:
   - locate reservation by QR/token
   - display outstanding requirements and queue position
4. Map check-in event into timeline and queue logic:
   - arrival timestamp and delay penalties
   - no-show escalation window starts from check-in miss.
5. Document abuse controls:
   - short code expiry,
   - regeneration rules,
   - manual override policy for missed/invalid codes.
6. Add regression examples for both member-initiated and staff-assisted check-in flows.

## Acceptance
- At least one non-admin path exists for member-initiated arrival check-in.
- QR/token can be used for reliable reservation lookup in staff queue workflows.
- Check-in state flows into the existing reservation timeline and notifications.
- Clear reissue/revocation rules protect against stale or shared tokens.

## Dependencies
- `tickets/P1-studio-reservation-stage-timeline-and-audit.md`
- `tickets/P1-studio-notification-sla-journey.md`
- `tickets/P1-studio-reservation-status-api.md`

## Evidence
- Added reservation arrival token lifecycle endpoints in `functions/src/apiV1.ts`:
  - `/v1/reservations.checkIn`
  - `/v1/reservations.lookupArrival`
  - `/v1/reservations.rotateArrivalToken`
- Confirmation now issues deterministic, human-readable arrival tokens with expiry:
  - via `/v1/reservations.update` token issuance on transition to `CONFIRMED`
- Added queue-priority penalty for missed expected arrival windows:
  - `reservationQueuePriority` in `functions/src/apiV1.ts`
- Portal UI now includes:
  - member self-service arrival action (`I'm here`) in `web/src/views/ReservationsView.tsx`
  - staff arrival-code lookup panel + outstanding requirement summary in `web/src/views/ReservationsView.tsx`
  - staff token reissue action in reservation card tools
- Reservation model normalization now includes arrival fields in:
  - `web/src/lib/normalizers/reservations.ts`
- Added/updated regression coverage:
  - `functions/src/apiV1.test.ts`
  - `web/src/views/ReservationsView.test.ts`
