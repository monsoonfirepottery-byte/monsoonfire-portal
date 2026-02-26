# Website GA Sprint 1 Foundations

## Purpose
Create a deterministic, repo-tracked foundation for Sprint 1 GA work (measurement stabilizer) before live-property extraction.

## Foundation artifacts
- `docs/analytics/WEBSITE_GA_DATA_PACKAGE_TEMPLATE.md`
- `docs/analytics/WEBSITE_GA_EVENT_GOAL_MAP_TEMPLATE.md`
- `docs/analytics/WEBSITE_GA_UTM_TAXONOMY.md`
- `scripts/check-website-ga-sprint1-foundations.mjs`

## Validation command
- `npm run website:ga:sprint1:check`
- Output artifact:
  - `artifacts/website-ga-sprint1-foundations.json`

## Baseline package structure
Store exported GA baseline snapshots in:
- `artifacts/ga/baseline/<YYYY-MM-DD>/`

Expected files:
1. `top-acquisition-channels.csv`
2. `landing-pages.csv`
3. `path-to-conversion.csv`
4. `event-audit.csv`
5. `goal-table.csv`
6. `analyst-note.md`

## Operator workflow
1. Run `npm run website:ga:sprint1:check` and confirm pass.
2. Request/export reports from live GA property using the data package template.
3. Populate event-goal map and UTM taxonomy gaps from exported data.
4. Save baseline data under `artifacts/ga/baseline/<YYYY-MM-DD>/`.
5. Record any permissions or missing-report blockers in ticket updates.

## Current blocker (2026-02-25)
- Live GA exports and real-time event validation require direct GA property access in owner environment.
