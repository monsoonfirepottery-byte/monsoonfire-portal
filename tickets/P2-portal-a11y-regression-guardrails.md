# P2 — Portal A11y: Regression Guardrails and QA Cadence

Status: Completed

## Problem
- Accessibility fixes can regress quickly across active portal UI work.
- There is no lightweight recurring portal-specific a11y smoke cadence.

## Goals
- Keep portal accessibility stable release-over-release.
- Make regressions visible early and actionable.

## Scope
- Portal CI checks and monthly/manual QA workflow.

## Tasks
1. Add portal smoke script/checklist for critical routes:
   - signed-out auth
   - dashboard
   - ware check-in
   - firings
   - support
   - staff shell navigation
2. Add recurring manual pass:
   - keyboard-only traversal
   - screen-reader spot checks (VoiceOver/NVDA)
   - reduced-motion + zoom 200%
3. Add accessibility changelog section in release notes for portal.
4. Define owner and SLA for `a11y` tagged portal issues.

## Acceptance
- Portal a11y smoke checks run on a recurring cadence.
- Regressions are tracked with owner + due date.
- Release notes include portal accessibility changes and known gaps.

## Dependencies
- `tickets/P1-portal-a11y-baseline-and-policy.md`
- `tickets/P1-portal-a11y-navigation-and-bypass-blocks.md`
- `tickets/P1-portal-a11y-forms-and-status-semantics.md`
- `tickets/P1-portal-a11y-interactive-semantics-and-nested-controls.md`
- `tickets/P1-portal-a11y-target-size-and-operability.md`

## Progress notes
- Added recurring cadence for portal smoke checks:
  - `.github/workflows/ci-smoke.yml` now runs on PR/push + weekly schedule.
- Expanded portal a11y smoke coverage for critical routes in:
  - `web/scripts/a11y-smoke.mjs`
  - includes signed-out auth, dashboard, ware check-in, firings, support, and staff route presence checks.
- Added regression guardrails runbook with monthly QA cadence + owner/SLA:
  - `docs/PORTAL_A11Y_REGRESSION_GUARDRAILS.md`
- Added release-note accessibility changelog section:
  - `docs/RELEASE_CANDIDATE_EVIDENCE.md`
