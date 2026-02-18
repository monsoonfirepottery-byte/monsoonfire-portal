# P2 — Host Network Profile Contract for Studiobrain

Status: In Progress
Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Local flows currently mix host assumptions across scripts and docs, and network identity changes (especially on DHCP) cause silent drift.

## Objective

Define explicit network profiles and enforce their selection across all startup/smoke scripts.

## Scope

- `studio-brain/.env.network.profile`
- `studio-brain/scripts/preflight.mjs`
- `scripts/start-emulators.mjs`
- `scripts/portal-playwright-smoke.mjs`
- `scripts/website-playwright-smoke.mjs`

## Tasks

1. Add explicit profile model:
   - `local` (`127.0.0.1`/`localhost`)
   - `lan-static` (`studiobrain.local` + optional static IP binding)
   - `lan-dhcp` (DHCP + host snapshot)
   - `ci` (non-persistent contract)
2. Add a single source resolver:
   - derived host vars exported by preflight
   - script consumption from resolver only
3. Add mismatch detection:
   - wrong host mode for selected flow
   - stale mDNS/DHCP profile mismatch
4. Add profile transition docs:
   - local to LAN switch
   - LAN-to-local fallback
5. Add guardrails for unsupported profile combinations (for example remote flows with loopback-only host contracts).

## Acceptance Criteria

1. Profiles can be switched without editing scripts or changing host literals.
2. Preflight blocks incompatible host combinations.
3. Smoke scripts consume host variables from the same resolved profile object.
4. DHCP profile includes explicit warnings and fallback behavior.

## Dependencies

- `docs/EXTERNAL_CUTOVER_EXECUTION.md`
- `docs/EMULATOR_RUNBOOK.md`
- `studio-brain/src/config/env.ts`
- `studio-brain/scripts/preflight.mjs`
- `scripts/studio-network-profile.mjs`
- `scripts/start-emulators.mjs`
- `scripts/pr-gate.mjs`
- `scripts/studiobrain-status.mjs`

## Work completed

- Added network profile resolver and contract source:
  - `scripts/studio-network-profile.mjs`
  - `studio-brain/.env.network.profile`
- Integrated profile contract into startup and validation:
  - `scripts/start-emulators.mjs` now accepts `--network-profile`, resolves host, and passes `--host` to emulators.
  - `studio-brain/scripts/preflight.mjs` prints host profile context and host mismatch warnings.
  - `scripts/studiobrain-status.mjs` uses profile-resolved defaults when `STUDIO_BRAIN_BASE_URL` is unset.
  - `scripts/pr-gate.mjs` now validates Studio Brain base URLs against resolved profile host allowlist.
  - `scripts/validate-emulator-contract.mjs` now enforces emulator host/port compatibility before gates.

## Definition of Done

- Host identity behaves deterministically from profile selection.
- Profile selection and output are logged for reproducibility.
