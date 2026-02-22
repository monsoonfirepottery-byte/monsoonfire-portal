# P2 — Critical Flow Test Expansion

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Portal Team
Type: Ticket
Parent Epic: tickets/P1-portal-performance-readiness-and-smoke-hardening.md

## Problem
Sprint 11 target test flows are captured in notes, but expanded coverage has no ticket-level owner or measurable gating criteria.

## Objective
Extend reliable test coverage for alpha-critical portal flows and keep execution stable enough for CI.

## Scope
1. Expand authentication, functions guard, and in-flight diagnostics coverage.
2. Add regression tests for error branches and fallback messaging.
3. Keep tests deterministic and off Firebase production services.

## Tasks
1. Add/expand tests for:
   - auth gating
   - functions client auth header behavior
   - in-flight guard and duplicate-submit prevention
   - troubleshooting/call snapshot behavior
2. Validate deterministic mock strategy for functions/auth dependencies.
3. Record and review test timing against CI budgets.

## Acceptance Criteria
1. Alpha-critical flows have at least one happy-path and one failure-path test.
2. No tests require live Firebase in normal CI runs.
3. Coverage expansion remains stable and does not exceed agreed CI runtime budget.

## Execution Notes
1. Added focused tests for functions client auth/header behavior, error handling, and request snapshot/curl capture:
   - `web/src/api/functionsClient.test.ts`
2. Added guard-flow tests for account bootstrap request behavior (in-flight dedupe, retry budget suppression, auth/body contract):
   - `web/src/api/ensureUserDoc.test.ts`
3. Validation run (local):
   - `npm --prefix web run lint`
   - `npm --prefix web run test:run`
4. Expanded suite remains deterministic and network-isolated; current web test total:
   - `21` files / `105` tests passing locally
5. Added scenarios cover both happy/failure paths for:
   - auth headers and admin-token handling (`functionsClient`)
   - failed function responses and troubleshooting snapshot behavior (`functionsClient`)
   - bootstrap request in-flight dedupe and retry suppression (`ensureUserDoc`)

## References
- `web/src/api/functionsClient.ts`
- `web/src/api/portalApi.ts`
- `web/src/App.tsx`
- `docs/sprints/SPRINT_11_PERF_TESTING.md`
