# Swarm Board

Date: 2026-02-25  
Use this board for daily execution and ticket routing.

## Current Focus (2026-02-25)
- Epic 06 backlog hygiene pass executed on 2026-02-25:
  - Audit artifact: `docs/sprints/EPIC_06_BACKLOG_AUDIT_2026-02-25.md`
  - Reconciliation runbook: `docs/sprints/BOARD_RECONCILIATION_RUNBOOK.md`
  - Sprint 10/11 mapping artifact: `docs/sprints/SPRINT_10_11_GAP_MAPPING_2026-02-23.md`
  - Scope filter applied: ignore tickets associated with closed epics
- Epic 07 Studiobrain cutover execution is complete:
  - Cutover decision: `GO` (executed on 2026-02-19)
  - Runtime target: `127.0.0.1:8787`
  - Gate evidence: `artifacts/pr-gate.json`, `output/stability/heartbeat-summary.json`, `output/cutover-gate/summary.json`
- P0 alpha closures (ship-stoppers):
  - `tickets/P0-alpha-drills-real-auth.md`: run live drill suite with real staff auth (production evidence)
  - `tickets/P1-prod-auth-oauth-provider-credentials.md`: create provider apps (Apple/Facebook/Microsoft) and paste IDs/secrets into Firebase Auth providers
- Ticket reconciliation update:
  - `tickets/P0-portal-hosting-cutover.md` is `Completed` and removed from the open-ticket queue.
- Sprint 12 (Mobile translation risk register) has shipped repo-side deliverables:
  - S12-01 through S12-06 ticket files are `Completed`
  - Remaining unblockers are external console operations for provider/domain configuration

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

## Open Tickets (Filtered, In Scope)
- Scope filters:
  - Ignore tickets associated with closed epics.
- `P0` (`blocked`): `tickets/P0-alpha-drills-real-auth.md` (requires real production staff token path)
- `P1` (`blocked`): `tickets/P1-prod-auth-oauth-provider-credentials.md` (provider console/firebase console dependency)
- Note: completed S12 tickets were removed from this open-ticket section during the 2026-02-22 reconciliation pass; the portal hosting cutover row was removed during the 2026-02-25 reconciliation pass.

## Reconciliation Cadence
- Monthly:
  - Run `node ./scripts/epic-hub.mjs status`.
  - Run `node ./scripts/epic-hub.mjs next`.
  - Run `node ./scripts/backlog-hygiene-audit.mjs --markdown --out docs/sprints/EPIC_06_BACKLOG_AUDIT_YYYY-MM-DD.md`.
  - Confirm every ticket in "Open Tickets" has:
    - an existing `tickets/*.md` file
    - `Parent Epic` metadata (if it is still active)
    - owner + priority
  - Execute and log reconciliation outcomes in `docs/sprints/BOARD_RECONCILIATION_RUNBOOK.md`.

## Ops Blockers (Do Outside Repo)
- OAuth providers: finish Apple/Facebook provider app setup and paste credentials into Firebase Auth provider settings
- Firebase Auth domains: confirm required production authorized domains remain configured
- Production drill execution: obtain a real staff Firebase ID token and run the live drill evidence capture window

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
