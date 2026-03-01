# P2 — Library Backend: Observability, Audit, and Safeguards

Status: In Progress
Date: 2026-03-01
Priority: P2
Owner: Platform Backend + SRE + Library Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Library backend write paths are expanding quickly, but traceability and safeguard coverage are not yet consistently enforced across all endpoints and background jobs.

## Objective

Standardize request correlation, audit logging, alerting, and operational safeguards so failures and policy violations are detected and recoverable in production.

## Scope

1. Contract mapping (API): `docs/library/API_CONTRACTS.md` sections 2, 8, and 9 for:
- standard error envelope on all failures
- observability fields for all write endpoints (request id, actor, role, action, entity id, before/after summary, outcome)
- operational alerts for duplicate ISBN conflicts, replacement-fee failures, and stuck overdue jobs
2. Contract mapping (schema): `docs/library/SCHEMA_RELATIONAL.md` sections 1, 5, 6, and 7 using:
- shared audit/soft-delete field conventions
- `audit_log` table as system-of-record for write actions
- lifecycle-critical tables: `library_items`, `borrow_transactions`, `donations`, `tag_submissions`
3. Unified request-id propagation for HTTP endpoints and scheduled jobs.
4. Safeguard controls for repeated writes (idempotency keys where transitions are non-retriable by default).
5. Ops-facing health surfaces for overdue job lag, notification drift, and high-error endpoints.

## Tasks

1. Add middleware/helper to generate or propagate `x-request-id` and include `requestId` in every success/error payload.
2. Add centralized audit writer that records actor, role, action, entity, before/after summaries, and outcome for every library write endpoint.
3. Add audit coverage for background jobs (overdue transition scheduler and reminder emitter) with synthetic actor identity and correlation IDs.
4. Add alert counters/structured logs for:
- ISBN duplicate conflicts
- replacement fee assessment/payment failures
- overdue scheduler stalls and retry exhaustion
5. Add idempotency protection for borrow, check-in, mark-lost, and fee-assessment writes to prevent accidental duplicate transitions.
6. Add log redaction rules so auth tokens, payment secrets, and raw PII are never written to logs or audit blobs.
7. Add regression tests that assert audit events and request correlation exist for representative success, reject, and error branches.

## Acceptance Criteria

1. Every library write endpoint and lifecycle job emits a structured audit row with required contract fields.
2. All API errors use the documented envelope shape and include `requestId` for operator correlation.
3. Alerting is in place for duplicate ISBN conflicts, replacement-fee failures, and overdue-job stall conditions.
4. Idempotency safeguards prevent duplicate state transitions under retry/replay conditions.
5. Log payloads are redacted for sensitive headers/secrets and pass security review.
6. Ops can trace a single request ID through endpoint handling, DB mutation, and job side effects.
7. Test suite contains explicit observability assertions for both happy-path and failure-path writes.

## Execution Update (2026-03-01, Deep Pass)

Completed in this pass:
1. Added request correlation for standalone library HTTP endpoints in `functions/src/library.ts`:
   - generate/propagate `x-request-id`,
   - include `requestId` in success/error payloads,
   - standardize envelope semantics for manual refresh/sync and ISBN import paths.
2. Added structured job/ops audit emissions for scheduled and manual library jobs:
   - metadata refresh runs,
   - overdue sync runs,
   - request-id-linked correlation records for operations tracing.
3. Added lending-write idempotency controls in `functions/src/apiV1.ts` for non-retriable transitions:
   - checkout,
   - check-in,
   - mark-lost,
   - assess-replacement-fee.
4. Added regression tests in `functions/src/apiV1.test.ts` for idempotent replay and key-conflict behavior across lending write routes.
