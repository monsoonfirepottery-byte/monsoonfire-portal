# P1 — Community Layout Intermittent Regression Canary and Workflow

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: QA Automation + Frontend
Type: Ticket
Parent Epic: tickets/P1-EPIC-18-community-page-experience-and-layout-resilience.md

## Problem

Community right-rail layout issues are intermittent and can slip through ad-hoc manual checks.

## Objective

Add automated canary coverage for Community layout stability and chiplet overflow behavior.

## Tasks

1. Implement authenticated Playwright canary for Community view.
2. Validate right-rail stability before/after report refresh.
3. Detect and report chiplet/row overflow diagnostics.
4. Add scheduled workflow + artifact upload for screenshots/report JSON.

## Acceptance Criteria

1. Canary fails when right-rail overflow or major width-shift conditions occur.
2. Workflow runs on schedule and manual dispatch.
3. Artifacts include diagnostics and screenshots for fast triage.

## Completion Evidence (2026-02-28)

1. Added authenticated canary script `scripts/portal-community-layout-canary.mjs` with:
   - Community navigation and refresh flow
   - Right-rail width stability check
   - Overflow diagnostics for chiplets/report rows/video rows
   - Screenshot + JSON artifact output
2. Added scheduled + manual GitHub workflow `.github/workflows/portal-community-layout-canary.yml`.
3. Added package script alias `portal:canary:community-layout` and documented linkage in automation runbooks.
