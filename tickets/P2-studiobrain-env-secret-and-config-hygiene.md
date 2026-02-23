# P2 — Environment and Secret Hygiene for Studiobrain Cutover

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Security
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Config and secrets templates mix local defaults, examples, and environment assumptions in ways that can silently pass while masking missing values during cutover.

## Objective

Make environment setup explicit and safe on Studiobrain by separating local defaults, required production vars, optional secrets, and host overrides.

## Scope

- `studio-brain/.env.example`
- `studio-brain/src/config/env.ts`
- `functions/.env.local.example`
- `web/.env.local`
- `functions/scripts` or functions startup path
- `scripts/*` entrypoint scripts that consume envs

## Tasks

1. Add clear placeholder markers for all required secrets:
   - `replace_with_local_secret`
   - never silent empty fallback for auth-sensitive values
2. Define and document per-environment variable contracts:
   - required local
   - required staging/prod
   - optional local defaults
   - network/host overrides
3. Add a startup guard for missing placeholders:
   - fail if placeholders are still present in runtime env sets
   - include exact variable name and remediation hint
4. Standardize env precedence across scripts:
   - CLI args
   - `.env(.local)` where used
   - process env
5. Add redaction policy for logs to avoid token leakage while preserving debugability.
6. Add a "copy/update/verify" onboarding step so developers can verify env readiness without deploying.

## Acceptance Criteria

1. No required secret is silently accepted from default placeholder text.
2. A clean startup report includes redacted env status and any blocked secret placeholders.
3. Host/port overrides use explicit variable names and are documented in the same contract as startup commands.
4. Developers can run an env validation command that catches missing secrets before launching dependent services.

## Dependencies

- `studio-brain/src/config/env.ts`
- `studio-brain/.env.example`
- `functions/.env.local.example`
- `functions/src/index.ts` (or equivalent runtime bootstrap)
- `web/.env.local`
- `scripts/preflight` / startup entrypoints

## Definition of Done

- Environment hygiene validation is integrated into startup/onboarding.
- Secret placeholders are never treated as valid operational values.
- The environment contract is stable across platform-specific command paths.

## Progress Notes (2026-02-18)

- Implemented startup-level placeholder guard in `studio-brain/src/config/env.ts` so runtime startup hard-fails when sensitive vars still contain placeholder/template markers.
- Tightened `.env` sample guidance in `studio-brain/.env.example`:
  - `PGPASSWORD=replace_with_local_db_password`
  - `STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY=replace_with_local_minio_access_key`
  - `STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY=replace_with_local_minio_secret_key`
- Preflight, status, and PR/cutover gates now run `env:validate --strict` via updated scripts:
  - `studio-brain/scripts/preflight.mjs`
  - `scripts/studiobrain-status.mjs`
  - `scripts/pr-gate.mjs`
  - `scripts/studio-cutover-gate.mjs`

## Work completed

- Standardized env precedence in emulator startup:
  - `scripts/start-emulators.mjs`
  - now uses `CLI args > process env > .env files` by loading `functions/.env.local` and `web/.env.local` without overriding already-exported env values.
- Strengthened env validation usability on clean checkout:
  - `studio-brain/scripts/validate-env-contract.mjs`
  - now auto-loads `.env` (or `.env.example` fallback), so validation reflects real startup contracts instead of requiring manual export first.
- Improved strict contract semantics:
  - `studio-brain/scripts/env-contract-validator.mjs`
  - strict mode now fails on placeholder/template values and contract mismatches, not merely because sensitive vars are present.
- Added onboarding verification command chain:
  - root `package.json`:
    - `studio:env:validate:strict`
    - `studio:env:verify`
  - verifies env contract, emulator contract, and network profile gate before launch.
- Extended emulator contract validator to read portal env file by default:
  - `scripts/validate-emulator-contract.mjs`
  - loads `web/.env.local` (fallback `web/.env.local.example`) and reports env source in output.
- Updated portal env template to force explicit profile choice instead of implicit loopback assumptions:
  - `web/.env.local.example`
  - defaults to emulator toggles off; local-loopback and LAN/static profiles are documented as explicit uncommented paths.
- Updated onboarding/runbook docs:
  - `docs/EMULATOR_RUNBOOK.md`
  - `studio-brain/docs/ENVIRONMENT_REFERENCE.md`

### Evidence commands

- `npm run studio:env:validate:strict` -> PASS
- `npm run studio:emulator:contract:check:strict` -> PASS (`env source: web/.env.local.example`)
- `npm run studio:env:verify` -> PASS
- `npm run integrity:check:strict` -> PASS
