# P2 — Stable Host and URL Contract Matrix for Local Cutover

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Platform + Portal
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem
The repo currently has multiple host/port assumptions across Vite, emulator setup, Studio Brain, and Portal smoke scripts, creating ambiguity during environment onboarding and making manual cutovers error-prone.

## Objective
Create a single authoritative local-host contract and enforce it in scripts and documentation.

## Scope
- Documented host/port contract for: Vite, Functions emulator, Firestore emulator, Auth emulator, Studio Brain, website server, Playwright smoke.
- Shared environment defaults for local-only and staged/dev usage.
- Script-level validation and guardrails when required host vars are missing/misconfigured.
- Canonical machine-network model:
  - loopback (`127.0.0.1` and `localhost`) for same-host dev flows
  - optional LAN identity (`studiobrain.local`) for DHCP-aware multi-device workflows
- Static IP/host guidance for the Studiobrain environment when the machine is not DHCP-stable.

## Tasks
1. Add one canonical source for host defaults (for example a small local contract doc + env template).
2. Standardize `localhost` vs `127.0.0.1` behavior by product area (web app, Studio Brain APIs, smoke scripts, website smoke).
3. Add validation checks to startup/smoke scripts for inconsistent host bindings.
4. Update `scripts` and docs to consume contract values instead of duplicating literals.
5. Add one migration note per affected script/tool (portal, website, studio-brain, firebase emulators).
6. Add a pre-check to fail when a local run is using a stale/unknown Studio Brain host (for example stale `127.0.0.1`/`localhost` assumptions when run is expected from a remote host profile).

## Acceptance Criteria
1. Host and port assumptions are explicit and match across scripts and docs for each target profile.
2. At least one automated check fails fast for unresolved/contradictory local host settings.
3. Local cutover smoke pass with a single, documented workflow profile.
4. No untracked ad-hoc host literals remain in primary developer entrypoint scripts.
5. The contract includes a DHCP/Static-IP fallback policy for Studiobrain and is referenced by onboarding docs.

## Dependencies
- `web/src/firebase.ts`
- `web/src/utils/studioBrain.ts`
- `web/src/utils/functionsBaseUrl.ts`
- `web/scripts/dev.mjs`
- `scripts/start-emulators.mjs`
- `scripts/portal-playwright-smoke.mjs`
- `scripts/website-playwright-smoke.mjs`
- `studio-brain/src/config/env.ts`
- `scripts/test-studio-brain-auth.mjs`
- `studio-brain/.env.example`
- `studio-brain/README.md`
