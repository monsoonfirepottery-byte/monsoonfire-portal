# P1 — Source-of-Truth Deployment Gate Matrix

Status: Completed
Date: 2026-02-18
Priority: P1
Owner: Platform + SRE + Release
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

Deployment assumptions are spread across workflows, docs, and scripts without a single source-of-truth gate matrix.
This leaves gaps where staging/production targets and smoke targets diverge from actual runbook intent.

## Objective

Build one deployment gate matrix that enforces consistency among workflow targets, host contracts, and smoke command expectations.

## Scope

- `.github/workflows/ci-smoke.yml`
- `.github/workflows/portal-prod-smoke.yml`
- `.github/workflows/website-prod-smoke.yml`
- `.github/workflows/ios-build-gate.yml`
- `.github/workflows/ios-macos-smoke.yml`
- `docs/EMULATOR_RUNBOOK.md`
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`
- `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`
- `scripts/studio-cutover-gate.mjs`
- `scripts/pr-gate.mjs`
- `website/.well-known/apple-app-site-association`
- `website/.well-known/assetlinks.json`

## Tasks

1. Define deployment gate matrix input schema:
   - environment names (`staging`, `beta-pilot`, `production`, `store-readiness`)
   - required smoke and validation checks per environment
   - required target hosts and callbacks
2. Implement `scripts/source-of-truth-deployment-gates.mjs` that:
   - reads matrix definition
   - executes host/build/workflow compatibility assertions
   - returns machine-readable blocker reasons
3. Connect matrix execution into `scripts/pr-gate.mjs` and platform CI targets.
4. Add matrix-backed evidence artifact for every gate run.
5. Add clear recovery instructions in deployment runbooks when gates fail.

## Acceptance Criteria

1. Gate matrix executes as part of PR gate and at least one CI smoke entrypoint.
2. Missing or mismatched deployment targets fail with explicit reason and owning artifact.
3. Local and CI gate runs produce matching artifact structure.
4. Matrix is updated atomically with `tickets` and deployment file edits.

## Dependencies

- `.github/workflows/*.yml`
- `scripts/pr-gate.mjs`
- `scripts/studio-cutover-gate.mjs`
- `docs/EMULATOR_RUNBOOK.md`
- `website/.well-known/*`
