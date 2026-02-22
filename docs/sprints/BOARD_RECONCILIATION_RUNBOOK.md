# Board Reconciliation Runbook

Date: 2026-02-22
Owner: PM + Engineering

## Purpose

Keep `docs/sprints/SWARM_BOARD.md`, active ticket metadata, and epic hierarchy synchronized.

## Scope Rules

1. Ignore tickets associated with closed epics.
2. Ignore Epic 10 and Epic 11 scope during the current hygiene pass.
3. Focus only on in-scope active statuses: `Planned`, `Open`, `In Progress`, `Blocked`, `Todo`, `On Hold`.

## Monthly Procedure

1. Run epic snapshot:
   - `node ./scripts/epic-hub.mjs status`
   - `node ./scripts/epic-hub.mjs next`
2. Run backlog hygiene audit:
   - `node ./scripts/backlog-hygiene-audit.mjs --markdown --out docs/sprints/EPIC_06_BACKLOG_AUDIT_YYYY-MM-DD.md`
3. Reconcile board rows:
   - Remove completed tickets from "Open Tickets" on `docs/sprints/SWARM_BOARD.md`.
   - Update status labels to match canonical ticket `Status:` values.
   - Keep only in-scope tickets after scope filters.
4. Reconcile ticket metadata for in-scope active tickets:
   - Confirm `Status`, `Priority`, `Owner`, and `Type`.
   - Confirm `Parent Epic` for epic-owned tickets, or document standalone dependency context.
5. Log outcomes:
   - Add a dated summary entry in the latest `EPIC_06_BACKLOG_AUDIT_YYYY-MM-DD.md`.
   - Note blocked work with explicit unblock owner.

## Drift Rules

1. Any board row whose status label differs from the ticket `Status:` is drift and must be fixed in the same pass.
2. Any board reference to a missing ticket file is severity-1 hygiene drift.
3. Any active ticket with unresolved ownership or priority metadata is blocked from promotion.

## Exit Criteria

1. No missing ticket references in `SWARM_BOARD.md` open-ticket section.
2. No status drift for in-scope open-ticket rows.
3. No unresolved in-scope TODO entries without ticket ownership.
