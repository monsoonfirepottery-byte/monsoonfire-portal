# P2 — Lint Debt Remediation and CI Enforcement

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Portal Team
Type: Ticket
Parent Epic: tickets/P1-portal-performance-readiness-and-smoke-hardening.md

## Problem
Lint debt persists in web/functions surfaces without a ticketed plan for cleanup and no explicit gate that prevents regression.

## Objective
Resolve high-signal lint blockers and enforce lint as a hard merge gate with traceable debt policy.

## Scope
1. Run lint across `web` and `functions` scopes and fix high-confidence findings.
2. Create/maintain any explicit allowlist where needed, with rationale.
3. Enforce clean lint in release workflows.

## Tasks
1. Execute and triage `npm run lint` (root/web/functions as applicable).
2. Fix deterministic issues affecting reliability and maintainability.
3. Add or tighten CI step in workflows to fail on new lint violations.

## Acceptance Criteria
1. `npm --prefix web run lint` and lint check for touched backend scope are clean or explicitly allowed.
2. Merge pipeline blocks unresolved lint failures for the touched paths.
3. Lint debt reduction is documented in ticket updates, including any remaining exceptions.

## References
- `web/package.json`
- `functions/package.json`
- `.github/workflows/ci-smoke.yml`
- `.github/workflows/lint.yml`
- `docs/sprints/SPRINT_11_PERF_TESTING.md`
