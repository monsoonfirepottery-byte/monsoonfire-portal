# P2 — Docs-From-Contract Generation for Stable Runtime Docs

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Docs
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Documentation drift happens when host/port/service contracts are edited in code but not mirrored in runbooks.

## Objective

Generate key runbook content from the same runtime contract to reduce duplication and stale references.

## Scope

- `scripts/generate-runtime-docs.mjs` (new)
- `studio-brain/.env.contract.schema.json`
- `studio-brain/.env.network.profile`
- `docs/EMULATOR_RUNBOOK.md`
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`

## Tasks

1. Define contract source for generated docs:
   - host profile map
   - ports and endpoint matrix
   - smoke/health endpoint list
2. Add generator command:
   - `npm run docs:contract`
   - produces a generated docs section or stamp values into templates
3. Add verification command:
   - generated docs hash check
   - failure when generated section is stale
4. Add regeneration checklist for PR workflows.
5. Add clear override behavior for environment-specific examples.

## Acceptance Criteria

1. Critical runbook sections update directly from contract source.
2. Stale/manual edits are detected in CI-like checks.
3. Generated docs are readable and merge-friendly for humans.

## Dependencies

- `studio-brain/.env.contract.schema.json`
- `studio-brain/scripts/preflight.mjs`
- `docs/EMULATOR_RUNBOOK.md`
- `scripts/reliability-hub.mjs`

## Definition of Done

- Contract-driven docs generation reduces drift and maintenance load for environment assumptions.

## Work completed

- Added docs generator:
  - `scripts/generate-runtime-docs.mjs`
  - `npm run docs:contract`
  - `npm run docs:contract:check`
- Added generated runtime contract artifact:
  - `docs/generated/studiobrain-runtime-contract.generated.md`
- Added gate integration:
  - `scripts/pr-gate.mjs` required step (`runtime contract docs freshness`)
  - `scripts/reliability-hub.mjs` warning-level docs freshness check
- Updated runbooks to include generation workflow:
  - `docs/EMULATOR_RUNBOOK.md`
  - `studio-brain/docs/SWARM_BACKEND_SETUP.md`

## Evidence

1. `npm run docs:contract -- --json`
2. `npm run docs:contract:check`
3. `npm run pr:gate -- --json` (step executes; overall gate may still fail on unrelated source-index drift)
