# P2 — Journey Testing Runbook and Release Evidence

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: QA + Release
Type: Ticket
Parent Epic: tickets/P1-EPIC-12-portal-user-journey-and-stripe-negative-outcome-testing.md

## Problem

Without a runbook and evidence format, journey test execution and sign-off become inconsistent and hard to audit.

## Objective

Document how to run journey suites, triage failures, and attach release evidence consistently.

## Scope

- runbook for local + CI execution
- release evidence checklist
- failure triage and escalation path

## Tasks

1. Add runbook command matrix for each test layer.
2. Define required evidence artifacts per release cycle.
3. Add triage conventions for payment and lifecycle regressions.
4. Cross-link runbook from PR gate and source-of-truth docs.

## Acceptance Criteria

1. Runbook exists and is linked from release/gate docs.
2. Evidence checklist is clear and repeatable.
3. Triage path for journey/payment failures is documented.

## Dependencies

- `docs/runbooks/PR_GATE.md`
- `docs/SOURCE_OF_TRUTH_INDEX.md`

## Progress Notes

- 2026-02-22: Added `docs/runbooks/JOURNEY_TESTING_RUNBOOK.md` with lane usage, fixture governance, strict smoke guidance, and release evidence checklist.
- 2026-02-22: Linked journey runbook from `docs/runbooks/PR_GATE.md` and `docs/SOURCE_OF_TRUTH_INDEX.md`.
