# P2 — Epic Board Hygiene and Status Reconciliation

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: PM
Type: Ticket
Parent Epic: tickets/P1-EPIC-06-backlog-hygiene-and-ticket-topology.md

## Problem
Board-level status and epic hierarchy are not consistently updated from completed docs-only work or newly created tickets.

## Objective
Create a recurring procedure to keep epic board state, ticket status, and ownership synchronized.

## Scope
1. Audit board state for stale statuses and orphaned tickets.
2. Add consistency checks for ticket name-to-epic relationships.
3. Add a short playbook for routine reconciliation.

## Tasks
1. Implement status hygiene pass in `docs/sprints/SWARM_BOARD.md`.
2. Add "Parent Epic" metadata in new and existing tickets where missing.
3. Add a recurring task in the ticket/docs reconciliation runbook to close the loop monthly.

## Acceptance Criteria
1. Board no longer contains unresolved orphan tickets.
2. Every active ticket includes parent and dependency context.
3. Reconciliation procedure is documented and assigned.

## References
- `docs/sprints/SWARM_BOARD.md:47`
- `tickets/README.md`

## Completion Notes (2026-02-22)
1. Reconciled `docs/sprints/SWARM_BOARD.md` open-ticket section to remove completed entries and align status labels with canonical ticket states.
2. Added reconciliation procedure document `docs/sprints/BOARD_RECONCILIATION_RUNBOOK.md` with monthly cadence and drift rules.
3. Updated ticket metadata conventions in `tickets/README.md` and added repeatable board audit command via `scripts/backlog-hygiene-audit.mjs`.
