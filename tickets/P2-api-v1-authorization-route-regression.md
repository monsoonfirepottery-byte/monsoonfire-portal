# P2 — API v1 Owner Context Regression

Status: Done
Date: 2026-02-17
Owner: TBD

## Problem
`functions/src/apiV1.ts` has several ownership-sensitive routes that now use `assertActorAuthorized`, but we still need explicit regression coverage that this matrix behaves consistently across actor modes.

## In Scope
- `/v1/events.feed`
- `/v1/agent.reserve`
- `/v1/agent.pay`
- `/v1/agent.status`
- `/v1/agent.order.get`
- `/v1/agent.orders.list`
- `/v1/agent.requests.updateStatus`

## Tasks
- Add handler-level tests (or contract test harness) covering mismatched owner contexts for `delegated`, `pat`, and non-staff `firebase` actors.
- Assert 403 deny behavior and route-specific codes (`OWNER_MISMATCH`, `DELEGATION_*`) where applicable.
- Verify staff bypass behavior remains unchanged for allowStaff branches.
- Add a regression case for delegated actor without matching scope/resource on these routes.
- Record audit event expectations for deny paths if route-level logging is required.

## Acceptance
- Non-owner non-staff requests to owner-bound routes fail with deterministic 403 outcomes.
- Delegated scope/resource mismatches return explicit 403 denial codes from authz checks.
- Staff and owner-owned requests are unaffected for the updated routes.
- Existing deny responses remain backward-compatible in shape for clients that rely on 403 envelopes.
- This branch now includes matrix coverage for:
  - `/v1/events.feed`
  - `/v1/agent.reserve`
  - `/v1/agent.pay`
  - `/v1/agent.status`
  - `/v1/agent.order.get`
  - `/v1/agent.orders.list`
  - `/v1/agent.requests.updateStatus`

## References
- `functions/src/apiV1.ts`
- `functions/src/authz.test.ts`
