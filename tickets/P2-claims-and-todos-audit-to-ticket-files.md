# P2 — Claims and TODOs Audit to Ticket Files

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: PM + Engineering
Type: Ticket
Parent Epic: tickets/P1-EPIC-06-backlog-hygiene-and-ticket-topology.md

## Problem
Some TODO entries and gap notes are not reflected as tickets with dependencies and owners, reducing execution clarity.

## Objective
Create a one-time audit to reconcile active TODOs into current markdown ticket files.

## Scope
1. Parse current backlog docs for unresolved TODOs.
2. Produce ticketized output with priorities and owners.
3. De-duplicate existing tasks already covered elsewhere.

## Tasks
1. Audit `docs/ENGINEERING_TODOS.md` and sprint artifacts for stale or duplicate items.
2. Create tickets for any unresolved gap that lacks current ownership.
3. Update this sprint index with explicit parent references where needed.

## Acceptance Criteria
1. All unowned TODOs are either closed or converted into explicit tickets.
2. New ticket set includes priority and owner for each entry.
3. Duplicate work is deduplicated and documented.

## References
- `docs/sprints/SWARM_BOARD.md:47`
- `docs/ENGINEERING_TODOS.md`

## Completion Notes (2026-02-22)
1. Added automated audit script `scripts/backlog-hygiene-audit.mjs` to reconcile unresolved TODO entries and board-linked ticket references.
2. Published audit artifact `docs/sprints/EPIC_06_BACKLOG_AUDIT_2026-02-22.md`.
3. Confirmed `docs/ENGINEERING_TODOS.md` has no unresolved checkbox TODO entries requiring new ticket creation in this pass.
