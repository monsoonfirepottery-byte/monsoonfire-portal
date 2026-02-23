# P1 — Studio Reservation Status & Lifecycle API

Status: Completed
Date: 2026-02-17

## Problem
`portalContracts` already declares `UpdateReservationRequest/Response`, but there is no production endpoint in functions or API client for status transitions. Users can create reservations, yet staff cannot use a secure, versioned path to move records through workflow states.

Current implementation details:
- `createReservation` is exported and implemented (`functions/src/createReservation.ts`, `functions/src/index.ts`).
- `ReservationsView` reads reservations directly from Firestore and only calls `createReservation` (`web/src/views/ReservationsView.tsx`).
- Security rules allow staff updates on a limited keyset for `reservations/*`, but no documented server-side mutation contract exists (`firestore.rules`, `web/src/api/portalContracts.ts`).
- `KilnLaunchView` currently writes `loadStatus` directly to Firestore (`web/src/views/KilnLaunchView.tsx`), bypassing a server transition path.
- `functions/src/assignReservationStation.ts` exists and includes capacity checks, but is not exported from `functions/src/index.ts` and still reads actor metadata from `req.body.__actorUid` instead of authenticated context.
- `functions/src/index.ts` and `functions/src/apiV1.ts` do not expose any `updateReservation` or station-assignment route.

## Scope
- `functions/src/createReservation.ts`
- `functions/src/index.ts`
- `web/src/api/portalContracts.ts`
- `web/src/api/portalApi.ts`
- `web/src/api/functionsClient.ts` (if needed for tracing)
- `firestore.rules` (status-state constraints if introduced)
- `functions/src/notifications.ts` (for status-driven notifications in later tickets)

## Tasks
1. Add `functions/src/updateReservation.ts` with:
   - request validation for `reservationId` and status enum (`REQUESTED`, `CONFIRMED`, `WAITLISTED`, `CANCELLED`).
   - staff/admin authorization checks.
   - transition guard (forbid impossible transitions unless explicitly forced).
   - atomic update of `status`, `updatedAt`, and optional `staffNotes`.
2. Export and wire the endpoint in `functions/src/index.ts`.
3. Add `assignReservationStation` route export and wire-through in v1 + legacy API surfaces.
4. Extend `functions/src/assignReservationStation.ts`:
   - get actor UID from authenticated request metadata,
   - fix required resource comparison and capacity guard edge-cases,
   - ensure transition event append/audit metadata is preserved.
5. Extend `web/src/api/portalContracts.ts` to explicitly tie request/response shapes to these APIs.
6. Add `updateReservation` and station-assignment methods to `PortalApi` in `web/src/api/portalApi.ts`.
7. Replace direct status write path in `web/src/views/KilnLaunchView.tsx` with server transition API calls.
8. Add explicit tests:
   - valid transition,
   - invalid transition,
   - unauthorized caller,
   - missing document.
9. Add minimal audit payload for each state transition:
   - actor uid, role, reservationId, fromStatus, toStatus, timestamp.

## Acceptance
- Staff can call `updateReservation` and transition reservation state with response `{ ok: true, reservationId, status }`.
- Invalid transitions return a structured error with a stable code.
- The same transition cannot write forbidden keys (`firingType`, `shelfEquivalent`, etc.) through this endpoint.
- Firestore updates for reservation status changes are now available through a single API path and do not depend on direct client writes.

## Dependencies
- `tickets/P1-studio-reservation-queue-ops-ui.md` (UI controls depend on this endpoint).
- `tickets/P1-studio-notification-sla-journey.md` (notifications depend on reliable state transitions).
- `tickets/P1-studio-reservation-stage-timeline-and-audit.md` (timeline/audit acceptance for status transitions).

## Completion Evidence (2026-02-23)
- Server routes are wired for both route families in `functions/src/index.ts` via legacy compatibility handlers:
  - `updateReservation` -> `/v1/reservations.update`
  - `assignReservationStation` -> `/v1/reservations.assignStation`
- Reservation transition contracts and API client methods are in place:
  - `web/src/api/portalContracts.ts` (`UpdateReservationRequest/Response`, station assignment contracts)
  - `web/src/api/portalApi.ts` (`updateReservation`, `assignReservationStation`)
- `KilnLaunchView` now uses server transition API for load-status changes (no direct Firestore status mutation path in this view):
  - `web/src/views/KilnLaunchView.tsx`
- Coverage now includes all required updateReservation cases:
  - valid transition
  - invalid transition
  - unauthorized caller
  - missing document
  - file: `functions/src/apiV1.test.ts`
- Validation run:
  - `npm --prefix functions run build && node --test "functions/lib/apiV1.test.js"` (pass)
