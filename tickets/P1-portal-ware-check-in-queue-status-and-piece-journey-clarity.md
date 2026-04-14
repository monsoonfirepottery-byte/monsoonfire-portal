# P1 — Portal Ware Check-in, queue status, and piece journey clarity

Status: Active
Date: 2026-04-14
Priority: P1
Owner: Portal + Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-21-live-surface-trust-and-service-operating-system.md

## Problem

`WareCheckInView` currently reuses `ReservationsView`, and member-facing status communication still relies too heavily on internal or text-heavy reservation language.

That leaves too much ambiguity around intake, queue progression, and what the studio is doing with a user’s work.

## Tasks

1. Give Ware Check-in a dedicated shell, heading structure, and “what happens next” framing even if some underlying form logic stays shared initially.
2. Clarify the difference between intake, booking, queue position, firing progress, cooldown, and pickup readiness in member-facing language.
3. Improve piece/status views so they show a visible stage timeline, the latest meaningful update, and the next expected step.
4. Keep existing reservation and audit-trail data contracts intact while improving the member-facing presentation layer.

## Acceptance Criteria

1. Ware Check-in reads as intake, not generic reservation management.
2. Member-facing status surfaces explain current stage and next step with minimal ambiguity.
3. Existing timeline/audit data is surfaced in a calmer, clearer format.

## Dependencies

- `web/src/views/WareCheckInView.tsx`
- `web/src/views/ReservationsView.tsx`
- `web/src/views/MyPiecesView.tsx`
- `web/src/api/portalContracts.ts`
- `web/src/lib/normalizers/reservations.ts`
