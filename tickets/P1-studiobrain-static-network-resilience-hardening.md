# P1 — Studiobrain Static Network Resilience and Host Identity Hardening

Status: In Progress
Date: 2026-02-18
Priority: P1
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

The Studiobrain host currently sits on DHCP, so IP and hostname assumptions can drift and silently break onboarding, smoke targeting, and website deployment command paths.

## Objective

Create a deterministic host identity pattern (with documented fallback) that keeps studio-brain workflows stable even when DHCP changes the machine’s IP.

## Scope

- `studio-brain/.env.network.profile`
- `scripts/studio-network-profile.mjs`
- `scripts/studiobrain-status.mjs`
- `scripts/start-emulators.mjs`
- `docs/EMULATOR_RUNBOOK.md`
- router/static-IP onboarding notes (new doc section or new guide file)

## Tasks

1. Formalize host modes as operational policy (not just defaults):
   - loopback profile for on-device workflows
   - LAN profile with explicit hostname (example: `studiobrain.local`)
   - static-IP profile for fixed workstation identity
2. Add a documented static-IP setup path:
   - required router DHCP reservation (if supported)
   - required DNS/hosts override approach if static IP assignment is not possible
3. Add a quick host contract check (`npm run studiobrain:network:check`) that:
   - validates profile host resolves
   - warns when loopback-only host is used with remote flows
   - fails cutover commands when profile contract is broken
4. Add a "host drift recovery" section:
   - detection output
   - command sequence to recover without changing script files
   - evidence steps for updating host profile file
5. Define a "golden target" profile checklist for PR reviewers and pair handoff.

## Acceptance Criteria

1. DHCP changes are detected as actionable warnings or hard failures before smoke runs begin.
2. Developers can switch from DHCP to static profile without code edits.
3. No onboarding flow relies on a mutable IP literal in command examples.
4. Recovery from host changes is documented and can be completed in under 10 minutes.

## Dependencies

- `scripts/studio-network-profile.mjs`
- `studio-brain/.env.network.profile`
- `tickets/P2-studiobrain-host-network-profile-contract.md`

## Definition of Done

- Profile policy is documented with explicit command examples.
- Host drift and recovery are part of daily/stable cutover operations.
- New host identity behavior is included in the smoke and status command docs.
