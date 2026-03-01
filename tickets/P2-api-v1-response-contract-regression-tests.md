# P2 — API V1 Response Contract Regression Tests

Status: Completed
Date: 2026-02-17

## Problem
`handleApiV1` route hardening is progressing, but there are still no regression tests that lock the v1 contract for:
- unknown route rejection behavior,
- rate-limit fallback behavior,
- payload projections for routes that return Firestore documents.

Given the endpoint count and sensitive operations in `functions/src/apiV1.ts`, regressions here are likely to ship silently.

## Scope
- `functions/src/apiV1.ts`
- `functions/src/tests` (new test module)

## Tasks
- Add API-level tests (or a test harness at function-level) covering:
  - allowlist rejections for unknown and malformed routes,
  - malformed path normalization edge cases (trailing slash, duplicate slash, missing route)
  - route allowlist hit path for `/v1/hello` and one sensitive route,
  - route-level 404 + `api_v1_route_reject` audit entry,
  - route-level and actor-level `enforceRateLimit` thrown-path fallback behavior.
- Add contract tests for `/v1/batches.get` and `/v1/batches.timeline.list` return shapes:
  - expected fields only,
  - `undefined` removed/defaulted,
  - scalar typing coercion rules respected.
- Add a negative test for malformed Firestore data in `/v1/agent.requests.listMine` ensuring unknown fields are not reflected directly.
- Keep tests independent of emulator state by mocking firestore/admin + shared helpers in a deterministic way.

## Acceptance
- Regression test suite fails on response shape drift, deny-path ambiguity, and missing observability hooks for v1.
- New tests run in CI with `npm --prefix functions test` and remain stable under mocked inputs.

## References
- `functions/src/apiV1.ts`
- `functions/src/apiV1.test.ts`

## Completion evidence (2026-02-28)
- Route allowlist + malformed path regression tests exist and pass in:
  - `functions/src/apiV1.test.ts`
  - cases include:
    - unknown/malformed route rejection with `api_v1_route_reject` audit assertions
    - trailing slash + missing leading slash normalization
- Route dispatch + payload contract tests exist and pass for:
  - `/v1/batches.get`
  - `/v1/batches.timeline.list`
  - `/v1/agent.requests.listMine` (unknown-field exclusion assertions)
- Rate-limit thrown-path fallback behavior is covered and passing for:
  - route-level rate limit failure
  - actor-level rate limit failure
- Verification run executed:
  - `npm --prefix functions run build`
  - `node --test functions/lib/apiV1.test.js`
  - result: `115` tests passed, `0` failed
