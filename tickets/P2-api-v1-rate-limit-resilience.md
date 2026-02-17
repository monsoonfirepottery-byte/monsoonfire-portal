# P2 — API v1 Rate-Limit Resilience

Status: Completed

## Problem
Route-level and actor-level rate-limit checks are currently strict on unexpected backend/cache failures, which can introduce avoidable availability impact.

## Tasks
- Wrap rate-limit checks with defensive exception handling and degrade to safe allow mode when limit service fails.
- Ensure all deny responses remain deterministic with explicit `Retry-After` and consistent payload shape when limit service responds.
- Add telemetry for fallback mode (`rate limit service unavailable` reason code).
- Add tests for:
  - exception path on primary rate-limit call,
  - exception path on agent actor rate limit call.

## Acceptance
- Rate-limit infrastructure failures do not hard-fail API v1 requests.
- Denial responses continue to include request correlation and retry hints.
- Observability has explicit entries for fallback behavior.

## References
- `functions/src/apiV1.ts` (rate-limit middleware)
- `functions/src/shared.ts` (`enforceRateLimit`)

## Completion notes
- Added catch-path observability in `functions/src/apiV1.ts` for route-level and agent-level rate-limit check failures.
- Added regression tests in `functions/src/apiV1.test.ts` covering:
  - `/v1/hello` with route-level rate-limit backend throw
  - `/v1/agent.catalog` with agent-level rate-limit backend throw
