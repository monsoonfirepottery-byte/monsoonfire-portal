# P2 — Dashboard Mock Fallback Elimination

Status: Proposed
Date: 2026-02-18
Priority: P2
Owner: Portal Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-03-mock-data-governance-and-production-hygiene.md

## Problem
Some dashboard paths still default to sample data on missing fields, masking broken APIs and creating false confidence.

## Objective
Replace silent fallback behavior with explicit states and user-visible outcomes.

## Scope
1. Replace sample placeholders where they obscure missing backend data.
2. Add empty-state and warning states for unready integrations.
3. Ensure analytics capture fallback incidences for future cleanup.

## Tasks
1. Audit fallback expressions in `web/src/views/DashboardView.tsx` for silent defaults.
2. Introduce explicit "data unavailable" states for blocked metrics widgets.
3. Add tests for missing-key scenarios to prevent reintroduction.

## Acceptance Criteria
1. No critical dashboard metric silently substitutes sample data outside dev mode.
2. Missing upstream data results in explicit state and action guidance.
3. Fallback events are observable in logs or dev analytics.

## References
- `web/src/views/DashboardView.tsx:529`

