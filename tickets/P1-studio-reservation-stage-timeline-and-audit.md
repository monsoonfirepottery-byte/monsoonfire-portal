# P1 — Reservation Stage Timeline and Audit Trail

Status: Open
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
