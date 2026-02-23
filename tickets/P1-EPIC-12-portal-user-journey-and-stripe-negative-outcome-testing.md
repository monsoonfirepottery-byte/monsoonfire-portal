# Epic: P1 — Portal User Journey + Stripe Negative Outcome Testing

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: QA + Portal + Functions + Security Review
Type: Epic

## Problem

Current automation in this repo is strong for smoke/runtime checks, but it does not yet guarantee end-to-end business journey correctness for:

1. client dropoff to ready/pickup lifecycle continuity
2. pickup closeout outcomes
3. Stripe negative outcomes such as failed cards, disputes/chargebacks, and refund-edge sequencing

Without a dedicated journey + negative-path test system, regressions can ship while smoke checks still pass.

## Objective

Create a deterministic, layered testing program that proves client journey correctness and Stripe negative-outcome handling before merge and release.

## Tickets

- `tickets/P1-journey-test-plan-and-scenario-matrix.md`
- `tickets/P1-dropoff-to-pickup-emulator-journey-contract-tests.md`
- `tickets/P1-stripe-negative-webhook-and-payment-contract-tests.md`
- `tickets/P2-playwright-client-dropoff-pickup-journey-regression.md`
- `tickets/P2-continue-journey-history-timeline-regression-suite.md`
- `tickets/P2-chargeback-dispute-and-refund-ops-simulation-tests.md`
- `tickets/P2-agent-commerce-smoke-strict-mode-and-fixtures.md`
- `tickets/P2-journey-test-fixtures-and-seed-governance.md`
- `tickets/P2-ci-fast-vs-deep-journey-test-lanes.md`
- `tickets/P2-journey-testing-runbook-and-release-evidence.md`

## Scope

### Phase 1 — Test design and deterministic foundation

1. Define canonical journey matrix for dropoff/pickup/continue-journey and Stripe negative outcomes.
2. Standardize emulator fixtures and deterministic seed data for scenario replay.
3. Ensure each scenario maps to explicit expected state transitions and evidence artifacts.

### Phase 2 — Journey + payment negative coverage

1. Add emulator-level contract tests for reservation lifecycle journey states.
2. Add Stripe negative-event handling tests (failed payment, disputed charge, refunded charge, replay/out-of-order webhooks).
3. Add focused Playwright flows that exercise client-visible journey behavior.

### Phase 3 — Gates and release confidence

1. Split CI into deterministic fast lane (PR) and deep lane (scheduled/nightly) without flaky external dependencies.
2. Add runbook + release evidence requirements so test gaps are visible before launch windows.
3. Add failure triage guidance for journey and Stripe regressions.

## Non-goals

1. No live Stripe network dependency in blocking CI checks.
2. No weakening of auth/access control to make tests pass.
3. No replacement of existing smoke gates; this extends them with journey correctness.

## Milestones

1. M1: Journey matrix and deterministic seed model finalized and in repo.
2. M2: Dropoff/pickup + Stripe negative contract suites are runnable locally and in CI.
3. M3: Fast/deep lanes and runbook evidence are merged and enforced.

## Acceptance Criteria

1. Canonical test matrix exists and covers:
   - dropoff intake
   - queue/stage transitions
   - ready-for-pickup and pickup closeout
   - continue journey batch workflow
   - Stripe failure, dispute/chargeback, and refund sequencing
2. Deterministic automated tests exist for both:
   - journey lifecycle state transitions
   - Stripe negative outcomes and idempotency/replay behavior
3. CI has a fast deterministic lane for PRs and a deep lane for expanded scenario coverage.
4. Runbook documents how to add scenarios, run suites locally, and attach release evidence artifacts.
5. Epic appears in `node ./scripts/epic-hub.mjs list` and child tickets are trackable via epic hub.

## Dependencies

- `scripts/epic-hub.mjs`
- `docs/runbooks/PR_GATE.md`
- `scripts/portal-playwright-smoke.mjs`
- `functions/src/apiV1.ts`
- `functions/src/stripeConfig.ts`
- `functions/src/stripeConfig.test.ts`
- `functions/scripts/agent_commerce_smoke.js`
- `docs/API_CONTRACTS.md`
- `docs/DEEP_LINK_CONTRACT.md`

## Definition of Done

1. Every scenario in the matrix maps to at least one executable test.
2. Negative payment outcomes are explicitly tested and asserted.
3. CI gates are deterministic and stable.
4. Regression evidence is reviewable by QA and release owners.

## Kickoff Progress

- 2026-02-22: Epic opened with 10 child tickets and initial matrix draft in `docs/runbooks/JOURNEY_AND_STRIPE_TESTING_PLAN.md`.

## Execution Notes (2026-02-22)

1. Completed:
   - `tickets/P1-journey-test-plan-and-scenario-matrix.md`
   - `tickets/P1-dropoff-to-pickup-emulator-journey-contract-tests.md`
   - `tickets/P1-stripe-negative-webhook-and-payment-contract-tests.md`
   - `tickets/P2-agent-commerce-smoke-strict-mode-and-fixtures.md`
   - `tickets/P2-journey-test-fixtures-and-seed-governance.md`
   - `tickets/P2-ci-fast-vs-deep-journey-test-lanes.md`
   - `tickets/P2-journey-testing-runbook-and-release-evidence.md`
2. In Progress:
   - none
3. Blocked:
   - none
4. Shippable now:
   - deterministic `fast` and `deep` journey lanes are green
   - deep-lane reservations Playwright step can be promoted to required mode with deterministic CI credentials via `MF_REQUIRE_RESERVATIONS_PLAYWRIGHT=1`

## Closure Notes (2026-02-23)

1. Completed `continueJourney` runtime post-condition assertions via contract helper/tests:
   - `functions/src/continueJourneyContract.ts`
   - `functions/src/continueJourneyContract.test.ts`
   - `scripts/check-continue-journey-contract.mjs`
2. Completed dispute-resolution and audit-trail simulation hardening:
   - `functions/src/stripeConfig.ts`
   - `functions/src/stripeConfig.test.ts`
3. Completed deep-lane Playwright deterministic credential gating:
   - `scripts/run-journey-suite.mjs`
   - `.github/workflows/ci-smoke.yml`
