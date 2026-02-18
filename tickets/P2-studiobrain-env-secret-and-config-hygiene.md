# P2 — Environment and Secret Hygiene for Studiobrain Cutover

Status: In Progress
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
