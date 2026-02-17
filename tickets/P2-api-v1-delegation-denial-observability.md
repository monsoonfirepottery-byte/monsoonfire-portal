# P2 — Delegation Denial Observability and Audit Coverage

Status: Completed
Date: 2026-02-17

## Problem
API v1 denial branches for delegation-related auth failures are only partially mirrored in audit logs and response telemetry. This weakens incident response and forensics.

## Scope
`functions/src/apiV1.ts`, `functions/src/apiV1.test.ts`, `functions/src/authz.test.ts`

## Tasks
- Add `logAuditEvent` calls on delegated/fallback deny branches for owner-sensitive routes that currently only return JSON errors:
  - `/v1/agent.status`
  - `/v1/agent.order.get`
  - `/v1/agent.orders.list`
  - `/v1/agent.requests.updateStatus`
- Add tests asserting audit payload shape (`action`, `reasonCode`, `actorMode`, `resourceType`) on deny paths.
- Ensure delegated denial audit entries include enough context for triage:
  - `actorUid`, `actorMode`, `delegationId`-adjacent token context, and requestId.
- Keep audit noise low by logging only hard-deny outcomes for these routes and not normal 404/malformed request branches.

## Current status
- Existing route deny tests now assert `reasonCode` and `actorMode` on owner-sensitive delegated deny paths in `functions/src/apiV1.test.ts`.
- `agent.orders.list` and `agent.requests.updateStatus` are covered by strict delegation matrix checks with deterministic `DELEGATION_*` outcomes plus actor-mode assertions.
- Added actor-mode assertions for delegated owner-mismatch denials across:
  - `events.feed`
  - `agent.reserve`
  - `agent.pay`
  - `agent.status`
  - `agent.order.get`
  - `agent.requests.updateStatus`
- `resourceType` assertions were added where deterministic audit metadata is emitted on delegation deny branches.
- Added actor-mode assertions for strict-mode delegation denials on:
  - `events.feed`
  - `agent.reserve`
  - `agent.pay`
  - `agent.status`
  - `agent.order.get`
  - `agent.orders.list`
  - `agent.requests.updateStatus`
- Added delegation-context metadata assertions (`delegationId`, `delegationAudience`, `agentClientId`) on all delegated deny-path tests in `functions/src/apiV1.test.ts`.
- Completion note: route-level owner-sensitive deny branches now assert `actorMode`, `resourceType`, `reasonCode`, and delegated metadata for route- and resource-level mismatches.

### Acceptance status
- Deterministic delegated deny rows (`OWNER_MISMATCH`, `DELEGATION_*`) are now covered with audit payload assertions in contract tests.
- Triage fields include delegation context and are now present in deny audit events.

## Acceptance
- All delegated denies on targeted routes emit one audit event with deterministic `reasonCode`.
- Tests can assert deny events for at least one scenario each: `OWNER_MISMATCH`, `DELEGATION_SCOPE_MISSING`, `DELEGATION_RESOURCE_MISSING`.
- Monitoring/traceability can filter delegated denials by `resourceType` and `action` without extra parsing.
