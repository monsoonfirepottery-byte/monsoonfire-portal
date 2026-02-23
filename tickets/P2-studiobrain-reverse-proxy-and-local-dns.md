# P2 — Local Reverse Proxy and DNS for Stable Studiobrain Identity

Status: Completed

## Work completed

- Added optional reverse-proxy compose profile at `studio-brain/docker-compose.proxy.yml` without changing direct-host defaults.
- Added route-level proxy contract in `studio-brain/docker/Caddyfile.proxy`:
  - `/studio/*` -> Studio Brain (`:8787`)
  - `/functions/*` -> Functions emulator (`:5001`)
  - `/portal/*` -> Portal Vite dev server (`:5173`)
  - `/healthz` -> proxy health response
- Added one-command proxy lifecycle script `scripts/studiobrain-proxy-bundle.mjs` with `up`, `status`, and `down` subcommands (including `--json` output).
- Added operator command surfaces:
  - `npm run studio:proxy:up|status|down`
  - `make proxy-up|proxy-status|proxy-down`
- Documented route map and optional LAN/static-host usage in:
  - `studio-brain/docs/SWARM_BACKEND_SETUP.md`
  - `docs/EMULATOR_RUNBOOK.md`
  - `studio-brain/README.md`

## Evidence

1. `npm run studio:proxy:up -- --json`
2. `npm run studio:proxy:status -- --json`
3. `curl -fsS http://127.0.0.1:8788/healthz`
4. `npm run studio:proxy:down -- --json`

Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Service entrypoints currently depend on host/port combinations that vary by script and environment, reducing determinism for local operations and previews.

## Objective

Introduce a lightweight reverse proxy and local DNS strategy for stable hostnames and route-level consistency across studio services.

## Scope

- `studio-brain/docker-compose.proxy.yml` (new)
- `studio-brain/docker-compose.yml`
- `studio-brain/.env.network.profile`
- `docs/EXTERNAL_CUTOVER_EXECUTION.md`

## Tasks

1. Add optional reverse proxy profile for local service exposure:
   - studio brain API
   - emulator endpoints
   - portal web
2. Define route map and hostnames in one profile file:
   - loopback profile
   - LAN profile
3. Add local DNS/MDNS identity where feasible:
   - `studiobrain.local` resolution strategy
   - fallback behavior for non-LLM/legacy hosts
4. Align certificates for HTTPS on local previews where practical.
5. Add smoke and docs to consume proxy hostnames by default with profile overrides.

## Acceptance Criteria

1. Optional proxy can be enabled without breaking existing direct-host flows.
2. Service URL contracts become route-based and profile-driven.
3. DNS identity changes are optional, documented, and reversible.
4. Proxy profile starts and stops via one documented command.

## Dependencies

- `studio-brain/docker-compose.yml`
- `studio-brain/Makefile`
- `scripts/start-emulators.mjs`
- `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`

## Definition of Done

- Proxy and DNS profile is documented as optional but validated in dependency and smoke workflows.
