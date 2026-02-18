# P2 — Script and Infrastructure Integrity Checks for Studiobrain

Status: In Progress
Date: 2026-02-18
Priority: P2
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Critical scripts and infrastructure files can drift unnoticed, creating hidden breaks in reproducibility and safety assumptions.

## Objective

Add integrity manifests and validation checks for infra-critical files and startup scripts.

## Scope

- `studio-brain/.env.integrity.json` (new)
- `scripts/integrity-check.mjs` (new)
- `studio-brain/scripts/preflight.mjs`
- `studio-brain/docker-compose.yml`

## Tasks

1. Define signed/hashed catalog for critical files:
   - startup scripts
   - compose files
   - preflight and smoke config
2. Add check command:
   - `npm run integrity:check`
   - supports strict and warning modes
3. Integrate check into:
   - preflight
   - reliability loop
   - release/merge readiness checklist
4. Add update flow:
   - command to regenerate manifest
   - explicit reviewer signoff requirement before commit
5. Add bypass mechanism:
   - temporary override with explicit reason and expiry

## Acceptance Criteria

1. Unrecognized file tampering is detected before command execution.
2. Integrity checks provide clear, file-level diff guidance.
3. Override path is auditable and non-silent.

## Dependencies

- `studio-brain/scripts/preflight.mjs`
- `scripts/reliability-hub.mjs`
- `AGENTS.md`

## Definition of Done

- Integrity checks are documented and enforced where risk outweighs convenience.

## Work completed

- Added runtime integrity manifest and scanner: `scripts/integrity-check.mjs` + `studio-brain/.env.integrity.json`.
- Integrated integrity validation into critical entrypoints:
  - `scripts/start-emulators.mjs`
  - `studio-brain/scripts/preflight.mjs`
  - `scripts/pr-gate.mjs`
  - `scripts/portal-playwright-smoke.mjs`
  - `scripts/website-playwright-smoke.mjs`
  - `scripts/functions-cors-smoke.mjs`
  - `scripts/studiobrain-status.mjs`
- Added new root commands:
  - `npm run integrity:check`
  - `npm run integrity:check:strict`
  - `npm run integrity:update`
- Documented integrity as part of PR gate and emulator onboarding (`docs/runbooks/PR_GATE.md`, `docs/EMULATOR_RUNBOOK.md`).
