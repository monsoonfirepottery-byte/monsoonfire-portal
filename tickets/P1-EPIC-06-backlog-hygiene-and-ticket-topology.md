# Epic: P1 — Backlog Hygiene and Ticket Topology

Status: Completed
Date: 2026-02-23
Priority: P1
Owner: PM + Engineering
Type: Epic

## Problem
Sprint docs and the ticket log include unresolved TODO states and mixed ownership that make execution ordering difficult.

## Objective
Normalize all near-term backlog items into explicit, owned tickets with hierarchy and dependencies.

## Tickets
- `tickets/P2-claims-and-todos-audit-to-ticket-files.md`
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
1. Active TODOs in docs map to current ticket files.
2. Every high-priority gap has owner + acceptance + dependency.
3. Board and ticket hierarchy are synchronized at least weekly.

## Definition of Done
1. No unresolved gap in core docs remains without an owning ticket.
2. Epic and ticket IDs are consistently referenced in sprint notes.
3. Follow-up process and cadence are documented.

## Execution Notes (2026-02-22)
1. Completed:
   - `tickets/P2-claims-and-todos-audit-to-ticket-files.md`
   - `tickets/P2-epic-board-hygiene-and-status-reconcile.md`
2. Blocked:
   - `tickets/P2-sprint-10-11-gap-cleanup-tickets.md` (deferred by directive to ignore Epic/Sprint 10 and 11 scope)
3. Artifacts delivered:
   - `scripts/backlog-hygiene-audit.mjs`
   - `docs/sprints/EPIC_06_BACKLOG_AUDIT_2026-02-22.md`
   - `docs/sprints/BOARD_RECONCILIATION_RUNBOOK.md`

## Unblock Notes (2026-02-23)
1. Blocker lifted by explicit direction to resume Epic 6.
2. `tickets/P2-sprint-10-11-gap-cleanup-tickets.md` returned to active backlog status.

## Completion Notes (2026-02-23)
1. Sprint 10/11 canonical mapping and sequencing published:
   - `docs/sprints/SPRINT_10_11_GAP_MAPPING_2026-02-23.md`
2. Sprint docs updated to include direct canonical ticket references:
   - `docs/sprints/SPRINT_10_ALPHA_LAUNCH.md`
   - `docs/sprints/SPRINT_11_PERF_TESTING.md`
3. Backlog hygiene audit refreshed with zero in-scope board drift:
   - `docs/sprints/EPIC_06_BACKLOG_AUDIT_2026-02-23.md`
4. Board/runbook/script scope normalized for ongoing reconciliation (removed obsolete Sprint 10/11 exclusion rule):
   - `docs/sprints/SWARM_BOARD.md`
   - `docs/sprints/BOARD_RECONCILIATION_RUNBOOK.md`
   - `scripts/backlog-hygiene-audit.mjs`
