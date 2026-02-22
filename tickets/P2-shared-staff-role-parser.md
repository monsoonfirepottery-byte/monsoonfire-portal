# P2 — Shared Staff Role Parser Refactor

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Portal Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-02-auth-role-consistency-and-traceability.md

## Problem
Role checks are duplicated across multiple components, increasing risk of drift and inconsistent outcomes.

## Objective
Create one shared parser for staff roles and role flags across web views and API-facing code paths.

## Scope
1. Inventory current role checks in App shell and staff/reservation views.
2. Implement shared parser/helper utility returning canonical role enum.
3. Replace direct claim field checks and email-domain inference usage.

## Tasks
1. Add shared utility under `web/src` that normalizes staff role from token claims.
2. Replace per-component role parsing in `App.tsx`, `ReservationsView.tsx`, `StaffView.tsx`.
3. Add unit tests for canonical and legacy token variations.

## Acceptance Criteria
1. All staff-gated code paths call the shared parser.
2. No view uses local email-domain heuristic as a primary authority.
3. Unit tests show stable parsing for legacy and modern token layouts.

## References
- `web/src/App.tsx:1017`
- `web/src/views/ReservationsView.tsx:393`
- `web/src/views/StaffView.tsx:307`
