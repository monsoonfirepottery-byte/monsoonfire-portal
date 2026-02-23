# P1 — Functions Contract/Timeout/Idempotency UX Hardening

Status: Completed
Completed: 2026-02-23
Date: 2026-02-22
Priority: P1
Owner: Platform + API
Type: Ticket
Parent Epic: tickets/P1-EPIC-13-reliability-hardening-failure-mode-first-ux.md

## Objective

Improve handling for Cloud Function 400/401/403/429/5xx/timeout states and duplicate submissions.

## Tasks

1. Map common HTTP contract failures to stable AppError kinds.
2. Add retryable markers for transient failures.
3. Ensure in-flight guards and disabled actions on submit flows.

## Acceptance Criteria

1. Contract mismatch errors guide users to retry/correct input.
2. Timeouts and 5xx display retry-safe messaging.
3. Double-submit protections are visible and consistent.
