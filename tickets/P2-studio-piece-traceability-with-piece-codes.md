# P2 — Piece-Level Traceability for Reservation Intake

Status: Open
Date: 2026-02-17

## Problem
Intake currently stores a single reservation-level note + optional photo, but not a structured piece list. For studio operations, missing per-piece identity makes storage, pickup disputes, and damage triage harder.

Market competitors and community requests both point toward piece-level workflows (piece labels/tracking IDs and stage visibility) rather than only batch-level comments.

## Scope
- `functions/src/createReservation.ts`
- `web/src/views/ReservationsView.tsx`
- `web/src/lib/normalizers/reservations.ts`
- `docs/SCHEMA_RESERVATIONS.md`
- Optional: `web/src/views/KilnLaunchView.tsx`

## Tasks
1. Add optional `pieces` structure to reservation payload and stored schema:
   - `pieceId` (human-readable),
   - `pieceLabel`,
   - `pieceCount`,
   - `piecePhotoUrl` (optional),
   - `pieceStatus` (`awaiting_placement`, `loaded`, `fired`, `ready`, `picked_up`).
2. Support optional QR-like code generation for each piece or piece group:
   - `MF-RES-...` style deterministic prefix + collision-safe suffix.
3. Add UI flow in `ReservationsView`:
   - repeatable piece rows during check-in,
   - validation for missing piece count mismatch with shelf estimate,
   - optional CSV-style bulk paste for power users.
4. Add staff lookup support:
   - search field by `pieceId`,
   - deep-link into the linked reservation card.
5. Update schema/docs:
   - include lifecycle states,
   - update sample payload and validation notes.
6. Add migration/backfill plan for existing reservations:
   - default synthetic piece code in new field only when piece data is added later.

## Acceptance
- Every reservation with piece-level data persists deterministic codes and per-piece metadata.
- Staff can locate a reservation by piece code.
- Customers can add at least one piece identifier during check-in.
- No existing create-only flow regresses when piece fields are omitted.

## Dependencies
- `tickets/P1-studio-reservation-status-api.md`
- `tickets/P1-studio-notification-sla-journey.md`

