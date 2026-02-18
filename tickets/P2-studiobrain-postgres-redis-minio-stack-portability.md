# P2 — Portable Postgres/Redis/MinIO Stack for Studiobrain

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

The local backend stack is functional, but onboarding and stability are still impacted by implicit host assumptions and machine-specific behavior during startup.

## Objective

Make the Postgres/Redis/MinIO path reproducible from a clean Studiobrain checkout regardless of host OS or local LAN quirks.

## Scope

- `studio-brain/docker-compose.yml`
- `studio-brain/Makefile`
- `studio-brain/.env.example`
- `studio-brain/src/config/env.ts`
- `studio-brain/scripts/preflight.mjs`
- `studio-brain/docs/SWARM_BACKEND_SETUP.md`

## Tasks

1. Document a single, stable stack contract in `studio-brain/docs/SWARM_BACKEND_SETUP.md`:
   - ports (`5433`, `6379`, `9000`, `9001`)
   - service startup order
   - expected healthcheck endpoints
2. Ensure every required service dependency can start with defaults only and explicit env overrides:
   - `PGHOST` / `REDIS_HOST` / `STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT`
3. Add a "from zero" sequence section:
   - env copy
   - dependency boot
   - dependency validation
   - studio-brain preflight
   - app startup
4. Improve preflight to:
   - probe PostgreSQL, Redis, and MinIO
   - emit clear remediation hints (not just host/port)
5. Add recovery notes for when services fail during migration:
   - stale volumes
   - credential mismatch
   - port collision with host services
6. Confirm the stack is reproducible when Studio Brain hostname changes and still works from localhost using `.env` values.

## Acceptance Criteria

1. A clean Studiobrain machine can run `make dev-up` and reach ready health for all backend dependencies without manual host edits.
2. Backend dependency failures always include actionable remediation instructions.
3. `scripts/preflight.mjs` and health endpoints identify the dependency that failed in a single glance.
4. `studio-brain/docs/SWARM_BACKEND_SETUP.md` explicitly maps host/port expectations for both local and remote (LAN) workflows.
5. No script or doc references machine-specific host settings in required onboarding paths.

## Dependencies

- `studio-brain/docker-compose.yml`
- `studio-brain/Makefile`
- `studio-brain/scripts/preflight.mjs`
- `studio-brain/docs/SWARM_BACKEND_SETUP.md`
- `studio-brain/src/config/env.ts`
- `studio-brain/README.md`

## Definition of Done

- Stack starts from clean checkout with one canonical startup command.
- All dependency failures are diagnosable from a single preflight run output and one follow-up check.
- Portability issue is linked to ticket evidence and closed with command-level evidence in the rollout runbook.

