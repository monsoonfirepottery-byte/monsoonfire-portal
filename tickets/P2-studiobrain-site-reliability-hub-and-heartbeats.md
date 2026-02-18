# P2 — Site Reliability Hub and Heartbeat Checks for Stable Home Residency

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Platform + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Reliability after cutover depends on many moving pieces (portal smoke, website smoke, Studio Brain probes, and emulator readiness). Right now, those checks are manual and not continuously scheduled for a home-hosted machine.

## Objective

Create a "Reliability Hub" that runs scheduled heartbeat checks and publishes a simple operator status page/artifact from the same command contract used for onboarding.

## Scope

- `scripts/cutover-watchdog.mjs` (new)
- `scripts/cutover-watchdog.ps1` (optional compatibility shim)
- `package.json` scripts
- `studio-brain/scripts/soak.mjs`
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`
- `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`
- `docs/EMULATOR_RUNBOOK.md`

## Tasks

1. Add a heartbeat script that validates on a schedule:
   - host contract integrity
   - dependency readiness (`studio-brain`, emulators, site smoke endpoints)
   - API and function probe health
2. Add output artifacts:
   - `output/stability/heartbeat-summary.json`
   - `output/stability/heartbeat-events.log` (append-only)
3. Add a "Reliability Hub" command matrix:
   - `npm run reliability:once`
   - `npm run reliability:watch`
   - `npm run reliability:report`
4. Add an optional auto-escalation hook when critical failures persist:
   - local notification command
   - CI comment/event hook where available
5. Build a lightweight operator card/docs view that reads the latest heartbeat and shows:
   - green/yellow/red status
   - last successful run
   - top 3 unresolved faults
6. Add manual override mode for known maintenance windows to prevent false panic during deployments.

## Acceptance Criteria

1. Reliability Hub can be run as a one-off and as a watch loop.
2. One missed heartbeats due to environment drift blocks "go-live" status.
3. Operators can detect regressions within one cycle without manual log spelunking.
4. Failure artifacts persist across restarts and include actionable remediation notes.
5. Maintenance mode is documented and avoids alert fatigue during planned work.

## Dependencies

- `studio-brain/src/http/server.ts`
- `studio-brain/src/connectivity/healthcheck.ts`
- `studio-brain/src/cli/healthcheck.ts`
- `scripts/portal-playwright-smoke.mjs`
- `scripts/website-playwright-smoke.mjs`
- `scripts/start-emulators.mjs`

## Definition of Done

- A single "health status card" command exists and is used in onboarding handoff.
- Reliability checks are automated enough to catch host contract drift in the first cycle.
- Reliability profile can run independently from manual smoke runs and still reuse shared tokens/hosts.

