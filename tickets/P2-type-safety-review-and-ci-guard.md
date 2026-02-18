# P2 — Type Safety Review and CI Guardrails

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: QA + Functions Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-04-functions-type-safety-and-data-contract-fidelity.md

## Problem
Without periodic checks, unsafe casting can reappear after initial cleanup.

## Objective
Add lightweight review and CI guardrails to keep the typed contract cleanup from regressing.

## Scope
1. Identify review criteria for touched files in backlog.
2. Add lint/type checks for risky `as any` patterns in high-impact directories.
3. Add a tracked checklist for follow-up conversions.

## Tasks
1. Update ticket logs and sprint docs to include type-safety acceptance criteria.
2. Add CI lint or script check that flags new unsafe casts in priority paths.
3. Add a periodic diff review ticket template for future cleanup cycles.

## Acceptance Criteria
1. No unreviewed unsafe cast is introduced in `functions/src` critical modules after ticket start.
2. CI or script scan has a pass/fail output linked to this ticket.
3. Team has a follow-up owner and cadence for remaining casts.

## References
- `functions/src/index.ts`
