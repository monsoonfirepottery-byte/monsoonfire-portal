# P2 — Env Contract Schema and Runtime Validation for Studiobrain

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Environment drift is currently tolerated in practice: missing keys, stale defaults, and conflicting host values can survive until runtime, causing late failures and opaque smoke regressions.

## Objective

Create a single contract for environment/state assumptions and enforce it before startup, during smoke, and before promotion of any local/studiobrain flows.

## Scope

- `studio-brain/.env.contract.schema.json` (new)
- `studio-brain/scripts/preflight.mjs`
- `studio-brain/src/config/env.ts`
- `scripts/start-emulators.mjs`
- `scripts/test:automation:bundle` flow

## Tasks

1. Define a single environment contract schema for:
   - required vars
   - host/URL vars
   - port contracts
   - optional service toggles
2. Validate the contract in:
   - studio-brain preflight
   - local emulator bootstrap
   - portal/functions smoke prechecks
3. Add deterministic failure output:
   - missing/unknown variable report
   - conflicting host pair report (`localhost`/`127.0.0.1`/custom aliases)
   - suggested remediation from matrix
4. Add a `npm run env:validate` command with machine-readable output for automation.
5. Add a compatibility shim mode for staged migration:
   - warns on legacy var names
   - documents removal date

## Acceptance Criteria

1. Missing or invalid env state fails fast with actionable error output.
2. Contract validation runs in preflight and smoke paths for both clean and restored environments.
3. Contract file can be regenerated from current usage without manual guessing.
4. All local modes share one contract source, and no other env source becomes authoritative.

## Dependencies

- `studio-brain/.env.example`
- `studio-brain/.env.contract.schema.json`
- `studio-brain/src/config/env.ts`
- `studio-brain/scripts/preflight.mjs`
- `scripts/start-emulators.mjs`
- `scripts/portal-playwright-smoke.mjs`

## Definition of Done

- A single validated contract exists and is enforced before critical local tasks.
- Deviations produce immediate, clear remediation guidance.
- The team documents contract ownership and update process.

## Progress Notes (2026-02-18)

- Contract validation is now stricter in critical preflight and gate paths:
  - `studio-brain/scripts/preflight.mjs` uses strict validation.
  - `scripts/studiobrain-status.mjs` is strict in gate mode (`--gate`) and when `STUDIO_BRAIN_STATUS_STRICT=true`.
  - `scripts/pr-gate.mjs` and `scripts/studio-cutover-gate.mjs` run `env:validate --strict --json`.
- Placeholder and template-value detection has explicit sensitive-var enforcement in `studio-brain/src/config/env.ts` and `studio-brain/scripts/env-contract-validator.mjs`.
- Contract checks now cover PR/reliability surfaces and block invalid env before merge-relevant flows.

## Evidence

1. `npm --prefix studio-brain run env:validate -- --strict --json`
2. `npm run pr:gate -- --json` (env contract step)
3. `npm run reliability:once -- --json` (env contract + status gate integration)
