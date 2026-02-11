# P1 — Portal Accessibility Baseline + Policy (WCAG 2.2 AA)

**Status:** Planned

## Problem
- Portal accessibility has meaningful improvements but no explicit portal-specific baseline, release gate, or ownership.
- Without a baseline, fixes regress as features ship.

## Goals
- Adopt **WCAG 2.2 AA** as the portal target.
- Define required automated/manual checks for the portal.
- Create a clear triage path for accessibility defects.

## Scope
- Portal app in `web/src` (authenticated shell + signed-out flow).

## Tasks
1. Publish a portal baseline doc with:
   - target criteria, prioritized user journeys, release gates
   - keyboard, screen reader, reduced-motion, and zoom checks
2. Add portal accessibility checks in CI:
   - lint rules for common JSX a11y issues
   - route-level smoke checks for critical views
3. Add an issue template/tagging convention for portal accessibility bugs.
4. Require accessibility sign-off for major nav/form changes.

## Acceptance
- Portal baseline document exists and is linked from docs.
- CI includes portal-specific a11y checks.
- New portal accessibility issues follow defined triage path and severity.

## Dependencies
- `docs/PORTAL_ACCESSIBILITY_ASSESSMENT_2026-02-11.md`
