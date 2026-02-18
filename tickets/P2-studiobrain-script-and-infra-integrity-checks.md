# P2 — Script and Infrastructure Integrity Checks for Studiobrain

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Critical scripts and infrastructure files can drift unnoticed, creating hidden breaks in reproducibility and safety assumptions.

## Objective

Add integrity manifests and validation checks for infra-critical files and startup scripts.

## Scope

- `studio-brain/.env.integrity.json` (new)
- `scripts/integrity-check.mjs` (new)
- `studio-brain/scripts/preflight.mjs`
- `studio-brain/docker-compose.yml`

## Tasks

1. Define signed/hashed catalog for critical files:
   - startup scripts
   - compose files
   - preflight and smoke config
2. Add check command:
   - `npm run integrity:check`
   - supports strict and warning modes
3. Integrate check into:
   - preflight
   - reliability loop
   - release/merge readiness checklist
4. Add update flow:
   - command to regenerate manifest
   - explicit reviewer signoff requirement before commit
5. Add bypass mechanism:
   - temporary override with explicit reason and expiry

## Acceptance Criteria

1. Unrecognized file tampering is detected before command execution.
2. Integrity checks provide clear, file-level diff guidance.
3. Override path is auditable and non-silent.

## Dependencies

- `studio-brain/scripts/preflight.mjs`
- `scripts/reliability-hub.mjs`
- `AGENTS.md`

## Definition of Done

- Integrity checks are documented and enforced where risk outweighs convenience.
