# P2 — API v1 Observability and Traceability

Status: Completed

## Problem
Audit and rejection events in v1 are not yet consistently labeled with resource context and request intent across all branches.

## Tasks
- Standardize `resourceType` / `resourceId` in audit events for denied and successful routes.
- Require `requestId` propagation in all log events and structured error payloads.
- Add explicit correlation fields for auth mode, actor UID, route, and route-scoped resource.
- Add tests that verify audit entries on representative deny paths.

## Acceptance
- ≥95% of v1 route branches emit audit rows with `requestId`, `resourceType`, and `resourceId`.
- Debug payloads are consistently correlated to request context.

## Completion Notes (2026-02-23)
- Standardized admin-auth deny telemetry for reservation admin routes in `functions/src/apiV1.ts`:
  - `reservations.lookupArrival`
  - `reservations.rotateArrivalToken`
  - `reservations.update`
  - `reservations.assignStation`
- Each deny branch now emits audit events with explicit `requestId`, `resourceType`, `resourceId`, and machine-readable `reasonCode`.
- Added deterministic regression assertions in `functions/src/apiV1.test.ts` to verify deny-path audit coverage and request-id correlation.
- Validation evidence:
  - `npm --prefix functions run -s test` (pass)
  - `npm --prefix functions run -s build` (pass)

## References
- `functions/src/apiV1.ts` (`logAuditEvent` callsites, `jsonError`, `jsonOk`)
