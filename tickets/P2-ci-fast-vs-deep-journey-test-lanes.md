# P2 — CI Fast vs Deep Journey Test Lanes

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Platform + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-12-portal-user-journey-and-stripe-negative-outcome-testing.md

## Problem

Journey tests need broad coverage but must not slow or destabilize regular PR throughput.

## Objective

Split journey testing into deterministic fast PR checks and deeper scheduled checks.

## Scope

- fast lane command set for pull requests
- deep lane command set for nightly/scheduled runs
- failure routing and ownership

## Tasks

1. Define fast-lane scenario subset and command wiring.
2. Define deep-lane full matrix command wiring.
3. Update CI workflows and gate docs.
4. Add artifact retention paths for both lanes.

## Acceptance Criteria

1. PR lane remains deterministic and reasonably fast.
2. Deep lane covers expanded scenario matrix and runs on schedule.
3. Failures route to actionable owners with artifacts.

## Dependencies

- `.github/workflows/ci-smoke.yml`
- `docs/runbooks/PR_GATE.md`
- `package.json`

## Progress Notes

- 2026-02-22: Added lane orchestrator `scripts/run-journey-suite.mjs` with `fast` and `deep` modes plus JSON artifact support.
- 2026-02-22: Added root scripts `test:journey:fast`, `test:journey:deep`, and supporting contract commands in `package.json`.
- 2026-02-22: Wired fast lane as required in `.github/workflows/ci-smoke.yml`; deep lane remains manual/scheduled with optional credential-gated steps.
