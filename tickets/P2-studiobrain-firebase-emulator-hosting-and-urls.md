# P2 — Firebase Emulator Hosting and URL Contract for Studiobrain Cutover

Status: In Progress
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
