# Website analytics review: Google Analytics-backed growth epic

Status: Proposed
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

## Current implementation evidence (Feb 2026 snapshot)
- `website/assets/js/analytics.js` loads GA ID `G-ZJQ30LHFKH` and Metricool.
- `website/assets/js/main.js` emits broad `cta_click` events for links/forms but does not define staged funnel goals.
- No dedicated "quote start → quote submit", "contact start", or pickup/lead completion goals are defined in visible scripts.
- No explicit revenue/lead proxy event payload standard (source/medium + step + intent) is consistently captured.
- `website` pages are currently conversion-first but largely non-instrumented beyond global CTA tracking.

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
- Final status is posted to tracker with links to GA exports and supporting screenshots.

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
- Keep all edits in markdown ticket format to match existing tracker sync workflows.
