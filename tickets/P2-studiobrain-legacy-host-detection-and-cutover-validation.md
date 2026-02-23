# P2 — Legacy Host Detection and Cutover Validation for Studiobrain Migration

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Migration paths still mix local and remote host assumptions in scripts, docs, and smoke checks. This makes cutover brittle because stale host literals can pass casual verification but fail on the new host profile.

## Objective

Create a deterministic, reviewable validation step that detects host/URL drift before onboarding and before any local smoke is considered authoritative.

## Scope

- `scripts/portal-playwright-smoke.mjs`
- `scripts/website-playwright-smoke.mjs`
- `scripts/start-emulators.mjs`
- `web/vite.config.js`
- `web/scripts/dev.mjs`
- `studio-brain/src/config/env.ts`
- `scripts/*.ps1` launchers and their Node equivalents
- Docs/runbooks referenced during local onboarding

## Tasks

1. Create a host-contract scanner script, e.g. `scripts/scan-studiobrain-host-contract.mjs`.
2. Define forbidden/legacy patterns with severity:
   - explicit `wuff-laptop` assumptions
   - hard-coded `localhost`/`127.0.0.1` in prod-bound contracts
   - missing canonical environment variables for local-only vs production flows
   - credentials and host hardcodes in script files
3. Add allowlist exceptions by file for intentional localhost-only behavior (for example local unit tooling or mock harnesses).
4. Integrate scanner into:
   - root onboarding commands
   - smoke orchestration command chain
   - PR/checklist documentation so merge cannot proceed without review
5. Add a clear "expected result" report format:
   - file
   - line/range
   - detected token
   - required fix category

## Acceptance Criteria

1. Legacy host assumptions are visible in a single command output with machine-readable and human-readable formats.
2. The validation command fails when forbidden host assumptions affect production or cross-machine workflows.
3. Known intentional localhost-only cases pass through explicit allowlist with comments and owners.
4. Runbook says "clean" only when host detection and smoke checks both pass.
5. A reviewer can execute one command to validate the host contract before opening the local stack.

## Dependencies

- `scripts/start-emulators.mjs`
- `scripts/portal-playwright-smoke.mjs`
- `scripts/website-playwright-smoke.mjs`
- `web/scripts/dev.mjs`
- `web/src/utils/studioBrain.ts`
- `web/src/utils/functionsBaseUrl.ts`
- `studio-brain/src/config/env.ts`
- `docs/EMULATOR_RUNBOOK.md`
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`
- `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`

## Definition of Done

- Scanner file exists and is referenced from one documented onboarding command.
- Ticket closes only with documented evidence from one clean output run and one fail-mode capture (intentional regression fixture).
- No new wildcard bypasses are added without explicit exception documentation and owner.

## Work completed

- Confirmed host-contract scanner implementation and gate wiring:
  - `scripts/scan-studiobrain-host-contract.mjs`
  - `npm run studio:host:contract:scan`
  - `npm run studio:host:contract:scan:strict`
  - integrated in `scripts/pr-gate.mjs` and `scripts/studio-cutover-gate.mjs`
- Added deterministic evidence harness for clean + intentional fail-mode capture:
  - `scripts/capture-host-contract-evidence.mjs`
  - `npm run studio:host:contract:evidence`
  - artifact: `output/host-contract-evidence/latest.json`
- Added scanner exception metadata (owner + reason) for the evidence harness token fixture so the harness itself remains scannable without weakening production-path checks.
- Updated runbooks to require host-contract evidence in onboarding/PR flows:
  - `docs/EMULATOR_RUNBOOK.md`
  - `docs/runbooks/PR_GATE.md`
