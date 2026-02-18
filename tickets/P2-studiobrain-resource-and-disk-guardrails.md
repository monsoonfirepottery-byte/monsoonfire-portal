# P2 — Resource and Disk Guardrails for Long-Lived Studiobrain Host

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Long-lived local stacks can consume unbounded disk and memory, eventually causing false failures during critical periods.

## Objective

Add explicit resource guardrails and fail-fast checks to keep the host stable and predictable.

## Scope

- `studio-brain/docker-compose.yml`
- `studio-brain/docker-compose.observability.yml`
- `scripts/stability-guardrails.mjs` (new)
- `scripts/reliability-hub.mjs`

## Tasks

1. Add container-level limits and log rotation in compose:
   - max memory/CPU defaults for non-core services
   - bounded container log retention
2. Add disk checks:
   - Docker volume usage threshold
   - logs and output directory size thresholds
3. Add service restart pressure controls:
   - restart policy thresholds
   - debounce windows
4. Add guardrail command:
   - `npm run guardrails:check`
   - integrate into preflight and reliability loop
5. Add remediation actions:
   - safe clean-up mode for stale artifacts
   - warning escalation when hard caps are near

## Acceptance Criteria

1. A host under retention stress provides clear warnings before hard failures.
2. Guardrail checks run automatically in at least one recurring mode.
3. Clean-up actions can be run without taking down core dependencies.
4. Resource caps are documented and justifiable in onboarding docs.

## Dependencies

- `studio-brain/docker-compose.yml`
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`
- `scripts/reliability-hub.mjs`

## Definition of Done

- Stability risks from resource drift are visible and actionable before user-impacting failures.
