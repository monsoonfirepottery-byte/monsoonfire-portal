# P2 — Vite Local Hosting and Proxy Migration to Studiobrain Workflows

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Portal
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem
Portal local dev currently uses mixed launch assumptions for Vite and backend proxy targets, which makes host/port drift likely when moving away from Windows-only defaults.

## Objective
Migrate local Vite dev setup and proxy behavior to a studiobrain-first, host-stable model that is reproducible on Linux/macOS.

## Scope
- `web/vite.config.js` proxy/host/allowedHosts behavior.
- `web/package.json` scripts for local dev/test parity.
- `web/.env.local` local base URLs and emulator toggles.
- Local automation entrypoints that depend on emulator-backed API calls.

## Tasks
1. Audit Vite dev scripts and configuration for hard-coded host assumptions.
2. Define a canonical local host policy (`127.0.0.1` + `localhost` aliases as needed) and document it, including studio-lab LAN exceptions where applicable.
3. Update Vite proxy targets to consume environment-derived Studio Brain and Functions URLs.
4. Align script-level runbook paths with studiobrain-first commands and remove legacy host assumptions.
5. Add a smoke checklist step validating:
   - Vite starts on expected port.
   - Proxy rewrites to local/studio endpoints work.
   - `/readyz` and relevant `/api/*` checks pass from browser smoke path.
6. Add profile routing for local-only vs LAN deployment scenarios:
   - local loopback default
   - optional LAN hostname for remote smoke/deployment checks

## Acceptance Criteria
1. Vite and API proxy behavior are consistent across new studiobrain hosts.
2. Local startup no longer depends on legacy wuff-laptop host conventions.
3. Local dev and portal automation smoke paths share one host/endpoint convention.
4. Any host mismatch is explicitly rejected by smoke/validation checks.
5. The LAN profile path is documented and stable without code edits for DHCP environments.

## Work completed

- Added environment-driven Vite host/allowed-host configuration in `web/vite.config.js` (`VITE_DEV_HOST`, `VITE_ALLOWED_HOSTS`) to support Studio Brain LAN/stability workflows without code edits.
- Extended `web/.env.local.example` with matching Vite host/allowed-host hints for onboarding.
- Added deterministic Vite dev proxy contract in `web/vite.config.js`:
  - `/__functions/*` -> env-derived Functions target
  - `/__studio-brain/*` -> env-derived Studio Brain target
  - explicit `VITE_PORT` + `strictPort` path for stable local startup behavior
- Updated `web/scripts/dev.mjs` to inject profile-derived proxy defaults (`VITE_FUNCTIONS_PROXY_TARGET`, `VITE_STUDIO_BRAIN_PROXY_TARGET`) and canonical port when unset.
- Expanded stack profile validation (`scripts/studio-stack-profile-snapshot.mjs`) to enforce:
  - Vite dev port contract (`5173` default)
  - Vite proxy target host policy for local vs LAN profiles
  - remote profile rejection of loopback proxy targets
- Added local deep-smoke command aliases in root `package.json`:
  - `portal:smoke:playwright:local`
  - `portal:smoke:playwright:local:deep`
- Added Studiobrain-first dev script alias in `web/package.json`:
  - `npm --prefix web run dev:studiobrain`
- Updated host/runbook docs with Vite proxy contract and smoke checklist:
  - `docs/studiobrain-host-url-contract-matrix.md`
  - `docs/EMULATOR_RUNBOOK.md`

## Dependencies
- `web/vite.config.js`
- `web/package.json`
- `web/.env.local`
- `scripts/check-studio-brain-bundle.mjs`
- `tickets/P2-studiobrain-firebase-emulator-hosting-and-urls.md`
