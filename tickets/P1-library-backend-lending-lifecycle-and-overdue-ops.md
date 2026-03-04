# P1 — Library Backend: Lending Lifecycle and Overdue Operations

Status: In Progress
Date: 2026-03-01
Priority: P1
Owner: Platform Backend + Library Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Borrow/return/lost handling lacks a single enforced state machine with scheduler-backed overdue transitions, increasing risk of invalid states and manual cleanup.

## Objective

Implement the full lending lifecycle backend with strict state transitions, overdue automation, reminder events, and admin recovery endpoints.

## Scope

1. Contract mapping (API): `docs/library/API_CONTRACTS.md` sections 4, 5, 6, and 8 for:
- `POST /api/library/items/:itemId/borrow`
- `POST /api/library/borrows/:borrowId/check-in`
- `GET /api/library/me/borrows`
- `POST /api/admin/library/borrows/:borrowId/mark-lost`
- `POST /api/admin/library/borrows/:borrowId/assess-replacement-fee`
- `POST /api/admin/library/items/:itemId/override-status`
- overdue reminder events (`library.borrow_due_7d`, `library.borrow_due_1d`, `library.borrow_overdue_3d`)
2. Contract mapping (schema): `docs/library/SCHEMA_RELATIONAL.md` sections 5, 6, and 7 using:
- `borrow_transactions`, `donations`, `library_items`, `users`, `audit_log`
- one-active-borrow partial unique index and due-date indexes
3. State machine enforcement for allowed transitions and `409 CONFLICT` for rejected transitions.
4. Scheduler/worker coverage for overdue promotion and reminder emission with idempotent event dispatch.
5. Admin fee/lost flows with replacement snapshot consistency and payment status traceability.

## Tasks

1. Implement borrow checkout with role checks, lending-eligibility checks, transactional availability lock, and `due_at = checked_out_at + 28 days`.
2. Implement check-in with borrower/admin authorization and item status reconciliation back to `available`.
3. Implement `GET /api/library/me/borrows` timeline returning active plus historical rows sorted by recency.
4. Implement admin `mark-lost`, `assess-replacement-fee`, and status override handlers with explicit reason codes and operator notes.
5. Add overdue scheduler that transitions `checked_out` to `overdue` and emits reminder events on 7d/1d pre-due and 3d post-due milestones.
6. Enforce transition matrix from API contract section 6 and block invalid transitions with machine-readable conflict details.
7. Add integration tests for concurrent borrow attempts, overdue transitions, lost/replacement flows, and admin override recovery paths.

## Acceptance Criteria

1. Lifecycle endpoints implement all contract-defined transitions and reject unsupported transitions with `409 CONFLICT`.
2. Only one active borrow transaction can exist per item at any time, enforced at the data layer.
3. Borrow creation always sets a 28-day due date and updates item status atomically.
4. Reminder events are emitted exactly once per configured reminder stage per borrow.
5. Admin lost/replacement endpoints persist replacement snapshot and payment-status fields as defined in schema.
6. Member borrow timeline endpoint returns both active and historical records without exposing soft-deleted rows.
7. Backend tests cover normal, conflict, and recovery scenarios for borrow/check-in/overdue/lost flows.

## Execution Update (2026-03-01)

Completed in this slice:
1. Implemented member lifecycle endpoints in `functions/src/apiV1.ts`:
   - `POST /v1/library.loans.checkout`
   - `POST /v1/library.loans.checkIn`
   - `POST /v1/library.loans.listMine`
2. Added transition guardrails and reason-code conflict responses for invalid checkout/check-in transitions.
3. Implemented admin recovery endpoints:
   - `POST /v1/library.loans.markLost`
   - `POST /v1/library.loans.assessReplacementFee`
   - `POST /v1/library.items.overrideStatus`
4. Added recovery-path regression tests in `functions/src/apiV1.test.ts` for staff authorization and success cases.
5. Added overdue automation in `functions/src/library.ts`:
   - scheduled overdue sync (`syncLibraryLoanOverdues`) with environment-configurable cadence,
   - idempotent reminder-event emission for 7-day, 1-day, and 3-day overdue stages,
   - manual ops trigger route `runLibraryOverdueSyncNow`.

Remaining:
1. Add deeper overdue worker integration assertions that validate reminder-stage emission persistence under mixed-status loan sets.

## Execution Update (2026-03-01, Deep Pass)

Completed in this pass:
1. Added lending-write idempotency support for:
   - `POST /v1/library.loans.checkout`
   - `POST /v1/library.loans.checkIn`
   - `POST /v1/library.loans.markLost`
   - `POST /v1/library.loans.assessReplacementFee`
2. Added deterministic replay + conflict semantics for reused idempotency keys with payload mismatch (`409 CONFLICT`, `IDEMPOTENCY_KEY_CONFLICT`).
3. Added checkout race regression coverage in `functions/src/apiV1.test.ts`:
   - concurrent checkout attempts against a single-copy item now assert one success + one conflict (`NO_AVAILABLE_COPIES`).
