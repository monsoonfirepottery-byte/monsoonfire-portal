# Website analytics review: Google Analytics-backed growth epic

Status: Completed
Priority: P2
Severity: Sev4
Component: website
Impact: medium
Tags: website, analytics, conversion, search

## Problem statement
The website analytics review request is partially blocked by restricted GA access in this environment, and the current site instrumentation is fragmented.
The goal is to convert this into a concrete engineering + analytics execution plan with the minimum viable event model before funnel reporting.

## Epic structure
- Epic 1: Data foundation and instrumentation truth
  - Ticket: `P1-website-ga-event-and-goal-instrumentation-completeness.md`
  - `P1-website-ga-data-package-template-and-access.md` (to keep exports reproducible)
- Epic 2: Demand quality and acquisition efficiency
  - Ticket: `P1-website-ga-campaign-and-source-quality.md`
- Epic 3: Funnel and conversion lift
  - Ticket: `P2-website-ga-funnel-friction-and-conversion-drops.md`
- Epic 4: Content/engagement health and retention
  - Ticket: `P2-website-ga-content-and-engagement-polish.md`
- Epic 5: Reporting, alerts, and operating rhythm
  - Ticket: `P2-website-ga-dashboard-alerts-and-handover.md`
- Supporting: `P1-website-ga-data-package-template-and-access.md`
- Supporting: `P2-website-ga-experiment-backlog-and-prioritization.md`
- Supporting: `P1-website-ga-30-day-priority-roadmap.md`

## Current implementation evidence (updated 2026-02-28)
- `website/assets/js/analytics.js` loads GA ID `G-ZJQ30LHFKH` and Metricool.
- Canonical staged event instrumentation is now implemented:
  - `website/assets/js/main.js`
  - `website/ncsitebuilder/assets/js/main.js`
  - `website/contact/index.html`
  - `website/ncsitebuilder/contact/index.html`
- Canonical event/goal map is now versioned:
  - `docs/analytics/WEBSITE_GA_EVENT_GOAL_MAP.md`
- Deterministic GA reporting pipeline now exists in-repo:
  - `website:ga:event-goal:check`
  - `website:ga:campaign:audit`
  - `website:ga:data-package:check`
  - `website:ga:baseline:report`
  - `website:ga:funnel:report`
  - `website:ga:experiments:backlog`
  - `website:ga:content:opportunities`
  - `website:ga:dashboard:weekly`
- Latest artifacts in `artifacts/ga/reports/` include event-goal, campaign, data package, acquisition, funnel, experiment, content, and weekly dashboard outputs.

## Baseline metrics set (required)
- Sessions, engaged sessions
- Conversion rate (overall + top goals)
- Goal start-to-completion conversion by funnel
- Bounce rate and exit rate by top 25 pages
- Top landing pages with entry volume and assisted conversions
- Source/Medium conversion by channel and device
- Core Web Vitals correlation proxy (if available in behavior)
- Time to first meaningful engagement (where tracked)
- Revenue/lead proxy metric (if available)

## Acceptance criteria for the epic
- GA access is validated for the target property and date range from the latest export.
- Each ticket is executed in priority order with clear owners and acceptance targets.
- Website instrumentation coverage includes a stable event-to-goal map before funnel analysis tickets start.
- Each completed ticket updates the same ticketing format with observed baselines and deltas.
- Final status is posted to the ticket file set with links to GA exports and supporting screenshots.

## Delivery sequencing
- Week 1
  - Complete data package extraction and channel audit.
  - Close missing instrumentation gaps that block funnel measurement.
- Week 2
  - Execute top-funnel experiments for channel quality + conversion path friction.
  - Publish interim findings and owner status.
- Week 3
  - Expand to content and engagement optimizations.
  - Stand up weekly dashboard cadence and alerts.

## Notes
- The GA link you shared resolves to a restricted login wall, so evidence collection should use:
  - 30-day and 90-day snapshots from `Acquisition`, `Behavior > Behavior Flow`, and `Conversions`.
  - Source/medium + device reports for the same date windows.
- Keep all edits in markdown ticket format to match the existing docs-and-git tracking workflow.

## Progress update (2026-02-28)
- Epic 1 (data foundation + instrumentation truth): completed.
- Epic 2 (demand quality and acquisition efficiency): completed.
- Epic 3 (funnel + conversion lift): automation complete with actionable interventions and ranked backlog.
- Epic 4 (content/engagement health): automation complete with top-10 queue and metadata/alt checks.
- Epic 5 (reporting/alerts/handover): automation complete with threshold dry-run and owner mapping.
- Supporting lifecycle analytics alignment ticket is now complete:
  - `P3-studio-analytics-ga-funnel-event-schema-ticket.md`
- Ongoing live-traffic experiment cycles continue under:
  - `P1-website-ga-30-day-priority-roadmap.md`
