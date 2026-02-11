# P1 — Website Accessibility Baseline + Policy (WCAG 2.2 AA)

**Status:** Planned

## Problem
- The marketing website needs a formal accessibility baseline so improvements are consistent, testable, and durable.
- Without a shared target, fixes for blind/deaf/motor/cognitive users will be ad hoc and regress easily.

## Goals
- Adopt **WCAG 2.2 AA** as the website accessibility target.
- Add automated + manual accessibility checks to the website workflow.
- Publish a lightweight accessibility statement and support contact path.

## Scope
- Website only (`website/`), not Portal app internals.
- Includes baseline testing and policy docs.

## Tasks
1. Add a website accessibility checklist doc:
   - WCAG target (2.2 AA)
   - Required testing matrix (desktop/mobile, keyboard-only, screen reader spot checks)
   - Release gate expectations
2. Add automated checks:
   - Axe/Lighthouse a11y check in CI (warning initially, then fail-on-regression after stabilization)
3. Create an accessibility statement page:
   - current support status
   - known limitations
   - contact method for accommodation requests
4. Add issue template for accessibility reports.

## Acceptance
- A documented website a11y policy exists and is linked from repo docs.
- CI runs an accessibility audit for website pages.
- Accessibility statement is live and reachable from footer/nav.
- Team has a defined path for user-reported accessibility issues.

## Dependencies
- None. This ticket enables all other website a11y tickets.

