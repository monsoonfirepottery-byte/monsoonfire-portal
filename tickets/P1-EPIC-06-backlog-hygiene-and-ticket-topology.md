# Epic: P1 — Backlog Hygiene and Ticket Topology

Status: Proposed
Date: 2026-02-18
Priority: P1
Owner: PM + Engineering
Type: Epic

## Problem
Sprint docs and the tracker include unresolved TODO states and mixed ownership that make execution ordering difficult.

## Objective
Normalize all near-term backlog items into explicit, owned tickets with hierarchy and dependencies.

## Tickets
- `tickets/P2-claims-and-todos-audit-to-tracker.md`
- `tickets/P2-sprint-10-11-gap-cleanup-tickets.md`
- `tickets/P2-epic-board-hygiene-and-status-reconcile.md`

## Scope
1. Audit existing TODO backlog against executed status and current architecture.
2. Convert stale TODOs into actionable tickets with explicit priority.
3. Align ticket hierarchy with sprint board and dependencies.

## Dependencies
- `docs/sprints/SWARM_BOARD.md`
- `docs/sprints/SPRINT_10_ALPHA_LAUNCH.md`
- `docs/sprints/SPRINT_11_PERF_TESTING.md`

## Acceptance Criteria
1. Active TODOs in docs map to current tracker tickets.
2. Every high-priority gap has owner + acceptance + dependency.
3. Board and ticket hierarchy are synchronized at least weekly.

## Definition of Done
1. No unresolved gap in core docs remains without an owning ticket.
2. Epic and ticket IDs are consistently referenced in sprint notes.
3. Follow-up process and cadence are documented.
