# P1 — Portal Performance Readiness and Smoke Hardening

Status: Completed
Date: 2026-02-18
Priority: P1
Owner: Portal Team
Type: Epic

## Problem
Sprint 11 has a defined performance and reliability work stream, but several requirements
still exist only as inline sprint notes and are not yet consistently owned as tracked tickets.

## Objective
Convert the remaining S11 work into executable tickets and lock guardrails for web/perf,
critical test flow coverage, and function performance risk review.

## Tickets
- `tickets/P2-s11-01-lighthouse-budgets-and-baseline.md`
- `tickets/P2-s11-02-route-bundle-chunk-budgets.md`
- `tickets/P2-s11-03-critical-flow-test-expansion.md`
- `tickets/P2-s11-04-lint-debt-remediation-and-ci-enforcement.md`
- `tickets/P2-s11-05-functions-cold-start-performance-profiling.md`

## Scope
1. Create clear ticket ownership for each S11 task.
2. Preserve existing CI smoke/lighthouse foundations while increasing regression observability.
3. Add missing baseline links so future passes are reproducible and reviewable.

## Dependencies
- `.github/workflows/lighthouse.yml`
- `.github/workflows/ci-smoke.yml`
- `.github/workflows/portal-prod-smoke.yml`
- `web/scripts/check-chunk-budgets.mjs`

## Acceptance Criteria
1. Every S11 work item has an owning P2 ticket, status, and acceptance criteria.
2. The ticket set covers web budgets, CI smoke coverage, and function latency risk triage.
3. Perf/quality evidence is reproducible from named workflows and documented in tickets.
