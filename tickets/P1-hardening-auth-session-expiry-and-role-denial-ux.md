# P1 — Auth Session Expiry and Permission Denial UX Hardening

Status: Completed
Completed: 2026-02-23
Date: 2026-02-22
Priority: P1
Owner: Platform + Security
Type: Ticket
Parent Epic: tickets/P1-EPIC-13-reliability-hardening-failure-mode-first-ux.md

## Objective

Ensure auth failures (expired token, revoked session, missing auth) produce clear re-login guidance and no retry loops.

## Tasks

1. Map auth-related HTTP/Firebase failures to stable user-facing messages.
2. Add re-login guidance copy and support code display.
3. Ensure retry controls do not loop on repeated auth failures.

## Acceptance Criteria

1. Session-expired message is explicit and actionable.
2. Auth errors never reveal sensitive internals.
3. No infinite client retry loop on auth failure.
