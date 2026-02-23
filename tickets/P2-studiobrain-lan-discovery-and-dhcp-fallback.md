# P2 — LAN Discovery and DHCP Fallback for Studiobrain

Status: Completed

## Work completed

- Added DHCP/static-host guidance to `docs/EMULATOR_RUNBOOK.md` with canonical commands and recovery steps for `lan-dhcp` and `lan-static`.
- Kept PowerShell emulator shim as optional compatibility note while keeping Node-first command order explicit.
- Added host-state drift persistence and warnings in `scripts/studiobrain-network-check.mjs` via `.studiobrain-host-state.json`.
- Added cutover checklist updates for static-LAN governance (`192.168.1.226`) and DHCP fallback in `docs/EXTERNAL_CUTOVER_EXECUTION.md`.
- Added reliability/runtime checks that consume the same host-resolution contract.

## Evidence

1. `npm run studio:network:check:write-state -- --strict --json`
2. `npm run studio:network:check:gate -- --strict --json`
3. `npm run reliability:once -- --json`

Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

DHCP address churn creates intermittent failures for scripts that assume a fixed network identity.

## Objective

Create repeatable host discovery and fallback patterns for LAN workflows when static addressing is unavailable.

## Scope

- `studio-brain/.env.network.profile`
- `scripts/network-discovery.mjs` (new)
- `docs/EXTERNAL_CUTOVER_EXECUTION.md`
- `studio-brain/docker-compose.proxy.yml`
- `studio-brain/scripts/preflight.mjs`

## Tasks

1. Add optional discovery flow:
   - resolve configured alias
   - verify reachable host and certificate/port state
2. Add DHCP fallback manifest:
   - record last known host identity
   - warn when host identity changed
3. Add dual-profile guidance:
   - local dev mode
   - LAN deploy/delegate mode
4. Add runbook checks for router reservation or mDNS fallback.
5. Add integration point for website and emulator flows that consume discovered host values.

## Acceptance Criteria

1. LAN mode remains usable when static IP cannot be guaranteed.
2. Host changes emit explicit warnings and remediation steps.
3. Scripts fail fast when alias assumptions are no longer valid.

## Dependencies

- `docs/EMULATOR_RUNBOOK.md`
- `scripts/portal-playwright-smoke.mjs`
- `website/deploy.ps1`

## Definition of Done

- DHCP-only environments have a tested, documented fallback path with minimal manual work.
