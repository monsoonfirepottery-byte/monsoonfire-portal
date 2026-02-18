# P2 — Route Bundle Chunk Budgets

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Portal Team
Type: Ticket
Parent Epic: tickets/P1-portal-performance-readiness-and-smoke-hardening.md

## Problem
Bundle/chunk budget checks are documented in sprint notes but not assigned to a tracked, owned ticket with explicit CI remediation steps.

## Objective
Enforce route-level chunk size budgets in CI and make failure behavior explicit.

## Scope
1. Validate `npm --prefix web run perf:chunks` for route-level budgets.
2. Ensure major portal routes keep bounded initial chunk growth.
3. Document a remediation playbook for chunk budget violations.

## Tasks
1. Confirm `web/scripts/check-chunk-budgets.mjs` reflects current route targets.
2. Add or verify CI enforcement of the chunk budget script in smoke or perf workflow.
3. Add ticketed remediation guidance for oversized route bundles.

## Acceptance Criteria
1. CI detects chunk budget regressions for major routes.
2. Routes with oversized first-load chunks have clear owner-defined fixes.
3. No functional regressions in route transitions due to aggressive chunk boundaries.

## References
- `web/scripts/check-chunk-budgets.mjs`
- `.github/workflows/ci-smoke.yml`
- `.github/workflows/portal-prod-smoke.yml`
- `docs/sprints/SPRINT_11_PERF_TESTING.md`
