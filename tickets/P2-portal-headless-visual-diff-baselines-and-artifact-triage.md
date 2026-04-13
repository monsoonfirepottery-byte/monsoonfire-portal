# P2 — Portal headless visual diff baselines and artifact triage

Status: Active
Date: 2026-04-12
Priority: P2
Owner: Portal / QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-codex-tool-surface-and-portal-operator-access.md

## Problem
Existing portal canaries catch functional regressions and save screenshots, but there is no reusable baseline-and-diff workflow that makes layout or theme drift easy to review headlessly across Windows, SSH, and critical portal surfaces.

## Tasks
1. Add a headless visual-diff mode on top of the current Playwright canaries and smokes for the highest-value portal routes and themes.
2. Store approved baselines in a deliberate location with an explicit refresh flow instead of ad hoc screenshot replacement.
3. Generate diff artifacts plus a markdown triage summary with linked images and route or theme context.
4. Keep the workflow Windows-friendly and usable without a headed browser session.

## Acceptance Criteria
1. A single command can capture or compare baselines for the critical portal surfaces.
2. Failures emit image diffs and a concise markdown summary that is usable in SSH or headless review.
3. Community layout, authenticated canary, and theme-sensitive surfaces are covered in the first pass.

## Dependencies
- `package.json`
- `scripts/portal-authenticated-canary.mjs`
- `scripts/portal-community-layout-canary.mjs`
- `scripts/portal-playwright-smoke.mjs`
- `docs/runbooks/PORTAL_AUTOMATION_MATRIX.md`
- `output/qa/`

## Verification
- baseline capture mode writes deterministic artifact locations
- compare mode fails on an intentional visual drift and links the diff images
- workflow runs headlessly on the supported Windows or SSH path
