# P2 — API v1 Hardening Swarm Dispatch

Status: Completed
Date: 2026-02-17

## Swarm targets
- **Swarm A (Auth/Authorization)**  
  - Ticket: `tickets/P2-api-v1-authorization-edge-case-hardening.md`
  - Owner: TBD
  - Focus: normalize deny reason/status semantics across all v1 routes.
  - Progress note: 403 permission payloads normalized to `FORBIDDEN`; mixed-mode owner checks now covered in `functions/src/authz.test.ts`; owner-sensitive handler branches now use `assertActorAuthorized` in `functions/src/apiV1.ts`; route-level mixed-mode regression still remains (see `tickets/P2-api-v1-authorization-route-regression.md`).

- **Swarm B (Payload Safety)** ✅ **Done**
  - Ticket: `tickets/P2-api-v1-firestore-projection-hardening.md`
  - Owner: TBD
  - Focus: harden response projections for batch/timeline/firing and agent payloads.

- **Swarm C (Reliability)**  
  - Ticket: `tickets/P2-api-v1-rate-limit-resilience.md`
  - Owner: TBD
  - Focus: expand tests and telemetry for `enforceRateLimit` failure paths.

- **Swarm D (Telemetry/Compliance)**  
  - Ticket: `tickets/P2-api-v1-observability-traceability.md`
  - Owner: TBD
  - Focus: standardize audit/resource metadata coverage.

- **Swarm E (Web CSP/Styles)**  
  - Ticket: `tickets/P1-website-inline-style-to-css-migration.md`
  - Owner: TBD
  - Focus: verify page-wide inline-style removal and CSP behavior.

- **Swarm F (Contracts/Regression)** ✅ **Done**
  - Ticket: `tickets/P2-api-v1-response-contract-regression-tests.md`
  - Owner: TBD
  - Focus: lock route allowlist and payload-contract behavior with deterministic API tests.
  - Completion note: route normalization/reject, payload projection, and rate-limit thrown-path regression coverage now runs in `functions/src/apiV1.test.ts` and passes in compiled `node --test functions/lib/apiV1.test.js`.

- **Swarm G (Collections Projection)** ✅ **Done**
  - Ticket: `tickets/P2-api-v1-collections-projection-hardening.md`
  - Owner: TBD
  - Focus: remove raw spreads on list endpoints and enforce stable projection for timeline/firings/request lists.

- **Swarm H (Portal Styling)** ✅ **Done**
  - Ticket: `tickets/P2-portal-inline-style-class-migration.md`
  - Owner: TBD
  - Focus: remove React inline `style={{...}}` usage in portal views and centralize class-based CSS.

- **Swarm I (Delegation Deny Contract)** ✅ **Done**
  - Ticket: `tickets/P2-api-v1-delegation-deny-contract-regression.md`
  - Owner: TBD
  - Focus: lock delegated non-owner and strict-delegation deny outcomes to deterministic `OWNER_MISMATCH` / `DELEGATION_*` contracts.
  - Entry criteria:
    - route-level strict-mode owner mismatch matrix for delegated actors.
    - deterministic contract snapshots for non-owner vs strict-delegation failure precedence.
  - Completion note: non-owner + strict delegation fixtures now assert deterministic `actorMode` and `resourceType` for route-specific deny paths in `functions/src/apiV1.test.ts`.

- **Swarm J (Delegation Observability)**  ✅ **Done**
  - Ticket: `tickets/P2-api-v1-delegation-denial-observability.md`
  - Owner: TBD
  - Focus: enforce audit coverage on delegated deny branches for owner-sensitive routes and validate with contract tests.
  - Completion note: owner-mismatch + strict-delegation deny assertions now include `actorMode`, `resourceType`, `reasonCode`, and delegated metadata (`delegationId`, `delegationAudience`, `agentClientId`) assertions.

- **Swarm K (Authorization Route Regression)** ✅ **Done**
  - Ticket: `tickets/P2-api-v1-authorization-route-regression.md`
  - Owner: TBD
  - Focus: non-owner route-level actor-mode and delegation ordering regressions on owner-sensitive endpoints.
  - Completion note: non-staff firebase negative matrix now exists in `functions/src/apiV1.test.ts`.

## Coordination note
- APIV1-001 route allowlist work is already completed in this branch.
- Use `docs/apiV1-hardening-tickets.md` as backlog summary and handoff reference.

## Completion evidence (2026-02-28)
- Swarms A, B, C, D, E, F, G, H, I, J, K now all have completed tickets.
- Latest verification run for Swarm F:
  - `npm --prefix functions run build`
  - `node --test functions/lib/apiV1.test.js`
  - `115` tests passed, `0` failed.
