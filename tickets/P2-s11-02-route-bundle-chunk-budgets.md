# P2 — Route Bundle Chunk Budgets

Status: Completed
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

## Execution Notes
1. Strengthened chunk-budget guardrails in `web/scripts/check-chunk-budgets.mjs`:
   - enforced required major route chunk presence (dashboard, reservations, kiln, pieces, messages, materials, events, profile)
   - retained hard byte budgets for critical vendor and route bundles
   - added inline remediation guidance on failure output
2. Added explicit remediation playbook:
   - `docs/runbooks/PORTAL_CHUNK_BUDGET_REMEDIATION.md`
3. Validation:
   - `npm --prefix web run build`
   - `npm --prefix web run perf:chunks`
   - `npm --prefix web run test:run`
4. CI enforcement confirmed in:
   - `.github/workflows/ci-smoke.yml` (`Web chunk budgets` step)

## References
- `web/scripts/check-chunk-budgets.mjs`
- `.github/workflows/ci-smoke.yml`
- `.github/workflows/portal-prod-smoke.yml`
- `docs/sprints/SPRINT_11_PERF_TESTING.md`
