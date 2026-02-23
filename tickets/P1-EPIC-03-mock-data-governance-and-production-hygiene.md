# Epic: P1 — Mock Data Governance and Production Hygiene

Status: Completed
Date: 2026-02-23
Priority: P1
Owner: Portal + Functions Team
Type: Epic

## Problem
Sample/mock fallback paths are currently allowed in ways that can hide broken integrations and leak test-like behavior into non-dev workflows.

## Objective
Introduce explicit dev-only governance around mock data and stub readers, and make missing data visible instead of silently mocked in production.

## Tickets
- `tickets/P1-dev-data-fallback-controls.md`
- `tickets/P2-dashboard-mock-fallback-elimination.md`
- `tickets/P2-materials-staging-sample-seeding-contract.md`
- `tickets/P2-studio-brain-stripe-reader-stub-guardrails.md`

## Scope
1. Make mock dashboards/dev data behavior opt-in and explicit.
2. Audit sample-data fallback usage in dashboard views.
3. Gate sample material seeding and cloud reader stubs by environment.
4. Add alerts for integration misses currently covered by mock fallbacks.

## Dependencies
- `web/src/views/DashboardView.tsx`
- `functions/src/materials.ts`
- `studio-brain/src/cloud/stripeReader.ts`

## Acceptance Criteria
1. Non-dev environments cannot silently proceed with mock sample values.
2. Missing production data is surfaced as a clear error path or explicit user state.
3. Stubbed integration code paths are gated and logged.

## Definition of Done
1. All tickets in this epic are implemented or explicitly postponed.
2. Team has a documented policy for temporary mock fallback windows.
3. No hidden mock fallback remains in core production user journeys.

## Completion Evidence
1. Dashboard mock governance implemented with explicit non-dev acknowledgement policy and fallback telemetry in `web/src/views/DashboardView.tsx`.
2. Materials seeding contract hardened with force + non-dev acknowledgement controls in `functions/src/materials.ts`.
3. Studio-brain Stripe reader stub guardrails expanded with explicit mode policy in `studio-brain/src/cloud/stripeReader.ts`.
4. Governance runbook added in `docs/runbooks/MOCK_DATA_GOVERNANCE.md`.
