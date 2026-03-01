# Ticket: P3 — Studio Analytics GA Funnel and Event Schema Alignment

Status: Completed
Created: 2026-02-17  
Priority: P3  
Owner: Website + Analytics Team  
Type: Ticket

## Problem

GA URL was provided for review but there is no evidence that tracked events are directly mapped to current studio workflow milestones, making optimization recommendations noisy.

## Goal

Align analytics instrumentation with reservation lifecycle milestones and website/operations UX.

## Scope

1. Define event schema (consistent names + params):
   - reservation_created
   - reservation_station_assigned
   - kiln_load_started
   - status_transition
   - pickup_ready
   - pickup_completed
2. Add funnel definitions in GA and dashboards for drop-off analysis.
3. Add exception and rollback tracking for failed transitions.
4. Add report cadence and owning dashboard for product planning.
5. Map custom events to existing website pages and admin actions.

## Acceptance Criteria

- All major operations milestones fire analytics events with stable params.
- Funnel report shows at least:
  - create → assign station → kiln started → ready
- Exception events are tagged with reasons.
- Monthly review report is generated from GA export.

## Risks

- If GA property/admin access is restricted, implement with existing property first and escalate.
- Avoid over-instrumentation noise from repeated status polling or polling-only refresh.

## Definition of Done

- GA funnel exists and is reviewed by product owner.
- Analytics event schema is documented in repo and linked from planning docs.

## Completion evidence (2026-02-28)

- Implemented lifecycle event instrumentation in:
  - `web/src/views/ReservationsView.tsx`
  - `web/src/views/KilnLaunchView.tsx`
- Added canonical schema + cadence docs:
  - `docs/analytics/STUDIO_GA_EVENT_SCHEMA.md`
  - `docs/analytics/STUDIO_GA_MONTHLY_REVIEW_RUNBOOK.md`
- Added monthly review report generator:
  - `scripts/build-studio-ga-monthly-review-report.mjs`
  - `npm run studio:ga:monthly:report`
- Latest monthly artifact outputs:
  - `artifacts/ga/reports/studio-ga-monthly-review-latest.json`
  - `artifacts/ga/reports/studio-ga-monthly-review-latest.md`
- Added exception + rollback telemetry:
  - `status_transition_exception` tagged with `transitionDomain`, `transitionAction`, and `errorCode`
  - `status_transition` rollback coverage via `transitionOutcome=rollback`
