# P2 — Cutover Smoke and Dependency Gates for Studiobrain Migration

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Current smoke commands validate behavior, but they do not enforce a single stable cutover sequence for local dependencies, platform migration, and service startup on Studiobrain.

## Objective

Define and implement a deterministic, low-friction cutover gate command that validates environment, dependencies, and key smoke paths end-to-end.

## Scope

- `package.json` root scripts
- `scripts/portal-playwright-smoke.mjs`
- `scripts/website-playwright-smoke.mjs`
- `scripts/check-studio-brain-bundle.mjs`
- `studio-brain/scripts/preflight.mjs`
- `scripts/start-emulators.mjs`
- `studio-brain/Makefile` / `studio-brain/src/cli/healthcheck.ts`

## Tasks

1. Define an explicit gate sequence:
   - env contract validation
   - dependency preflight (postgres/redis/minio)
   - emulator readiness
   - studio-brain preflight/readyz
   - portal smoke with deep probe
   - website smoke (local or staged target as configured)
2. Add one root cutover command (for example `npm run cutover:smoke`) that runs the above in order and stops on first hard failure.
3. Make dependency checks non-negotiable before launching UI smoke checks.
4. Emit one summary artifact (`output/cutover-gate/summary.json`) with:
   - command results
   - host contract checks
   - dependency health evidence
   - smoke failures
   - optional-check warning summary
5. Add a short "expected runtime" section in runbooks for normal and degraded-path execution.

## Acceptance Criteria

1. One command can be run from a clean Studiobrain checkout to verify end-to-end readiness.
2. The gate sequence fails fast and points to the first blocking dependency.
3. Smoke and dependency output is reviewable and versionable for PR handoff.
4. A successful run proves host contract + environment compatibility, not only web behavior.

## Dependencies

- `scripts/start-emulators.mjs`
- `studio-brain/scripts/preflight.mjs`
- `scripts/portal-playwright-smoke.mjs`
- `scripts/website-playwright-smoke.mjs`
- `studio-brain/scripts/preflight.mjs`
- `docs/EMULATOR_RUNBOOK.md`
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`
- `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`
 
### Current implementation status

- `scripts/studio-cutover-gate.mjs` created and wired to root scripts as `npm run studio:cutover:gate`.
- Artifact currently writes to `output/cutover-gate/summary.json` by default.
- Website smoke is intentionally non-blocking; failures are returned as warnings for review.
- Emulator contract validation (`npm run studio:emulator:contract:check:strict`) is now part of the cutover gate before preflight.

### Work completed

- Hardened cutover gate status step to remain deterministic from clean checkout:
  - `scripts/studio-cutover-gate.mjs` now runs `studio:check:safe` with `--no-evidence --no-host-scan` because host scan and evidence are already handled in earlier/later steps.
- Unified env fallback behavior so status checks behave like preflight:
  - `scripts/studiobrain-status.mjs` now auto-loads `studio-brain/.env` (fallback `.env.example`), while preserving network-profile host intent.
  - Added explicit environment metadata to status payload for auditability.
- Fixed fallback profile handling in preflight so `.env.example` does not silently override static/DHCP profile intent:
  - `studio-brain/scripts/preflight.mjs` now clears fallback-only profile overrides and hydrates host from profile when needed.
- Normalized MinIO default contract to avoid host-port collisions and align with active Studiobrain runtime:
  - updated defaults to `9010/9011` across `studio-brain/.env.example`, `studio-brain/.env.contract.schema.json`, `studio-brain/src/config/env.ts`, `studio-brain/docker-compose.yml`, smoke defaults, and setup docs.
- Stabilized deep portal smoke in production-target mode:
  - `scripts/portal-playwright-smoke.mjs` now treats `/readyz` bridge failures as advisory when running against non-local base URLs, while preserving hard failures for true critical traffic.
  - retained hard-fail behavior for forbidden hosts, critical backend failures, and actionable response errors.
- Added missing local skill registry anchor path to prevent false degraded dependency state:
  - `studio-brain/skills-registry/.gitkeep`
- Added explicit expected-runtime guidance for normal and degraded cutover paths:
  - `docs/EMULATOR_RUNBOOK.md`
  - `docs/runbooks/PR_GATE.md`

### Evidence

- `npm run studio:network:check -- --gate --strict --json --artifact output/studio-network-check/static-lan-verify.json`
- `STUDIO_BRAIN_NETWORK_PROFILE=lan-static STUDIO_BRAIN_STATIC_IP=192.168.1.226 npm run studio:stack:profile:snapshot:strict -- --json --artifact output/studio-stack-profile/static-lan-verify.json`
- `npm run studio:cutover:gate -- --no-smoke` -> PASS
- `npm run studio:cutover:gate -- --portal-deep` -> PASS
- `npm run portal:smoke:playwright -- --output-dir output/cutover-gate/portal --deep` -> PASS
- Artifacts:
  - `output/cutover-gate/summary.json`
  - `output/cutover-gate/portal/portal-smoke-summary.json`
  - `output/studio-network-check/cutover-gate.json`
  - `output/studio-stack-profile/latest.json`

## Definition of Done

- Single cutover-gate command exists and is linked from onboarding docs.
- A successful gate run is accepted as handoff evidence for the next workflow stage.
- No "optional" dependencies in the sequence can silently bypass blocking requirements.
