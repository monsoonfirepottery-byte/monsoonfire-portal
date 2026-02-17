# P2 — API v1 Authorization Edge-Case Hardening

Status: In Progress

## Problem
Route handlers in `functions/src/apiV1.ts` still have mixed denial pathways for:
- owner/scoped checks,
- `assertActorAuthorized` outcomes,
- and direct `UNAUTHORIZED`/`FORBIDDEN` handling.

Inconsistent error semantics increase ambiguity for clients and complicate audit investigation.

## Tasks
- Normalize auth-denial responses to consistent mappings:
  - `ctx`/token failures → `401` (`UNAUTHENTICATED`)
  - permission/ownership failures → `403` (`FORBIDDEN`)
  - malformed state/missing resources → existing mapped codes
- Centralize owner validation before route-specific logic for routes that expose ownership-sensitive data.
- Ensure editor/staff/owner constraints remain consistent with Firestore rule semantics.
- Add regression tests for mixed actor modes (`firebase`, `pat`, `delegated`) when ownership/role checks diverge.

## Acceptance
- A denial matrix is consistent across all protected routes with no mixed `401`/`403` ambiguity.
- No regression in existing routes and tests.
- Security-sensitive routes include explicit owner/context validation in code review and logs.

### Progress
- **Completed in this branch**: normalized direct permission-denial payload codes on v1 403 paths from `UNAUTHORIZED` to `FORBIDDEN` in `functions/src/apiV1.ts`.
- **Completed (foundational)**: added `functions/src/authz.test.ts` coverage for mixed-mode `assertActorAuthorized` outcomes (`pat`, `delegated`, `firebase` staff/non-staff owner matching).
- **Completed in this pass**: replaced remaining bespoke owner checks with `assertActorAuthorized` in owner-sensitive routes:
  - `/v1/events.feed`
  - `/v1/agent.reserve`
  - `/v1/agent.pay`
  - `/v1/agent.status`
  - `/v1/agent.order.get`
  - `/v1/agent.orders.list`
  - `/v1/agent.requests.updateStatus`
- **Remaining**: route-level owner/context regression coverage for mixed actor modes and delegation scope/resource mismatch scenarios on the above endpoints.

## References
- `functions/src/apiV1.ts`
- `functions/src/shared.ts` (actor context and auth helpers)
