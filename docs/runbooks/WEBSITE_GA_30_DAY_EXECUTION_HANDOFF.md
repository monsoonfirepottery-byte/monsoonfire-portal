# Website GA 30-Day Execution Handoff

## Purpose
Provide a deterministic handoff path so Sprint 1-4 GA automation can be executed quickly once owner-side live exports and experiment outcomes are available.

## Scope
- Ticket: `tickets/P1-website-ga-30-day-priority-roadmap.md`
- Verification command: `npm run website:ga:roadmap:readiness -- --strict`
- Handoff template: `docs/analytics/WEBSITE_GA_LIVE_EXECUTION_HANDOFF_TEMPLATE.md`

## Pre-flight (owner environment)
1. Confirm GA export permissions for the production property.
2. Confirm at least two live experiment windows are complete.
3. Prepare a dated working folder under `artifacts/ga/baseline/<YYYY-MM-DD>/`.
4. Copy and fill `docs/analytics/WEBSITE_GA_LIVE_EXECUTION_HANDOFF_TEMPLATE.md`.

## Required owner-provided inputs
1. `top-acquisition-channels.csv`
2. `landing-pages.csv`
3. `path-to-conversion.csv`
4. `event-audit.csv`
5. `goal-table.csv`
6. Weekly KPI source export
7. Completed handoff template fields for two live experiments

## Execution sequence
1. `npm run website:ga:data-package:check -- --strict`
2. `npm run website:ga:baseline:report -- --strict`
3. `npm run website:ga:funnel:report -- --strict`
4. `npm run website:ga:experiments:backlog -- --strict`
5. `npm run website:ga:content:opportunities -- --strict`
6. `npm run website:ga:dashboard:weekly -- --strict`
7. `npm run website:ga:roadmap:readiness -- --strict`

## Expected outputs
- `artifacts/ga/reports/website-ga-data-package-check-latest.json`
- `artifacts/ga/reports/website-ga-acquisition-quality-latest.json`
- `artifacts/ga/reports/website-ga-funnel-friction-latest.json`
- `artifacts/ga/reports/website-ga-experiment-backlog-latest.json`
- `artifacts/ga/reports/website-ga-content-opportunities-latest.json`
- `artifacts/ga/reports/website-ga-weekly-dashboard-latest.json`

## Close conditions for roadmap ticket
1. Two live experiments completed with direction decisions.
2. Day-30 wins/losses and next-quarter backlog recorded in handoff template.
3. Conversion blocker owners assigned.
