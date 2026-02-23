# P1 — Reservation Stage Timeline and Audit Trail

Status: Completed
Date: 2026-02-17

## Problem
Staff currently have status controls but no complete, guarded lifecycle engine for reservation changes. Clients need clear, explainable stage history, especially as work moves from queue -> loaded -> ready for pickup.

## Objective
Create a secure, auditable reservation timeline surface that tracks every lifecycle transition and gives clients context on why things are moving or delayed.

## Scope
- `functions/src`
- `web/src/api/portalContracts.ts`
- `web/src/api/portalApi.ts`
- `web/src/views/ReservationsView.tsx`
- `web/src/views/KilnLaunchView.tsx`
- `web/src/lib/normalizers/reservations.ts`
- `docs/SCHEMA_RESERVATIONS.md`

## Tasks
1. Add a state-transition map and schema validation in `updateReservation` execution:
   - allowed states: `REQUESTED`, `CONFIRMED`, `WAITLISTED`, `CANCELLED`, plus loading stage transitions in `loadStatus`
   - reject invalid or missing actor transitions.
2. Write an auditable transition record on every transition:
   - actor uid, actor role, from/to status, from/to stage, reason, optional staff notes, and timestamp.
3. Keep `stageStatus`/`stageHistory` aligned with any status mutation:
   - status-only changes update `updatedAt`, `stageStatus`, and append to `stageHistory` with machine-generated actor metadata.
4. Extend portal API surface:
   - add `PortalApi.updateReservation` typed method and runtime response typing
   - wire errors to stable codes for `INVALID_ARGUMENT`, `FORBIDDEN`, `NOT_FOUND`.
5. Update `ReservationsView` and staff flow to call `PortalApi.updateReservation` instead of direct writes where possible, including load state transitions in `KilnLaunchView` that should be represented in the same audit trail.
6. Expand docs:
   - `docs/SCHEMA_RESERVATIONS.md`: add transition contract and timeline semantics
   - `tickets/P1-studio-reservation-status-api.md`: link acceptance to this ticket.

## Acceptance
- invalid transitions are blocked with stable error codes and no unauthorized field writes.
- each accepted transition writes one timeline event in `stageHistory` and updates `stageStatus` consistently.
- staff UI actions produce visible client-facing status text + last change time.
- `PortalApi.updateReservation` exists and is used by reservation UI actions.

## Dependencies
- `tickets/P1-studio-reservation-status-api.md`
- `tickets/P1-studio-reservation-queue-ops-ui.md`

## Completion Evidence (2026-02-23)
- Transition guard + schema validation are implemented on `reservations.update`:
  - allowed status transitions, load-status handling, and no-op guard
  - stable error envelope for transition failures and missing records
  - file: `functions/src/apiV1.ts`
- Every accepted reservation mutation writes timeline metadata:
  - `stageHistory` appends transition rows with `actorUid`, `actorRole`, `from/to`, `reason`, `notes`, `at`
  - `stageStatus` snapshot updated in the same mutation path
  - file: `functions/src/apiV1.ts`
- API surface is typed and wired:
  - contracts: `web/src/api/portalContracts.ts`
  - client runtime: `web/src/api/portalApi.ts`
- UI surfaces now consume timeline/state data:
  - reservation cards show last status update time and latest stage note
  - staff actions mutate through `PortalApi.updateReservation`
  - kiln load transitions use the same update route path
  - files: `web/src/views/ReservationsView.tsx`, `web/src/views/KilnLaunchView.tsx`
- Schema docs include timeline semantics and mutation contract details:
  - file: `docs/SCHEMA_RESERVATIONS.md`
- Validation coverage:
  - parity + transition blocking + auth + not-found for `reservations.update`
  - file: `functions/src/apiV1.test.ts`
