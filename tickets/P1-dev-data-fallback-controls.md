# P1 — Dev-Only Mock Data Controls

Status: Proposed
Date: 2026-02-18
Priority: P1
Owner: Portal Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-03-mock-data-governance-and-production-hygiene.md

## Problem
Dashboard/mock sample fallback can be enabled without explicit environment intent, reducing signal quality in testing and staging workflows.

## Objective
Introduce explicit environment gating and policy for any data mock usage.

## Scope
1. Define supported flags and expected values for dev-mode data fallbacks.
2. Ensure prod/staging default behavior is strict unless explicitly overridden.
3. Add environment banner/logging whenever mock mode is active.

## Tasks
1. Add strict env/feature check for dashboard mock mode in `web/src/views/DashboardView.tsx`.
2. Add startup telemetry showing active mock mode and source.
3. Add UI affordance for explicit mock-mode intent (and warning in non-dev).

## Acceptance Criteria
1. Mock mode is disabled by default outside development.
2. Any mock activation event is logged with environment and actor context.
3. Non-dev fallback does not display sample values without explicit confirmation.

## References
- `web/src/views/DashboardView.tsx:158`
- `web/src/views/DashboardView.tsx:529`

