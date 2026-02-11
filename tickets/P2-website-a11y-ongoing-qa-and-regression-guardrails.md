# P2 — Website A11y: Ongoing QA + Regression Guardrails

**Status:** Planned

## Problem
- Accessibility improvements regress quickly without recurring checks and ownership.
- One-time remediation is not enough for a frequently updated marketing site.

## Goals
- Keep accessibility quality stable across future website updates.
- Catch regressions early with lightweight, repeatable checks.

## Scope
- Website release workflow and QA cadence.

## Tasks
1. Regression suite:
   - define a small set of “must-pass” pages and components
   - run Axe/Lighthouse on each deploy preview
2. Manual cadence:
   - monthly keyboard + screen reader smoke checks
   - quarterly deep-dive audit
3. Ownership + SLA:
   - assign owner for accessibility triage
   - set response targets for accessibility bugs
4. Accessibility changelog:
   - track significant accessibility updates and known gaps in docs
5. Severity model:
   - classify issues (critical/major/minor) and define release-blocking threshold

## Acceptance
- Accessibility checks run on every preview deploy for defined pages.
- Manual audit cadence and owner are documented.
- A11y issues have severity labels and clear response expectations.
- Regressions are visible before production release.

## Dependencies
- `tickets/P1-website-a11y-baseline-and-policy.md`
- `tickets/P1-website-a11y-blind-low-vision-and-screenreader.md`
- `tickets/P1-website-a11y-deaf-hard-of-hearing.md`
- `tickets/P1-website-a11y-motor-cognitive-and-neurodiverse.md`

