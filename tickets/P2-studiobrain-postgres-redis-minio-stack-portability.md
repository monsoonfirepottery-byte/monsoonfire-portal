# P2 — Portable Postgres/Redis/MinIO Stack for Studiobrain

Status: Completed
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

## Work completed

- Reworked `studio-brain/scripts/preflight.mjs` to be portability-focused:
  - auto-loads `.env` (or `.env.example` fallback)
  - probes all required dependencies (`postgres`, `redis`, `minio`)
  - prints clear PASS/FAIL per dependency with service-specific remediation steps
  - preserves host-profile warnings and guardrail summary output
- Removed import side-effects from `scripts/stability-guardrails.mjs` so importing `runGuardrails()` no longer executes CLI output unexpectedly.
- Updated `studio-brain/docker-compose.yml` to support explicit env overrides while preserving defaults:
  - `PG*` for Postgres configuration
  - `REDIS_PORT`
  - `STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY` / `STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY`
  - optional `MINIO_API_PORT` / `MINIO_CONSOLE_PORT`
- Updated `studio-brain/.env.example` with valid local-stack defaults for required dependencies and added MinIO port override keys.
- Updated `studio-brain/Makefile` to default `ENV_FILE` to `.env` when present, otherwise `.env.example`, so dependency bring-up works from clean checkout without extra edits.
- Added `STUDIO_BRAIN_SWARM_RUN_ID` to `studio-brain/.env.contract.schema.json` to remove false warning drift in preflight contract validation.
- Replaced `studio-brain/docs/SWARM_BACKEND_SETUP.md` with a single stable contract runbook that now includes:
  - canonical ports and startup order
  - from-zero sequence
  - local vs LAN host mapping
  - health endpoint references
  - migration/recovery notes for stale volumes, credential mismatch, and port collisions

### Evidence commands

- `npm --prefix studio-brain run compose:validate`
- `npm --prefix studio-brain run preflight`
  - correctly surfaced MinIO host-port conflict path with actionable remediation
- `MINIO_API_PORT=9010 MINIO_CONSOLE_PORT=9011 make -C studio-brain dev-up`
- `STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT=http://127.0.0.1:9010 MINIO_API_PORT=9010 MINIO_CONSOLE_PORT=9011 npm --prefix studio-brain run preflight`
  - passed dependency probes and guardrails using explicit env override path
