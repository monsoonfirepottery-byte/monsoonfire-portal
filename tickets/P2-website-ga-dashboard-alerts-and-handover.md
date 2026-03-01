# Website GA dashboard, alerting, and reporting handover

Status: Completed
Priority: P2
Severity: Sev3
Component: website
Impact: medium
Tags: website, reporting, analytics, operations

## Problem statement
Insights decay quickly without a repeatable reporting cadence and ownership, leading to delayed reaction to traffic or conversion regressions.

## Proposed solution
Set a lightweight operating cadence with dashboards, alerts, and handoff notes.

## Tasks
1. Define the weekly metrics set:
   - sessions by source/medium
   - conversion rate by funnel
   - top landing page bounce and conversion
   - assisted conversion volume
1. Create or refresh a shared analytics snapshot dashboard for leadership + website owner.
1. Add anomaly checks for week-over-week drops and major traffic shifts.
1. Define ticket thresholds and escalation path for each metric.
1. Publish a one-page weekly report template with action owner and status.

## Acceptance criteria
- Weekly report is generated and distributed on a fixed schedule.
- One owner is accountable for each metric family.
- Alert rules are documented and tested with at least one dry run.
- A 30-day comparison baseline is retained in the analytics archive.

## Dependencies
- GA admin access and export/reader permissions.
- Team agreement on report rhythm and owners.

## Manual test checklist
1. Run a dry-run report and validate metric definitions and formulas.
1. Simulate one threshold breach with historical data and validate escalation path.
1. Confirm recipients and file links are up to date.

## Completion evidence (2026-02-28)
- Added weekly GA dashboard + anomaly checker:
  - `scripts/build-website-ga-weekly-dashboard.mjs`
  - `npm run website:ga:dashboard:weekly -- --strict`
- Added handover template and threshold docs:
  - `docs/analytics/WEBSITE_GA_WEEKLY_REPORT_TEMPLATE.md`
  - `docs/analytics/WEBSITE_GA_ALERT_THRESHOLDS.md`
- Latest weekly dashboard artifacts:
  - `artifacts/ga/reports/website-ga-weekly-dashboard-latest.json`
  - `artifacts/ga/reports/website-ga-weekly-dashboard-latest.md`
- Alert dry-run evidence (simulated breach):
  - `npm run website:ga:dashboard:weekly -- --strict --simulate-breach`
  - artifact: `artifacts/ga/reports/website-ga-weekly-dashboard-20260228T205255926Z.json` (`status: alert`, `alerts: 1`)
- 30-day/weekly archive path retained for comparisons:
  - `artifacts/ga/archive/website-ga-weekly-metrics-history.jsonl`
