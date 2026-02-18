# Epic: P1 — Auth Role Consistency and Traceability

Status: Planned
Date: 2026-02-18
Priority: P1
Owner: Portal Team
Type: Epic

## Problem
Role inference for staff access is currently split across multiple paths, and role sources are not consistently documented between code and architecture docs.

## Objective
Unify role extraction and authorization checks across portal web and docs with one authoritative contract.

## Tickets
- `tickets/P1-staff-role-source-of-truth-contract.md`
- `tickets/P2-shared-staff-role-parser.md`
- `tickets/P2-role-gates-and-ui-authority-coverage.md`
- `tickets/P2-auth-role-doc-and-contract-sync.md`

## Scope
1. Define one canonical staff-role source and precedence model.
2. Replace ad hoc role inference (including email domain heuristics) in web views and API-facing code.
3. Align docs describing staff/roles with runtime behavior.
4. Add checks that prevent unauthorized UI rendering and accidental privilege escalation.

## Dependencies
- `web/src/App.tsx`
- `web/src/views/ReservationsView.tsx`
- `web/src/views/StaffView.tsx`
- `docs/DESIGN_2026-01-20.md`

## Acceptance Criteria
1. Staff role behavior is identical in App shell, reservation workflows, and staff views.
2. Role checks are derived from claims data or explicit token metadata only.
3. Documentation and ticket references reflect the same precedence model.

## Definition of Done
1. `Role` inference helper exists and is consumed by all staff-gated paths.
2. Auth/doc drift is resolved and approved by review.
3. Tickets in this epic close with no remaining high-priority auth ambiguity.
