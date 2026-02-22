# P1 — Reservation API v1 and legacy parity + observability

Status: Completed
Date: 2026-02-17
Priority: P1
Owner: Functions Team
Type: Ticket

## Problem

`createReservation`, `updateReservation`, and `assignReservationStation` are exposed through both legacy entry points and v1 paths.
Today, parity is mostly expected rather than guaranteed, and there is limited traceability when parity violations happen.

## Scope

- `functions/src/apiV1.ts`
- `functions/src/index.ts`
- `functions/src/assignReservationStation.ts`
- `functions/src/updateReservation.ts`
- `functions/src/index.ts` route exports

## Tasks

1. Add a shared reservation mutation handler path for common request/response shaping where practical.
2. Ensure route-level auth + actor-role handling is identical for equivalent legacy and v1 calls.
3. Emit consistent error codes and `requestId` for the same validation or permission failures on both routes.
4. Add test fixtures for:
   - mismatched actor mode (staff/client/dev)
   - invalid transitions
   - station capacity conflict
   - idempotent replay/retry
5. Add parity logging for route family (`legacy` vs `v1`) in audit/metrics.

## Acceptance Criteria

- Golden payloads produce matching outcomes across legacy and v1 for all success and validation-failure scenarios.
- No regression where one route path permits updates that the other rejects.
- All new parity paths are covered by automated tests and a basic smoke checklist.
- Alerting points to route family when parity checks fail.

## Completion Notes (2026-02-22)

- Added parity regression tests for create/update/assign route families in `functions/src/apiV1.test.ts`.
- Added route-family metadata propagation for reservation authz audit events in `functions/src/apiV1.ts`.
- Added coverage asserting reservation authz logs include `metadata.routeFamily` for both `v1` and `legacy`.
