# Studio GA Monthly Review Runbook

Owner: Website + Analytics Team  
Cadence: Monthly

## Goal

Publish a monthly studio lifecycle funnel report with exception and rollback visibility.

## Input

- GA event export CSV that includes lifecycle events listed in `STUDIO_GA_EVENT_SCHEMA.md`.
- Default input path if not overridden: latest baseline snapshot `event-audit.csv`.

## Command

```bash
npm run -s studio:ga:monthly:report
```

Optional strict mode:

```bash
node ./scripts/build-studio-ga-monthly-review-report.mjs --strict --json
```

Override input CSV:

```bash
node ./scripts/build-studio-ga-monthly-review-report.mjs --events-csv <path/to/events.csv> --json
```

## Artifacts

- `artifacts/ga/reports/studio-ga-monthly-review-latest.json`
- `artifacts/ga/reports/studio-ga-monthly-review-latest.md`

## Escalation triggers

- Any required funnel event has zero count in the review month.
- `status_transition_exception` count increases month-over-month.
- `status_transition` rollback count increases month-over-month.

## Follow-up workflow

1. File remediation tickets for the top funnel drop-off and top exception reason.
2. Attach latest monthly report artifacts in the ticket evidence section.
3. Link remediation ticket IDs back into the next monthly report summary.
