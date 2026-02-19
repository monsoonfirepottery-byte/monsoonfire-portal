# P2 — Phased Beta Release Gates and Smoke Paths

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Product + Platform + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

Beta-phased rollout currently mixes staging/prod smoke expectations and does not have a single authoritative smoke-path contract.
This creates false confidence for one phase and blind spots in another.

## Objective

Define a phase-aware smoke graph so each rollout phase enforces the right evidence while sharing the same source-of-truth inputs.

## Scope

- `.github/workflows/ci-smoke.yml`
- `.github/workflows/portal-prod-smoke.yml`
- `.github/workflows/website-prod-smoke.yml`
- `scripts/studiobrain-cutover-gate.mjs`
- `scripts/pr-gate.mjs`
- `scripts/portal-playwright-smoke.mjs`
- `scripts/website-playwright-smoke.mjs`
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`
- `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`

## Tasks

1. Define phase matrix:
   - `staging`
   - `beta-pilot`
   - `production`
   - `store-readiness`
2. Map required smoke commands and strictness per phase.
3. Add `scripts/phased-smoke-gate.mjs` that emits per-phase pass/fail evidence.
4. Update CI and PR gate to call the appropriate phase profile.
5. Document rollback criteria and evidence package required before advancing phase.

## Acceptance Criteria

1. Phase gate fails if required phase smoke checks are skipped or non-blocking by default.
2. Phase artifacts include selected phase, command list, failure class, and blocker reason.
3. PR gate and release workflows consume the same phase profile.
