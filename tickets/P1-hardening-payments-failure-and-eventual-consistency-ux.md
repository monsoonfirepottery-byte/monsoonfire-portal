# P1 — Payments Failure and Eventual Consistency UX Hardening

Status: Completed
Completed: 2026-02-23
Date: 2026-02-22
Priority: P1
Owner: Payments + Platform + Security
Type: Ticket
Parent Epic: tickets/P1-EPIC-13-reliability-hardening-failure-mode-first-ux.md

## Objective

Harden checkout/payment UX for provider failures, config mismatches, and webhook-in-flight states.

## Tasks

1. Distinguish transient provider/network failures from permanent config failures.
2. Add eventual-consistency messaging for webhook-processing lag.
3. Ensure duplicate payment action prevention remains intact.

## Acceptance Criteria

1. Payment failure copy is specific and calm.
2. Retry paths are available where safe.
3. Payment UX preserves idempotent/non-destructive defaults.
