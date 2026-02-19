# P2 — Studiobrain Stable Hosting, Static IP, and Network Governance

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Operations
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

Studiobrain currently relies on DHCP behavior in normal laptop-to-home transitions. For long-lived production-like workflows, host stability and deployment predictability improve when host identity governance is explicit and source-of-truth-backed.

## Objective

Define a stable hosting target model (including static IP + hostname strategy), document recovery, and connect checks to Epic-08 readiness gates.

## Scope

- `studio-brain/.env.example`
- `studio-brain/Makefile`
- `studio-brain/scripts/preflight.mjs`
- `studio-brain/docker-compose.yml`
- `scripts/studio-network-profile.mjs`
- `scripts/studiobrain-network-check.mjs`
- `docs/EMULATOR_RUNBOOK.md`
- `scripts/source-of-truth-deployment-gates.mjs`
- `tickets/P2-studiobrain-lan-discovery-and-dhcp-fallback.md` (alignment)

## Tasks

1. Add a short, documented network policy section:
   - default loopback-only behavior for local-only workflows
   - optional LAN profile with static-IP hostname override
2. Define and document static IP/hostname assignment procedure and ownership for Studiobrain.
3. Extend status/network check scripts to validate the host policy contract in readiness gates.
4. Add evidence artifacts showing target mode (`dhcp` vs static), lease checks, and override source.
5. Add monitoring hooks for host-flap or name-resolution failure (if available).

## Work completed

- Added host policy source/target fields in `scripts/studio-network-profile.mjs` and threaded them into network checks.
- Added network target-mode/host-source metadata into `scripts/studiobrain-network-check.mjs` output and lease-change visibility.
- Added explicit static-IP ownership/recovery guidance in `docs/EMULATOR_RUNBOOK.md`.
- Added network policy bootstrap docs in `docs/studiobrain-host-url-contract-matrix.md`.
- Added missing network profile variables to `studio-brain/.env.example` and clarifying comments in `studio-brain/.env.network.profile`.
- Added preflight visibility for network profile target mode and source in `studio-brain/scripts/preflight.mjs`.
- Added source-of-truth deployment gate checks to capture network-provenance fields in `scripts/source-of-truth-deployment-gate-matrix.json`.

## Blockers

- No high-confidence blocker. Remaining work is to add a first-class host lease artifact producer and wire it into `source-of-truth` gates with strict evidence retention checks.

## Acceptance Criteria

1. A clear deployment target policy exists for static IP and DHCP fallback with file-level references.
2. A failed static target or DNS drift is visible in PR/host checks before release smoke.
3. Epic-08 gate artifacts capture chosen Studiobrain profile and verify that profile consistency checks are stable.
4. Onboarding docs include an explicit recovery path when hostname/IP policy changes.

## Definition of Done

- Host profile policy becomes a non-optional evidence item in source-of-truth deployment gates.
- Network identity handling is codified in both docs and check scripts.
- Static IP strategy has an owner, review cadence, and rollback behavior.
