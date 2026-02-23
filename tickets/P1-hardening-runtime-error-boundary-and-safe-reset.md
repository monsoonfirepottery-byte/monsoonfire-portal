# P1 — Runtime ErrorBoundary and Safe Reset Hardening

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Platform + Security
Type: Ticket
Parent Epic: tickets/P1-EPIC-13-reliability-hardening-failure-mode-first-ux.md

## Objective

Prevent blank-screen failures by hardening top-level error boundaries and adding safe recovery options.

## Tasks

1. Ensure top-level ErrorBoundary wraps portal app.
2. Add recover actions (reload + safe state reset).
3. Add website runtime fallback behavior for script errors where applicable.

## Acceptance Criteria

1. Runtime exceptions render a recoverable UI.
2. Recovery controls do not expose secrets or bypass auth.
3. Safe reset path handles corrupted local preference state.
