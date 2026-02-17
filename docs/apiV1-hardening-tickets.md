# API v1 Hardening Tickets

Date: 2026-02-17
Owner: TBD
Mode: Swarm handoff

## Ticket #APIV1-001 — Route dispatch and method/body validation hardening
- Scope: `functions/src/apiV1.ts`
- Problem: Route matching now uses raw `req.path` with permissive assumptions and mixed handling.
- Ask for swarm:
  - Status: Done in this branch.
  - Implemented items:
    - `ALLOWED_API_V1_ROUTES` route allowlist in `apiV1.ts`.
    - trailing slash normalization.
    - explicit 404 + `api_v1_route_reject` audit trail for unknown routes.
  - Remaining: tighten centralized route-level payload checks in subsequent cleanup pass.
- Acceptance: invalid/missing route/undefined body returns deterministic `INVALID_ARGUMENT` payload and never reaches Firestore.

## Ticket #APIV1-002 — Authorization edge-case hardening
- Scope: `functions/src/apiV1.ts`
- Problem: Authorization still depends on legacy checks in multiple branches and can produce mixed deny semantics.
- Hand-off: `tickets/P2-api-v1-authorization-edge-case-hardening.md`
- Ask for swarm:
  - Normalize deny reasons and HTTP statuses across all branches (`FORBIDDEN` vs `UNAUTHORIZED` alignment).
  - Add explicit ownerUid validation before `assertActorAuthorized` in each route.
  - Add regression tests for mixed-mode actor context (`firebase` + `pat` + `delegated`).
- Status note: `UNAUTHORIZED` has been replaced by `FORBIDDEN` for 403 permission-denial paths in `functions/src/apiV1.ts`.
- Coverage update: added `functions/src/authz.test.ts` regression cases for mixed-mode `assertActorAuthorized` outcomes (`pat`, `delegated`, firebase owner/staff branches).
- Coverage update: `assertActorAuthorized` is now used in owner-sensitive route branches for:
  - `/v1/events.feed`
  - `/v1/agent.reserve`
  - `/v1/agent.pay`
  - `/v1/agent.status`
  - `/v1/agent.order.get`
  - `/v1/agent.orders.list`
  - `/v1/agent.requests.updateStatus`.
- Remaining: add handler-level route regression coverage for mixed actor mode denial codes and delegation resource/scope mismatches.
- Update: non-owner non-staff Firebase scenarios now covered for owner-sensitive routes in `functions/src/apiV1.test.ts`.
- Follow-on ticket: `tickets/P2-api-v1-authorization-route-regression.md`
- Acceptance: consistent error codes across all route handlers and tests for each failure mode.

## Ticket #APIV1-003 — Firestore document projection hardening
- Scope: `functions/src/apiV1.ts`
- Problem: several Firestore payloads are returned directly, increasing blast radius of malformed/missing fields.
- Hand-off: `tickets/P2-api-v1-firestore-projection-hardening.md`
- Status: Done
- Ask for swarm:
  - Add local projection helpers for batch/timeline/firing outputs.
  - Strip undefined fields and enforce explicit nullability before response serialization.
  - Add tests for payload shape guarantees on malformed documents.
- Acceptance: consumers always receive documented fields for these endpoints.

## Ticket #APIV1-004 — Rate-limit resilience
- Scope: `functions/src/apiV1.ts`
- Problem: rate-limit failures currently short-circuit request handling and may leak internals.
- Hand-off: `tickets/P2-api-v1-rate-limit-resilience.md`
- Ask for swarm:
  - Handle `enforceRateLimit` exceptions defensively in API v1 route guard.
  - Add explicit `Retry-After` and consistent error body for unexpected cache/storage failures.
  - Add test coverage for rate-limit error path.
- Acceptance: rate-limit backend failures return safe structured error and continue with degraded-mode policy.

## Ticket #APIV1-005 — Observability and traceability
- Scope: `functions/src/apiV1.ts`
- Problem: request tracing fields are not fully normalized across all branches.
- Hand-off: `tickets/P2-api-v1-observability-traceability.md`
- Ask for swarm:
  - Standardize `requestId` propagation into all logs and returned responses.
  - Add explicit `resourceType/resourceId` for each route when auditing.
  - Add tests asserting audit/event fields for denied requests.
- Acceptance: at least 95% of API v1 branches include `requestId`, `resourceType`, and `resourceId` in audit logs.

## Ticket #APIV1-006 — API v1 contract/denial regression coverage
- Scope: `functions/src/apiV1.ts`
- Problem: no current regression suite locks route allowlist and projection/cursor semantics.
- Hand-off: `tickets/P2-api-v1-response-contract-regression-tests.md`
- Ask for swarm:
  - Add unit/integration-style tests for allowlist denials, successful route dispatch, and rate-limit fallback behavior.
  - Add snapshot-style expectations for `/v1/batches.get`, `/v1/batches.timeline.list`, `/v1/agent.requests.listMine`.
  - Fail CI on shape drift and missing audit events on denied paths.
- Acceptance: deterministic regression suite covering route, projection, and deny-path behavior.

## Ticket #APIV1-007 — API v1 collection payload projection hardening
- Status: Done
- Scope: `functions/src/apiV1.ts`
- Problem: raw spread-based returns still leak unstable fields on list endpoints (`timeline`, `firings`, agent request lists).
- Hand-off: `tickets/P2-api-v1-collections-projection-hardening.md`
- Notes: Completed in `functions/src/apiV1.ts` and validated by `functions/src/apiV1.test.ts`.
- Ask for swarm:
  - Normalize and redact payload fields for `/v1/batches.timeline.list`, `/v1/firings.listUpcoming`,
    `/v1/agent.requests.listMine`, `/v1/agent.requests.listStaff`.
  - Remove direct spread of document maps from response payload composition.
  - Add regression assertions that unexpected fields are omitted and typed defaults remain stable.
- Acceptance: list endpoints return only documented fields and tolerate malformed Firestore rows without breaking response contracts.

## Ticket #APIV1-008 — Delegation deny-path contract hardening
- Scope: `functions/src/apiV1.ts`
- Problem: delegated actor denies can blur contract boundaries across owner checks, strict-delegation checks, and scope/resource failures.
- Ask for swarm: `tickets/P2-api-v1-delegation-deny-contract-regression.md`
- Owner: TBD
- Status: Done
- Acceptance:
  - Non-owner delegated calls return deterministic `OWNER_MISMATCH` on owner-scoped routes.
  - Strict delegation failures return explicit `DELEGATION_*` codes only after ownership context is valid.
  - Regression suite covers `events.feed`, `agent.reserve`, `agent.pay`, `agent.status`, `agent.order.get`, `agent.orders.list`, `agent.requests.updateStatus`.

## Ticket #APIV1-009 — Delegation deny-path observability
- Scope: `functions/src/apiV1.ts`, `functions/src/apiV1.test.ts`, `functions/src/authz.test.ts`
- Problem: partial audit coverage for delegation-related denial branches reduces forensics quality.
- Ask for swarm: `tickets/P2-api-v1-delegation-denial-observability.md`
- Owner: TBD
- Status: Done
- Acceptance:
  - Denial branches on owner-sensitive delegated routes emit deterministic audit records with `reasonCode`.
  - Tests assert required audit fields for representative `OWNER_MISMATCH` and `DELEGATION_*` cases.

---

## Ticket #WEBSITE-001 — CSP-safe style policy migration (parking + faq)
- Scope: `website/faq/index.html`, `website/parking-page.shtml`, `website/assets/css/styles.css`
- Problem: inline styles were previously required for layout overrides.
- Status: Completed for scoped pages.
- Website inline `style=` audit now clean across HTML/SVG assets (`website` subtree), including SVG image-rendering cleanup.
- Ask for swarm:
  - Verify there are no remaining inline `style=` attributes after CSP rollout.
  - Ensure page-level CSS fallback classes exist for any equivalent layout overrides.
- Acceptance: zero inline style usage in public website pages and CSP remains enforced.
