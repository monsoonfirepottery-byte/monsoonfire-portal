# Studiobrain Home Ops Dashboard

This runbook defines the lightweight operator cockpit for long-lived studiobrain residency.

## Command Surface

```bash
npm run ops:cockpit:start
npm run ops:cockpit:status -- --json
npm run ops:cockpit:bundle -- --json
npm run ops:cockpit:stop
npm run ops:cockpit:reset -- --yes-i-know --reason "maintenance-window"
```

## What The Cockpit Tracks

- Latest reliability heartbeat status (`output/stability/heartbeat-summary.json`)
- Ops dashboard state (`output/ops-cockpit/state.json`)
- Latest ops dashboard status (`output/ops-cockpit/latest-status.json`)
- Incident bundle handoff artifacts (`output/incidents/<timestamp>/bundle.json`, `bundle.tar.gz`)

## Status Colors

- `green`: all critical reliability checks pass.
- `yellow`: optional checks are degraded, but critical checks still pass.
- `red`: one or more critical checks failed.
- `gray`: no heartbeat captured yet.

## Recovery Actions

1. `npm run reliability:once -- --json` to refresh current state.
2. `npm run incident:bundle -- --json` to capture triage artifacts.
3. `npm run studio:observability:up` when additional telemetry is needed.
4. `npm run studio:observability:reset -- --yes-i-know --reason "maintenance-window"` after investigation to clear stale local artifacts.

## Evidence Expectations

- Keep `output/stability/heartbeat-summary.json` and latest `output/incidents/.../bundle.json` attached in handoff notes for red/yellow events.
- For PR hardening, include:
  - `artifacts/pr-gate.json`
  - `output/studio-stack-profile/latest.json`
  - `output/backups/latest.json` (backup freshness evidence)
