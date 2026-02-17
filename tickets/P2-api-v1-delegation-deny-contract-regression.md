# P2 — Delegation Deny-Path Contract Regression

Status: Completed
Date: 2026-02-17

## Problem
Delegated actor denial outcomes in API v1 still need stricter contract coverage across owner-sensitive routes, especially around:
- order of checks (owner mismatch vs delegation preconditions),
- strict-delegation mode behavior,
- route-specific resource/scope mismatch codes.

## Scope
`functions/src/apiV1.ts`

- `/v1/events.feed`
- `/v1/agent.reserve`
- `/v1/agent.pay`
- `/v1/agent.status`
- `/v1/agent.order.get`
- `/v1/agent.orders.list`
- `/v1/agent.requests.updateStatus`

## Tasks
- Add route-level regression matrix tests for delegated actor + mismatched owner + strict delegation off.
  - Assert deterministic 403 + `OWNER_MISMATCH` across all above routes.
- Add matrix tests for delegated actor + strict delegation checks on:
  - missing delegation record,
  - expired/revoked delegation,
  - owner mismatch,
  - scope/resource mismatch.
  - Assert expected `DELEGATION_*` codes.
- Add missing negative tests for route precondition ordering:
  - ensure non-owner delegated actor gets `OWNER_MISMATCH` where owner mismatch is the root cause.
  - ensure delegated precondition failures still surface once owner/ownership is validated.
- Update `tests/security` + route regression tests with explicit expected payload contract fields.

## Progress
- `functions/src/apiV1.test.ts` now includes delegated strict-mode deny matrix coverage for:
  - `DELEGATION_NOT_FOUND`
  - `DELEGATION_INACTIVE`
  - `DELEGATION_REVOKED`
  - `DELEGATION_EXPIRED`
  across:
  - `events.feed`
  - `agent.reserve`
  - `agent.pay`
  - `agent.status`
  - `agent.order.get`
  - `agent.orders.list`
  - `agent.requests.updateStatus`
- Completed work this pass:
  - added `actorMode: "delegated"` assertions on delegated owner-mismatch and strict-delegation deny paths.
  - added `resourceType` assertions for delegated strict/owner-mismatch deny branches where emitters are route-specific.
  - added missing delegated non-staff Firebase owner mismatch regression in owner-sensitive route matrix.

## Acceptance
- Delegated deny paths return stable `code` values per route and test matrix.
- Non-owner delegated requests consistently return `OWNER_MISMATCH` prior to delegation policy loading in owner-scoped operations.
- Strict mode adds explicit `DELEGATION_*` outcomes only when ownership is satisfied.
- No route returns generic `FORBIDDEN` for non-owner delegated requests that should map to owner mismatch.
