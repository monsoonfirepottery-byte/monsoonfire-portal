# P2 — Workshops: Staff Programming Intelligence Dashboard

Status: Completed
Date: 2026-02-27
Priority: P2
Owner: Program Ops + Staff Console
Type: Ticket
Parent Epic: tickets/P1-EPIC-17-workshops-experience-and-community-signals.md

## Problem

Staff lacks a unified demand intelligence surface to decide what workshops to schedule next.

## Objective

Provide a dashboard for workshop demand, interest trends, and conversion signals.

## Scope

1. Demand by technique, level, and schedule preference.
2. Waitlist pressure and second-session opportunities.
3. Browse-to-signup conversion visibility.
4. Action shortcuts to create/schedule workshops from demand clusters.

## Tasks

1. Define workshop demand KPI model and data pipelines.
2. Build dashboard cards and drill-down tables.
3. Add actionable controls (e.g., propose session from cluster).
4. Add export/reporting for programming meetings.

## Completion Evidence (2026-02-28)

1. Added staff-facing demand intelligence panel directly in Workshops (`EventsView`) for immediate use.
2. Added KPI cards for:
   - Signals tracked
   - Active interests
   - Constrained sessions
   - Highest demand gap
3. Added actionable technique demand clusters with recommended level/schedule and a one-click "route cluster to request brief" action.
4. Demand model combines request + interest + waitlist pressure + current supply heuristics.
5. Added request lifecycle triage cluster cards with status controls and priority scoring.
6. Added export action to generate a staff-ready demand brief artifact from live cluster state.
7. Added a dedicated staff route `/staff/workshops` that locks Staff Console into the Events module for programming planning sessions.
8. Added a staff-only workshop programming intelligence section in `StaffView` Events module with:
   - Technique cluster modeling
   - Gap and demand scoring
   - Suggested next action per cluster
   - Exportable programming brief for staffing rituals
9. Added launcher controls between full Staff Console and dedicated workshops workspace.

## Remaining Gaps

1. None.

## Validation

1. `npm --prefix web run build` passes.
2. `npm --prefix web run lint` passes.

## Acceptance Criteria

1. Staff can identify top unmet demand quickly.
2. Staff can prioritize scheduling using consistent KPI signals.
3. Dashboard supports decision handoff and planning rituals.
4. Data remains aligned with member-facing surfaces.
