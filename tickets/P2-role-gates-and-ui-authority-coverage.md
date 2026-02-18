# P2 — Role Gating and Authority Coverage

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Portal Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-02-auth-role-consistency-and-traceability.md

## Problem
Even with parser changes, some routes and controls may still render or enable actions outside intended role rules.

## Objective
Audit and harden all staff-only UI surfaces using the shared role contract.

## Scope
1. Catalog staff/owner/admin-gated controls across portal views.
2. Add role assertions where missing.
3. Add clear fallback messaging for insufficient privilege.

## Tasks
1. Add a role coverage checklist for each principal page and action.
2. Replace permissive branching with contract-backed assertions.
3. Add tests for unauthorized rendering, disabled action states, and fallback states.

## Acceptance Criteria
1. No staff-gated control lacks role checks.
2. Unauthorized users cannot trigger staff-only actions through UI route or API call from client state.
3. Permission denied states are stable and user-visible.

## References
- `web/src/App.tsx`
- `web/src/views/ReservationsView.tsx`
- `web/src/views/StaffView.tsx`
