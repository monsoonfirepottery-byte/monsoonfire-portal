# Journey + Stripe Testing Plan

Status: Active (Epic 12 execution)
Date: 2026-02-22
Owner: QA + Portal + Functions

## Purpose

Define a deterministic, layered testing system for:

1. client journey correctness (dropoff -> queue -> ready -> pickup -> close)
2. continue journey/history/timeline correctness
3. Stripe negative outcomes (failed card, dispute/chargeback, refund, replay/out-of-order events)

This plan is the authoritative matrix for Epic 12.

## Testing layers

1. Unit tests
   - Pure logic and contract normalization.
2. Integration tests (functions/web with mocks)
   - Handler-level behavior and envelopes with deterministic fixtures.
3. Emulator contract tests
   - Firestore + function workflow state transitions under seeded data.
4. Client E2E tests (Playwright)
   - User-visible journey behavior across core lifecycle routes.
5. Smoke tests
   - Runtime/readiness checks; not a replacement for journey assertions.

## Scenario matrix

| ID | Area | Scenario | Layer | Expected result | Status |
|---|---|---|---|---|---|
| J-001 | Journey | Create intake/dropoff request | integration + emulator | reservation created with expected defaults and owner scoping | Implemented |
| J-002 | Journey | Queue progression through operational stages | emulator | allowed transitions succeed and audit metadata recorded | Planned |
| J-003 | Journey | Mark ready-for-pickup | emulator + e2e | user-facing status and timeline update visible | Planned |
| J-004 | Journey | Complete pickup/closeout | emulator + e2e | record closes cleanly and leaves active queue | Planned |
| J-005 | Journey | Invalid transition (out-of-order) | integration + emulator | deterministic error contract and no partial writes | Implemented |
| J-006 | Journey | Unauthorized transition attempt | integration + emulator | permission failure and no state mutation | Existing |
| J-007 | Continue journey | continueJourney success with `{uid, fromBatchId}` | unit + integration | response includes deterministic batch linkage fields | Implemented |
| J-008 | Continue journey | continueJourney missing input | unit + integration | explicit validation error envelope | Existing |
| J-009 | Continue journey | history/timeline sync after continuation | emulator | active/history/timeline remain consistent | In Progress |
| J-010 | Continue journey | ownership mismatch on continuation | integration | authz/ownership error with no data drift | Planned |
| S-001 | Stripe negative | Invalid webhook signature | unit | request rejected with signature error code | Existing |
| S-002 | Stripe negative | Livemode mismatch | unit | request rejected with livemode mismatch code | Existing |
| S-003 | Stripe negative | payment_intent.payment_failed | unit + integration | mapped status/error outcome is explicit and deterministic | Implemented |
| S-004 | Stripe negative | invoice.payment_failed | unit + integration | mapped status/error outcome is explicit and deterministic | Implemented |
| S-005 | Stripe negative | charge.dispute.created | unit + integration | dispute state/audit markers asserted | Implemented |
| S-006 | Stripe negative | charge.dispute.closed | unit + integration | resolution path state is deterministic | Gap |
| S-007 | Stripe negative | charge.refunded (full) | unit + integration | refund state transitions and totals validated | Implemented |
| S-008 | Stripe negative | charge.refunded (partial) | unit + integration | partial refund accounting/status validated | Implemented (contract-level) |
| S-009 | Stripe negative | replay duplicate webhook | unit + integration | duplicate processing is safely ignored/idempotent | Existing |
| S-010 | Stripe negative | out-of-order event delivery | integration | stable final state regardless of event order | Implemented |

## Required artifacts per run

1. Command and git SHA
2. Scenario IDs executed
3. Pass/fail summary
4. First failing assertion and file reference
5. Relevant logs (sanitized; no secrets)
6. Screenshots/video for E2E failures when applicable

## CI lane design

1. Fast lane (PR blocking)
   - deterministic unit/integration subset for J-001, J-005, J-007, S-001, S-002, S-003
2. Deep lane (scheduled/nightly)
   - fast lane + full functions suite + web contract tests + optional credential-gated smoke/e2e steps
3. Promotion rule
   - deep-lane scenarios can be promoted into fast lane once stable and performant

## Immediate gaps to close

1. Add runtime assertions for `continueJourney` post-conditions across active/history/timeline surfaces.
2. Add dispute-resolution (`charge.dispute.closed`) policy simulation with explicit audit-trail assertions.
3. Promote optional Playwright journey coverage to required deep-lane once deterministic CI credentials/seed data are available.

## Command map (current)

1. Core:
   - `npm run test:functions`
   - `npm run test:web`
   - `npm run portal:smoke:playwright`
2. Epic 12 journey lanes:
   - `npm run test:journey:fast`
   - `npm run test:journey:deep`
   - `npm run test:stripe:negative`
   - `npm run test:journey:contracts`
   - optional deep step: set `MF_RUN_RESERVATIONS_PLAYWRIGHT=1` with `PORTAL_CLIENT_PASSWORD` to run reservations Playwright assertions

## Progress snapshot (2026-02-22)

1. Added Stripe negative contract mappings + tests for:
   - `payment_intent.payment_failed`
   - `invoice.payment_failed`
   - `charge.dispute.created`
   - `charge.refunded`
2. Added reservation journey contract tests for dropoff/pickup edge behavior in `functions/src/apiV1.test.ts`.
3. Added deterministic lane runner and contract checks:
   - `scripts/run-journey-suite.mjs`
   - `scripts/check-continue-journey-contract.mjs`
   - `scripts/check-journey-fixtures.mjs`
4. Added strict smoke fixture baseline:
   - `functions/scripts/fixtures/agent-commerce-smoke.base.json`
5. Added operational runbook:
   - `docs/runbooks/JOURNEY_TESTING_RUNBOOK.md`
6. Added Stripe negative-outcome lifecycle status mapping hardening:
   - `functions/src/stripeConfig.ts`
