# P2 — Playwright Client Dropoff/Pickup Journey Regression

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Portal + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-12-portal-user-journey-and-stripe-negative-outcome-testing.md

## Problem

Current Playwright coverage is primarily smoke-focused and does not assert full client-visible journey behavior from dropoff to pickup.

## Objective

Add deterministic Playwright journey checks for key client-facing lifecycle steps.

## Scope

- intake/dropoff form flow
- queue/status visibility
- ready-for-pickup presentation
- pickup completion confirmation

## Tasks

1. Add Playwright fixtures for deterministic journey accounts/data.
2. Implement journey spec with strict assertions for each step.
3. Capture screenshots and concise artifacts on failures.
4. Integrate into optional deep lane first, then promote to required lane if stable.

## Acceptance Criteria

1. End-to-end journey spec passes consistently in CI deep lane.
2. Client UI asserts expected status and action affordances at each stage.
3. Failures include actionable artifacts.

## Dependencies

- `scripts/portal-playwright-smoke.mjs`
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`

## Progress Notes

- 2026-02-22: Added `web/scripts/check-reservations-journey-playwright.mjs` to validate pickup add-on delivery-address guardrails and capture screenshot artifacts.
- 2026-02-22: Added optional deep-lane wiring in `scripts/run-journey-suite.mjs` (`portal reservations journey playwright (optional)` step).
- 2026-02-23: Promoted deep-lane reservations Playwright coverage to required mode via `MF_REQUIRE_RESERVATIONS_PLAYWRIGHT=1`, with CI secret/target wiring in `.github/workflows/ci-smoke.yml`.
