# Monsoon Fire Portal Documentation

This folder contains the current integration references for the project.

## Testing URLs

- Production app: `https://monsoonfire-portal.web.app`
- Firebase Hosting fallback: `https://monsoonfire-portal.firebaseapp.com`
- Direct function endpoint: `https://us-central1-monsoonfire-portal.cloudfunctions.net/websiteKilnBoard`
- Local Firebase hosting emulator: `http://127.0.0.1:5000`
- Local Vite dev server: `http://localhost:5173`

## What to read first

- `web/README.md`  
  Dev runbook for web setup, Vite + Firebase Functions env switching, and emulator workflow.
- `ios/README.md`  
  iOS API-layer setup, contracts alignment, and smoke-test guidance.
- `docs/API_CONTRACTS.md`  
  Canonical API contract reference for request/response shapes and environment behavior.
- `docs/DEEP_LINK_CONTRACT.md`  
  Canonical deep-link contract for web + native clients.
- `docs/SOURCE_OF_TRUTH_INDEX.md`  
  Source-of-truth registry for contract/deployment gate wiring.
- `docs/MILESTONE_2026-01-19.md`  
  Milestone history and implementation notes.

## One-minute startup checklist

1. Install dependencies for the web client and run dev server (see `web/README.md`).
2. Confirm your target backend environment (prod vs emulator).
3. Verify you can read required toolchain binaries:
	- `command -v ufw fail2ban-client jq tmux git rg ffmpeg python3 pip3`
4. Use `docs/API_CONTRACTS.md` for exact payloads before touching client call sites.

## Automation commands

- `npm run test:automation`  
  Full local/CI-ready validation bundle:
  - unit tests (`functions`, `studio-brain`, `web`)
  - functions CORS smoke
  - website + portal Playwright smoke
  - portal production bundle readiness guard
  - web accessibility smoke
- `npm run test:automation:deep`  
  Extends `test:automation` with explicit production-gated CORS options and deep portal endpoint probes.
- `npm run test:automation:bundle`  
  Build portal bundle and assert no localhost Studio Brain backend references are shipped.
- `npm run test:automation:ui:deep`  
  Deep portal browser probes only (`/readyz`, backend function probes, critical endpoint capture).
- `npm run source:truth:contract:strict`  
  Contract parity matrix for web/native/backend and API route drift.
- `npm run source:truth:deployment`  
  Deployment target and profile matrix checks for staging/beta/production/store-readiness.
- `npm run smoke:phased`  
  Phase-aware smoke matrix validation.
- `npm run mobile:store-readiness`  
  Deep-link + `.well-known` + mobile parity validation.
- `npm run epics:agentic:run`  
  Emit an agentic dispatch manifest for blocker epics `1-8` in JSONL for autonomous ticket execution.
- `npm run epics:agentic:run:md`  
  Emit the same agentic dispatch for blocker epics `1-8` as markdown artifacts under `output/epic-hub-runner/<run-id>/`.

## iOS contract parity

Keep `ios/PortalModels.swift` aligned with `web/src/api/portalContracts.ts` whenever client contracts change.
