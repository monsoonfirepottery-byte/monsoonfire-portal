# P1 — Journey Test Plan and Scenario Matrix

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: QA + Portal
Type: Ticket
Parent Epic: tickets/P1-EPIC-12-portal-user-journey-and-stripe-negative-outcome-testing.md

## Problem

Critical user journeys and payment-negative outcomes do not have a single canonical matrix that maps intent to deterministic test execution.

## Objective

Publish the canonical scenario matrix for dropoff/pickup/continue-journey and Stripe negative outcomes, with explicit pass/fail assertions and evidence requirements.

## Scope

- `docs/runbooks/JOURNEY_AND_STRIPE_TESTING_PLAN.md`
- test-layer mapping (unit, integration, emulator contract, Playwright)
- scenario IDs and expected outcomes

## Tasks

1. Define scenario IDs and coverage buckets for all critical journeys.
2. Define Stripe negative-outcome scenario IDs and expected state transitions.
3. Map every scenario to test layer and command path.
4. Define mandatory evidence fields for release review.
5. Add gap list where no executable test exists yet.

## Acceptance Criteria

1. Plan document exists and is versioned in repo.
2. Document includes at least one happy-path and one negative-path scenario per critical flow.
3. Each scenario has an explicit expected result and owning test layer.
4. Gaps are visible and linked to follow-up tickets.

## Dependencies

- `docs/runbooks/PR_GATE.md`
- `functions/src/apiV1.ts`
- `functions/src/stripeConfig.ts`
- `scripts/portal-playwright-smoke.mjs`

## Progress Notes

- 2026-02-22: Created kickoff draft at `docs/runbooks/JOURNEY_AND_STRIPE_TESTING_PLAN.md` with initial journey and Stripe negative scenario matrix.
- 2026-02-22: Updated matrix and command map with implemented fast/deep lane coverage, fixture checks, and Stripe negative-event contract scenarios.
