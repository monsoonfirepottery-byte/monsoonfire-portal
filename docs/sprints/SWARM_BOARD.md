# Swarm Board

Date: 2026-02-19  
Use this board for daily execution and ticket routing.

## Current Focus (2026-02-19)
- Epic 07 Studiobrain cutover execution is complete:
  - Cutover decision: `GO` (executed on 2026-02-19)
  - Runtime target: `127.0.0.1:8787`
  - Gate evidence: `artifacts/pr-gate.json`, `output/stability/heartbeat-summary.json`, `output/cutover-gate/summary.json`
- P0 alpha closures (ship-stoppers):
  - `tickets/P0-alpha-drills-real-auth.md`: run live drill suite with real staff auth (production evidence)
  - `tickets/P1-prod-auth-oauth-provider-credentials.md`: create provider apps (Apple/Facebook/Microsoft) and paste IDs/secrets into Firebase Auth providers
- Sprint 12 (Mobile translation risk register) is active, but mostly blocked on ops:
  - S12-01: `in_progress` (code/docs done; DNS + Firebase console steps pending)
    - `docs/AUTH_DOMAIN_SETUP.md`, `web/src/firebase.ts` (`VITE_AUTH_DOMAIN`)
  - S12-02: `in_progress` (contract/templates done; real values + deploy pending)
    - `docs/DEEP_LINK_CONTRACT.md`, `website/.well-known/*`
  - S12-06: `done` (B-tier compile gate in CI)
    - `.github/workflows/ios-build-gate.yml`, `ios-gate/`
- Sprint 11 (Perf/testing) is next once P0 auth drills are complete:
  - `docs/sprints/SPRINT_11_PERF_TESTING.md`

## Active Sprints
- Sprint 01: `docs/sprints/SPRINT_01_FOUNDATIONS.md`
- Sprint 02: `docs/sprints/SPRINT_02_CORE_STUDIO.md`
- Sprint 03: `docs/sprints/SPRINT_03_COMMERCE_EVENTS.md`
- Sprint 04: `docs/sprints/SPRINT_04_HARDENING_ALPHA.md`
- Sprint 05: `docs/sprints/SPRINT_05_AUTH_PRODUCTION.md`
- Sprint 06: `docs/sprints/SPRINT_06_DEVICE_RELEASE.md`
- Sprint 07: `docs/sprints/SPRINT_07_PUSH_OPERATIONS.md`
- Sprint 08: `docs/sprints/SPRINT_08_RELEASE_CONTROLS.md`
- Sprint 09: `docs/sprints/SPRINT_09_STABILIZATION_DRILLS.md`
- Sprint 10: `docs/sprints/SPRINT_10_ALPHA_LAUNCH.md`
- Sprint 11: `docs/sprints/SPRINT_11_PERF_TESTING.md`
- Sprint 12: `docs/sprints/SPRINT_12_MOBILE_TRANSLATION_RISKS.md`

## Swarm Allocation
- `Swarm A` (Auth + Contracts + Security):
  - P0/P1 auth drills + provider setup
  - Sprint 12: S12-01, S12-05
- `Swarm B` (Deep Links + Routing):
  - Sprint 12: S12-02
- `Swarm C` (Push + Telemetry):
  - Sprint 12: S12-03
- `Swarm D` (QA + CI + Perf):
  - Sprint 11 perf/testing pass
  - Sprint 12: S12-04, S12-06

## Open Tickets (Reality-Based)
- `P1` (`done`): Epic 07 Studiobrain cutover execution (all go/no-go gates passed on 2026-02-19)
- `P0` (`blocked`): `tickets/P0-alpha-drills-real-auth.md` (requires real production staff token path)
- `P0` (`planned`): `tickets/P0-portal-hosting-cutover.md` (depends on DNS/hosting + signed OAuth domain completion)
- `P0` (`todo`): `tickets/P0-security-advisories-dependency-remediation-2026-02-19.md` (root/functions/studio-brain high vulnerabilities to clear in next session)
- `P1` (`blocked`): `tickets/P1-prod-auth-oauth-provider-credentials.md` (provider console/firebase console dependency)
- `P1` (`done`): `tickets/S12-01-auth-domain-strategy.md`
- `P1` (`done`): `tickets/S12-02-universal-links-and-callbacks.md`
- `P2` (`todo`): `tickets/S12-03-push-lifecycle-and-telemetry-spec.md`
- `P2` (`todo`): `tickets/S12-04-offline-retry-policy.md`
- `P2` (`todo`): `tickets/S12-05-secure-storage-and-session-model.md`
- `P2` (`done`): `tickets/P1-ios-build-gate-btier.md`

## Reconciliation Cadence
- Monthly:
  - Run `node ./scripts/epic-hub.mjs status`.
  - Run `node ./scripts/epic-hub.mjs next`.
  - Confirm every ticket in "Open Tickets" has:
    - an existing `tickets/*.md` file
    - `Parent Epic` metadata (if it is still active)
    - owner + priority
  - Record follow-up entries in `docs/sprints/BOARD_RECONCILIATION_RUNBOOK.md`.

## Ops Blockers (Do Outside Repo)
- DNS: provision `portal.monsoonfire.com` and (recommended) `auth.monsoonfire.com`
- Firebase Auth: add authorized domains (at minimum `portal.monsoonfire.com`, plus `auth.monsoonfire.com` if used)
- OAuth providers: create apps in Apple/Microsoft/Facebook consoles and paste IDs/secrets into Firebase Auth provider settings
- Portal hosting: ensure `/.well-known/*` files are served from the portal origin (not the marketing root)

## Daily Verification Pass
Run on all active branches/tickets:
1. `npm --prefix web run lint`
2. `npm --prefix web run test:run`
3. `npm --prefix web run build`
4. `npm --prefix web run perf:chunks`

## Blocker Escalation Rules
- If a ticket is blocked > 24h:
  - mark `blocked`
  - add dependency + unblock owner
  - Sprint Manager reassigns or splits ticket
- If contract ambiguity exists:
  - update `docs/API_CONTRACTS.md` first
  - pause dependent implementation tickets until aligned

## Emulator Notes
- Some functions depend on Pub/Sub schedules; without the Pub/Sub emulator they will be ignored in local runs.
