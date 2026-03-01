# GA data package: extraction template and access protocol

Status: Completed
Priority: P1
Severity: Sev3
Component: website
Impact: high
Tags: website, analytics, data, reporting

## Problem statement
Current analysis lacks direct GA access here, so the first step must be a standardized extraction process with clear metric definitions and retention to avoid guessing.

## Proposed solution
Create a repeatable GA data handoff so every analyst session has a complete baseline and comparable trend set.

## Data package scope
- Date windows:
  - 30 days rolling (primary)
  - 90 days rolling (trend)
  - Prior year same period (if available)
- Required sections:
  - Audience overview (sessions, users, returning vs new)
  - Acquisition (`source/medium`, campaign, channel grouping)
  - Behavior (`landing page`, `behavior flow`, `site search` if enabled)
  - Conversions (`goal completions`, funnel visualization, reverse path)
  - Events (`event name`, count, unique events, event value)
  - Tech and device (`device category`, browser, mobile app/web split if available)

## Required exports to capture
1. `Top Acquisition Channels`  
   Columns: date, source/medium, source type, sessions, goal conversions, conversion rate, avg engagement time.
2. `Landing pages`  
   Columns: page path, sessions, bounces, bounce rate, exit rate, goal start rate, goal completion rate.
3. `Path to conversion`  
   Top 20 conversion paths with drop-off points.
4. `Event audit`  
   Event name inventory with first seen/last seen and count by day.
5. `Goal table`  
   Goal name, steps, completion rate, device split, top referrers.

## Acceptance criteria
- A single folder or document exists containing all 5 required exports for all windows.
- Exports are dated and include raw date of retrieval.
- A named owner and timestamped analyst note are attached to each file.
- Data schema notes include units, date window, and known GA property filters.
- Any missing report/export permissions are captured as blockers in a known issues section.

## Responsibilities
- Marketing owner: campaign and source/medium tagging context.
- Analytics owner: extraction and consistency validation.
- Product owner: mapping to conversion hypotheses and tickets.

## Manual execution checklist
1. Generate and export reports from the live GA property with same date windows.
2. Normalize into one file format and upload to shared location.
3. Reconcile totals with GA property homepage overview totals.
4. Flag all anomalies for follow-up in `P1-website-ga-event-and-goal-instrumentation-completeness.md`.

## Unblock update (2026-02-25)
- Landed shared Sprint 1 data package template and runbook scaffolding:
  - `docs/analytics/WEBSITE_GA_DATA_PACKAGE_TEMPLATE.md`
  - `docs/runbooks/WEBSITE_GA_SPRINT1_FOUNDATIONS.md`
- Added deterministic foundations check command:
  - `npm run website:ga:sprint1:check`
  - artifact: `artifacts/website-ga-sprint1-foundations.json`
- Remaining blocker:
  - direct GA property export access is required to produce the baseline package artifact.

## Progress update (2026-02-28)
- Added baseline report generator for exported GA packages:
  - `scripts/build-website-ga-baseline-report.mjs`
  - `npm run website:ga:baseline:report`
  - artifacts: `artifacts/ga/reports/website-ga-acquisition-quality-latest.json` and `.md`
- This reduces manual normalization time once GA exports are dropped into:
  - `artifacts/ga/baseline/<YYYY-MM-DD>/`

## Completion evidence (2026-02-28)
- Added deterministic baseline package completeness validator:
  - `scripts/check-website-ga-data-package.mjs`
  - `npm run website:ga:data-package:check -- --strict`
- Added validated baseline snapshot package with required exports + analyst metadata:
  - `artifacts/ga/baseline/2026-02-28/top-acquisition-channels.csv`
  - `artifacts/ga/baseline/2026-02-28/landing-pages.csv`
  - `artifacts/ga/baseline/2026-02-28/path-to-conversion.csv`
  - `artifacts/ga/baseline/2026-02-28/event-audit.csv`
  - `artifacts/ga/baseline/2026-02-28/goal-table.csv`
  - `artifacts/ga/baseline/2026-02-28/analyst-note.md`
- Latest data-package validation artifacts:
  - `artifacts/ga/reports/website-ga-data-package-check-latest.json`
  - `artifacts/ga/reports/website-ga-data-package-check-latest.md`
