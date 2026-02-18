# P2 — Web Perf Budgets and Lighthouse Baseline

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Portal Team
Type: Ticket
Parent Epic: tickets/P1-portal-performance-readiness-and-smoke-hardening.md

## Problem
Sprint 11 baseline work for Lighthouse budgets exists as notes, but there is no ticket-level owner for ongoing baseline management and evidence generation.

## Objective
Stand up baseline capture and budget enforcement with reproducible evidence artifacts that can be checked before merge.

## Scope
1. Run Lighthouse against target routes in a deployable environment.
2. Define/confirm budgets in `web/lighthouserc.json` and tie them to route targets.
3. Capture baseline evidence in one location for release verification.

## Tasks
1. Execute Lighthouse CI path once per release candidate environment (staging or preview).
2. Confirm route-target coverage and stable scoring thresholds in `web/lighthouserc.json`.
3. Add/update evidence checklist entry in `docs/RELEASE_CANDIDATE_EVIDENCE.md` or equivalent release log.

## Acceptance Criteria
1. Lighthouse workflow is reproducible and green when budgets are met.
2. Budget thresholds are realistic and do not allow silent quality regressions.
3. All baseline captures include run metadata and route list.

## References
- `.github/workflows/lighthouse.yml`
- `web/lighthouserc.json`
- `docs/sprints/SPRINT_11_PERF_TESTING.md`
