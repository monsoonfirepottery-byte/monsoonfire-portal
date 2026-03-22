# P3 — Firestore rules log noise normalization

Status: Active
Date: 2026-03-21
Priority: P3
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-codex-efficiency-and-startup-reliability.md

## Problem
Expected permission-denied paths in the Firestore emulator still produce noisy logs, which makes real failures harder to scan quickly.

## Tasks
1. Normalize or collapse expected denial noise in local rules test output.
2. Preserve visibility for unexpected emulator failures and genuine assertion failures.

## Acceptance Criteria
1. Expected denial tests remain readable without masking real regressions.
2. Operators can still identify real rules failures at a glance.
