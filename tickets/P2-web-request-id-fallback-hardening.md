# P2 — Web Request-ID Fallback Hardening

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Portal Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-02-auth-role-consistency-and-traceability.md

## Problem
The web clients generate request IDs with a non-crypto fallback (`Math.random`) when `crypto.randomUUID` is unavailable, weakening correlation guarantees in debug and low-support environments.

## Objective
Replace weak request-id fallback behavior with explicit deterministic/crypto-safe generation and make correlation quality part of traceability expectations.

## Scope
1. Audit request-id helpers in web clients.
2. Add a shared, testable helper with explicit fallback behavior for constrained browsers.
3. Ensure last-request/curl metadata always includes reliable IDs.

## Tasks
1. Refactor `web/src/api/functionsClient.ts` and `web/src/api/portalApi.ts` request-id generation into a shared helper.
2. Replace `Math.random`-based fallback with a deterministic multi-part fallback that is collision resistant for session scope.
3. Add coverage for:
   - modern browser path (`crypto.randomUUID`)
   - fallback path output format + non-empty uniqueness within short windows.

## Acceptance Criteria
1. No production code path relies on weak `Math.random` fallback for request IDs.
2. Request-ID behavior is covered by tests for both supported and fallback generation branches.
3. Troubleshooting metadata (`requestId`, `payload`, `status`) remains stable across both `functionsClient` and `portalApi` paths.

## References
- `web/src/api/functionsClient.ts:72`
- `web/src/api/portalApi.ts:206`
- `web/src/api/requestId.ts`
- `web/src/api/requestId.test.ts`
