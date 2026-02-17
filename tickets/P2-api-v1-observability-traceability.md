# P2 — API v1 Observability and Traceability

Status: In Progress

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

## References
- `functions/src/apiV1.ts` (`logAuditEvent` callsites, `jsonError`, `jsonOk`)
