# P1 — Network Offline/Timeout and Retry Surface

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Platform + UX
Type: Ticket
Parent Epic: tickets/P1-EPIC-13-reliability-hardening-failure-mode-first-ux.md

## Objective

Make offline and unstable-network states explicit with reusable banner UX and retry controls.

## Tasks

1. Add online/offline detection in portal shell.
2. Show global offline banner with retry guidance.
3. Ensure retry actions are available on affected views.

## Acceptance Criteria

1. Offline state is visible without requiring console logs.
2. Users get actionable "Try again" path.
3. Banner clears automatically when back online.
