# P2 — Firebase Emulator Cleanup and Studiobrain Docs Alignment

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Functions
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem
Firebase emulator startup and host configuration are currently documented and scripted with mixed legacy paths, creating confusion for cross-platform local onboarding and emulator-backed smoke runs.

## Objective
Simplify emulator workflow to a single studiobrain-first runbook with clear host rules, consistent command entrypoints, and no Windows-only dependencies.

## Scope
- `docs/EMULATOR_RUNBOOK.md` and `scripts/start-emulators.mjs`.
- Functions emulator env loading (`functions/.env.local` and related scripts).
- Emulator-dependent portal smoke/check scripts.
- Cutover notes for `VITE_USE_*` flags and emulator URLs.

## Tasks
1. Consolidate local emulator startup commands to cross-platform scripts and defaults.
2. Remove references to legacy/manual host assumptions from emulator docs and runbooks.
3. Standardize auth/firestore/functions URL targets for script-level smoke usage.
4. Ensure PowerShell-only references are replaced or explicitly optional (non-default).
5. Add or refresh validation checks for:
   - Emulator port availability.
   - Auth/Firestore/functions base URL resolution.
   - Smoke script compatibility with Linux/macOS terminals.
6. Extend host stability guidance for DHCP environments:
   - stable local alias for studio-brain-aware operations
   - fallback behavior when machine IP changes

## Acceptance Criteria
1. New developer path to run Firebase emulators works without PowerShell-specific flow.
2. Emulator host/URL usage is documented once and is reused across scripts and docs.
3. Portal/functions smoke scripts explicitly confirm emulator wiring before deep checks.
4. Legacy wuff-laptop emulator dependencies are either removed or clearly marked deprecated.

## Work completed

- Added a canonical emulator host contract table to `docs/EMULATOR_RUNBOOK.md` for auth/firestore/functions/StudioBrain endpoints and LAN profile usage.
- Standardized emulator bootstrap around Node-first entrypoints (`scripts/start-emulators.mjs`) with profile-aware host resolution.
- Added strict emulator contract validation before bootstrap (`scripts/validate-emulator-contract.mjs --strict`).
- Documented profile-aware command matrix and DHCP/static fallback guidance for Studiobrain LAN workflows.
- Added backup + contract-doc maintenance command coverage in runbooks:
  - `npm run backup:verify`
  - `npm run backup:restore:drill`
  - `npm run docs:contract:check`

## Evidence

1. `npm run studio:emulator:contract:check -- --strict --json`
2. `npm run emulators:start -- --network-profile lan-static --only firestore,functions,auth`
3. `npm run studio:stack:profile:snapshot:strict -- --json`

## Dependencies
- `docs/EMULATOR_RUNBOOK.md`
- `functions/package.json`
- `functions/.env.local.example`
- `scripts/start-emulators.mjs`
- `scripts/portal-playwright-smoke.mjs`
- `tickets/P2-studiobrain-vite-local-hosting-and-proxy-migration.md`
