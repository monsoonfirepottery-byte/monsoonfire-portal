# P1 — Firestore Index/Permission/Partial-Data UX Guards

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Platform + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-13-reliability-hardening-failure-mode-first-ux.md

## Objective

Handle missing index, permission denied, and partial document states with explicit user-facing guidance and safe defaults.

## Tasks

1. Detect missing-index patterns and surface actionable guidance.
2. Normalize permission denied messaging.
3. Keep defensive typing on partial docs and avoid undefined writes.

## Acceptance Criteria

1. Missing index message points users/operators to runbook docs.
2. Permission errors are clear and non-technical.
3. Partial records do not crash render paths.
