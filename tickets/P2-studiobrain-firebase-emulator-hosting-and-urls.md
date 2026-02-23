# P2 — Firebase Emulator Hosting and URL Contract for Studiobrain Cutover

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Functions + Portal
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Portal devs have multiple ways to start emulator-backed workflows, but URL/env ownership is not unified. This causes mismatched hosts and difficult break/fix loops during cutover.

## Objective

Create one canonical emulator host contract and ensure every run path (web, functions, smoke, and scripts) consumes it.

## Scope

- `firebase.json`
- `scripts/start-emulators.mjs`
- `docs/EMULATOR_RUNBOOK.md`
- `functions/.env.local.example`
- `web/.env.local`
- `web/src/firebase.ts`
- `web/src/utils/functionsBaseUrl.ts`
- `scripts/portal-playwright-smoke.mjs`

## Tasks

1. Define the canonical endpoint contract in one place:
   - Functions emulator URL
   - Auth emulator host/port
   - Firestore emulator host/port
   - Emulator UI host/port
2. Replace spread references in docs and onboarding with this single contract and explicit environment profiles:
   - local loopback profile
   - deep local profile
   - CI profile
3. Update `docs/EMULATOR_RUNBOOK.md` to include:
   - one command matrix
   - one smoke matrix
   - explicit fallback rules when emulators are not running
4. Update scripts to fail fast when contract variables are missing/mis-typed:
   - `VITE_USE_*` toggles
   - `VITE_FUNCTIONS_BASE_URL`
   - `FIRESTORE_EMULATOR_HOST`
5. Add regression check for localhost leakage from production URLs when using emulator profile.

## Acceptance Criteria

1. Emulator endpoints and run commands are sourced from one documented contract.
2. One mismatch between config and actual running emulator is blocked before smoke begins.
3. Portal Playwright smoke and local serve instructions are aligned with the same emulator contract.
4. Emulators can be started and used from a clean Studiobrain checkout without `wuff-laptop`-specific notes.

## Work completed

- Added a canonical host/URL matrix and web onboarding section updates in `docs/EMULATOR_RUNBOOK.md`.
- Added `web/.env.local.example` to standardize emulator/Functions/StudioBrain local contract setup on fresh checkouts.
- Added a dedicated hard-fail validator command (`scripts/validate-emulator-contract.mjs`) and gated it in `scripts/pr-gate.mjs` and `scripts/studio-cutover-gate.mjs` with `npm run studio:emulator:contract:check:strict`.
- Added stricter emulator URL validation in `scripts/validate-emulator-contract.mjs`:
  - emulator mode now fails when `VITE_FUNCTIONS_BASE_URL` points to cloudfunctions production hosts
  - local emulator profile now enforces loopback functions host
  - warns when emulator URL is missing expected regional path shape (`/us-central1`)
- Updated emulator startup to consume the same contract before boot:
  - `scripts/start-emulators.mjs` now loads both `functions/.env.local` and `web/.env.local`
  - runs `scripts/validate-emulator-contract.mjs --strict` before network/profile checks (can be bypassed with `--no-contract-check` for debugging)
- Updated portal smoke preflight alignment:
  - `scripts/portal-playwright-smoke.mjs` now runs strict emulator contract validation before smoke execution
- Expanded local examples and docs for canonical emulator host values and profile command/smoke matrices:
  - `functions/.env.local.example`
  - `docs/EMULATOR_RUNBOOK.md`
  - `docs/studiobrain-host-url-contract-matrix.md`

### Evidence commands

- `npm run studio:emulator:contract:check:strict`
- `VITE_USE_AUTH_EMULATOR=true VITE_AUTH_EMULATOR_HOST=127.0.0.1 VITE_AUTH_EMULATOR_PORT=9099 VITE_FUNCTIONS_BASE_URL=https://us-central1-monsoonfire-portal.cloudfunctions.net node ./scripts/validate-emulator-contract.mjs --strict`
  - confirms production URL leakage is blocked when emulator mode is enabled

## Dependencies

- `scripts/start-emulators.mjs`
- `functions/.env.local.example`
- `web/.env.local`
- `web/src/firebase.ts`
- `web/src/utils/functionsBaseUrl.ts`
- `docs/EMULATOR_RUNBOOK.md`
- `scripts/portal-playwright-smoke.mjs`
- `scripts/website-playwright-smoke.mjs`

## Definition of Done

- Contract file or doc exists with one source-of-truth URL table.
- Contract mismatch is visible in smoke output and documented with exact corrective steps.
- Onboarding docs show the same contract that smoke and launch scripts consume.
