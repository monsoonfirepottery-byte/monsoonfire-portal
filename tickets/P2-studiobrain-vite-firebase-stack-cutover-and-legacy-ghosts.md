# P2 — Vite/Firebase Development Stack Cutover and Legacy Ghost Cleanup

Status: Completed
Date: 2026-02-19
Priority: P2
Owner: Platform + Portal + Functions
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

Epic-08 now gates deployment and store-readiness quality, but the developer platform profile for Vite + Firebase emulator hosting still has legacy assumptions and fragmented ownership between studio and website tooling.

## Objective

Create a single source-of-truth profile for local/VPS hosting and emulator contracts so that Vite + Firebase workflow assumptions are treated as deployment evidence, not local folklore.

## Scope

- `web/.env.local.example`
- `web/vite.config.js`
- `website/scripts/deploy.mjs`
- `scripts/start-emulators.mjs`
- `scripts/validate-emulator-contract.mjs`
- `scripts/studio-cutover-gate.mjs`
- `scripts/source-of-truth-deployment-gates.mjs`
- `docs/EMULATOR_RUNBOOK.md`
- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `.github/workflows/ci-smoke.yml`

## Tasks

1. Add an explicit source-of-truth mapping in `docs/SOURCE_OF_TRUTH_INDEX.md` for:
   - Vite dev host/proxy profile
   - Firebase emulator contract profile
   - website deploy target profile
2. Add a deployment gate check that verifies the Vite/Firebase profile is used by at least one canonical smoke/test command set.
3. Remove references to stale localhost/IP assumptions in the stack profile evidence path.
4. Add a compact migration checklist in `docs/EMULATOR_RUNBOOK.md` for moving from laptop-style assumptions to Studiobrain workflow.
5. Require the stack evidence artifact in `scripts/epic-hub.mjs`/`npm run epics` outputs through Epic-08 readiness checks.

## Acceptance Criteria

1. Vite and Firebase emulator assumptions can be pointed at a documented profile file/entry with zero ambiguity.
2. Epic-08 deployment gate fails if any stack profile reference is missing from the profile evidence set.
3. Legacy machine-bound assumptions are either removed or explicitly marked as reviewed exceptions.
4. Onboarding from a fresh checkout can run a known profile without shell-specific assumptions.

## Definition of Done

- Profile mapping exists in `docs/SOURCE_OF_TRUTH_INDEX.md` and is enforced by readiness scripts.
- A test or gate command fails when local stack profile paths are unresolved.
- Evidence output includes at least one generated profile snapshot artifact used by gates.
