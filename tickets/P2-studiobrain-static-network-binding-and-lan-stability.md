# P2 — Studiobrain Static Network Binding and LAN Stability

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

The Studiobrain box currently runs on DHCP (wireless) and can change IP over time. A stable local identity is important for onboarding scripts, smoke targeting, and website deployment from that machine.

## Objective

Add a stable networking profile that avoids DHCP dependency for local toolchains while keeping loopback behavior unchanged for on-host development.

## Scope

- Host naming and identity for cutover commands:
  - local loopback profile
  - LAN profile via hostname/alias
- `website` deploy/smoke target references
- emulator and studio-brain endpoint contracts
- onboarding and recovery docs

## Tasks

1. Define a migration policy for host identity:
   - `127.0.0.1` / `localhost` for local-only flows
   - `studiobrain.local` (or equivalent stable DNS alias) for LAN/deployment flows
   - optional fixed DHCP reservation as fallback on supported routers
2. Add a dedicated "network profile" doc section to:
   - `docs/EXTERNAL_CUTOVER_EXECUTION.md`
   - `docs/EMULATOR_RUNBOOK.md`
   - cutover epic runbook notes
3. Update relevant scripts to consume host identity from env vars rather than literal IP literals:
   - Studio Brain base URL
   - website deploy target host
   - emulator smoke host defaults
4. Add validation check for mismatched profile selection (for example accidental use of loopback host in remote/delegated flows).
5. Include rollback plan for when static assignment is not possible:
   - explicit `DHCP_HOST` profile
   - host-only fallback checks
   - manual override variable

## Acceptance Criteria

1. A migration guide documents how to set stable LAN identity in one DHCP or one static mode.
2. On a clean checkout, the documented network profile can be toggled without code changes.
3. No deployment/smoke script requires a raw changing laptop IP.
4. Network-profile checks are part of onboarding validation.

## Dependencies

- `AGENTS.md`
- `studio-brain/.env.example`
- `docs/EMULATOR_RUNBOOK.md`
- `docs/EXTERNAL_CUTOVER_EXECUTION.md`
- `website/deploy.ps1`
- `scripts/website-playwright-smoke.mjs`
- `scripts/portal-playwright-smoke.mjs`
- `studio-brain/src/config/env.ts`

## Definition of Done

- Host identity policy is documented as a required onboarding choice.
- Commands are stable under DHCP churn using the selected profile.
- Validation output tells operators whether they are running in local-loopback or LAN-stable profile.

## Work completed

- Implemented static-LAN profile activation for Studiobrain host identity:
  - `studio-brain/.env.network.profile`
    - `STUDIO_BRAIN_NETWORK_PROFILE=lan-static`
    - `STUDIO_BRAIN_STATIC_IP=192.168.1.226`
- Extended network profile contract and fallback support:
  - `scripts/studio-network-profile.mjs`
    - added profile alias support: `dhcp-host` -> `lan-dhcp`
    - added `STUDIO_BRAIN_DHCP_HOST` fallback routing for DHCP-host workflows
    - improved host source reporting for static vs DHCP sources
    - removed noisy derived-host warning so strict gates pass on valid profile-driven hosts
- Added DHCP-host variable to runtime contract surfaces:
  - `studio-brain/.env.example`
  - `studio-brain/.env.contract.schema.json`
  - `studio-brain/src/config/env.ts`
- Updated website deployment script to consume network profile host contract:
  - `website/scripts/deploy.mjs`
    - derives deploy server from `WEBSITE_DEPLOY_USER@<resolved_profile_host>` when `WEBSITE_DEPLOY_SERVER` is unset
- Added and expanded runbook coverage for static and DHCP fallback modes:
  - `docs/EXTERNAL_CUTOVER_EXECUTION.md`
  - `docs/EMULATOR_RUNBOOK.md`
  - `docs/studiobrain-host-url-contract-matrix.md`

### Evidence commands

- `npm run studio:network:check -- --gate --strict --write-state --json --artifact output/studio-network-check/manual-static-lan.json`
  - PASS (`networkProfile=lan-static`, `host=192.168.1.226`, no warnings/issues)
- `STUDIO_BRAIN_NETWORK_PROFILE=lan-static VITE_DEV_HOST=192.168.1.226 VITE_ALLOWED_HOSTS=192.168.1.226,studiobrain.local,localhost VITE_FUNCTIONS_PROXY_TARGET=http://192.168.1.226:5001/monsoonfire-portal/us-central1 VITE_STUDIO_BRAIN_PROXY_TARGET=http://192.168.1.226:8787 npm run studio:stack:profile:snapshot:strict -- --json --artifact output/studio-stack-profile/static-lan.json`
  - PASS (`resolvedHost=192.168.1.226`, proxy targets aligned)
