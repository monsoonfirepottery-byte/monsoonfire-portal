# P1 — Typed Data Access Framework

Status: Proposed
Date: 2026-02-18
Priority: P1
Owner: Functions Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-04-functions-type-safety-and-data-contract-fidelity.md

## Problem
Current data access patterns mix typed and untyped Firestore payload handling, reducing confidence in domain consistency.

## Objective
Create shared typed helpers for core domain reads/writes in Functions.

## Scope
1. Identify top 3 highest-risk collections used in APIs.
2. Introduce reusable type guard and converter helpers.
3. Apply helpers in at least one major caller path before expanding later.

## Tasks
1. Create domain-safe parser utilities for reservations, orders, and materials.
2. Refactor one representative path in `functions/src/index.ts` and `functions/src/integrationEvents.ts`.
3. Add tests proving parser rejects malformed payloads safely.

## Acceptance Criteria
1. Shared typed helpers are reusable across at least two modules.
2. Parser failures return explicit errors and no hidden runtime crashes.
3. Ticket notes include migration progress for remaining collections.

## References
- `functions/src/index.ts:1837`
- `functions/src/integrationEvents.ts:88`

