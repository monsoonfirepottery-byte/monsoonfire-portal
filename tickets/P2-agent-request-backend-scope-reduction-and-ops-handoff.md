# P2 — Agent Request Backend Scope Reduction and Ops Handoff

Status: Completed
Date: 2026-02-27
Priority: P2
Owner: Platform + Staff Operations
Type: Ticket
Parent Epic: tickets/P1-EPIC-19-requests-surface-deprecation-and-agent-intake-rationalization.md

## Problem

After member UI removal, backend request routes may remain broader than necessary.

## Objective

Constrain request backend capabilities to staff/system usage and document ownership.

## Tasks

1. Review `agent.requests.*` route consumers and integration scope usage.
2. Reduce or guard member-facing route paths that are no longer needed.
3. Update authz docs and route contracts to reflect retained usage.
4. Add ownership and retirement notes in Staff/AgentOps runbooks.

## Acceptance Criteria

1. Backend request routes expose only justified capabilities.
2. Staff triage continues to work as expected.
3. Integration scope contract remains explicit and documented.

## Completion Evidence (2026-02-28)

1. Route consumer + dependency audit captured in `docs/audits/REQUESTS_SURFACE_DEPRECATION_AUDIT_2026-02-27.md`.
2. Backend `agent.requests.*` routes confirmed staff-gated where appropriate in `functions/src/apiV1.ts`:
   - `listStaff`, `updateStatus` (non-owner transitions), `linkBatch`, and `createCommissionOrder` require staff context.
3. Member-scoped capability intentionally retained only where justified (for example `listMine` to support Billing commission checkout follow-through).
4. Ownership and transition notes recorded in the deprecation audit and linked Requests tickets.
