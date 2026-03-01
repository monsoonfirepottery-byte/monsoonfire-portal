# Website GA Sprint 1 Foundations

## Purpose
Create a deterministic, repo-tracked foundation for Sprint 1 GA work (measurement stabilizer) before live-property extraction.

## Foundation artifacts
- `docs/analytics/WEBSITE_GA_DATA_PACKAGE_TEMPLATE.md`
- `docs/analytics/WEBSITE_GA_EVENT_GOAL_MAP_TEMPLATE.md`
- `docs/analytics/WEBSITE_GA_EVENT_GOAL_MAP.md`
- `docs/analytics/WEBSITE_GA_UTM_TAXONOMY.md`
- `scripts/check-website-ga-sprint1-foundations.mjs`

## Validation command
- `npm run website:ga:sprint1:check`
- Output artifact:
  - `artifacts/website-ga-sprint1-foundations.json`

## Baseline acquisition report command
- `npm run website:ga:baseline:report`
- Output artifacts:
  - `artifacts/ga/reports/website-ga-acquisition-quality-latest.json`
  - `artifacts/ga/reports/website-ga-acquisition-quality-latest.md`

## Event-goal instrumentation command
- `npm run website:ga:event-goal:check`
- Output artifacts:
  - `artifacts/ga/reports/website-ga-event-goal-check-latest.json`

## Campaign-link quality command
- `npm run website:ga:campaign:audit`
- Output artifacts:
  - `artifacts/ga/reports/website-ga-campaign-link-audit-latest.json`
  - `artifacts/ga/reports/website-ga-campaign-link-audit-latest.md`

## Data package completeness command
- `npm run website:ga:data-package:check`
- Output artifacts:
  - `artifacts/ga/reports/website-ga-data-package-check-latest.json`
  - `artifacts/ga/reports/website-ga-data-package-check-latest.md`

## Funnel friction command (Sprint 2)
- `npm run website:ga:funnel:report`
- Output artifacts:
  - `artifacts/ga/reports/website-ga-funnel-friction-latest.json`
  - `artifacts/ga/reports/website-ga-funnel-friction-latest.md`

## Experiment backlog command (Sprint 2)
- `npm run website:ga:experiments:backlog`
- Output artifacts:
  - `artifacts/ga/reports/website-ga-experiment-backlog-latest.json`
  - `artifacts/ga/reports/website-ga-experiment-backlog-latest.md`

## Content opportunity command (Sprint 3)
- `npm run website:ga:content:opportunities`
- Output artifacts:
  - `artifacts/ga/reports/website-ga-content-opportunities-latest.json`
  - `artifacts/ga/reports/website-ga-content-opportunities-latest.md`

## Weekly dashboard command (Sprint 4)
- `npm run website:ga:dashboard:weekly`
- Output artifacts:
  - `artifacts/ga/reports/website-ga-weekly-dashboard-latest.json`
  - `artifacts/ga/reports/website-ga-weekly-dashboard-latest.md`

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
2. Run `npm run website:ga:event-goal:check` and resolve any contract drift.
3. Run `npm run website:ga:campaign:audit -- --strict` and confirm `effectiveCoveragePct >= 80`.
4. Request/export reports from live GA property using the data package template.
5. Save baseline data under `artifacts/ga/baseline/<YYYY-MM-DD>/`.
6. Run `npm run website:ga:data-package:check -- --strict` to validate export completeness + analyst metadata.
7. Run `npm run website:ga:baseline:report` to generate top-source weekly quality summary.
8. Run `npm run website:ga:funnel:report` to map funnel drop-offs and interventions.
9. Run `npm run website:ga:experiments:backlog -- --strict` to produce scored experiment queue.
10. Run `npm run website:ga:content:opportunities -- --strict` to publish top 10 page opportunities with metadata/alt checks.
11. Run `npm run website:ga:dashboard:weekly -- --strict` to generate weekly owner dashboard + anomaly checks.
12. Record any permissions or missing-report blockers in ticket updates.

## Current blocker (2026-02-25)
- Live GA exports and real-time event validation require direct GA property access in owner environment.
