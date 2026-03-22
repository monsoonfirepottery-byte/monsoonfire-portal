# P2 — Selective Firestore rules runner

Status: Active
Date: 2026-03-21
Priority: P2
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-codex-efficiency-and-startup-reliability.md

## Problem
`npm run test:rules` always runs the full suite, which is slower and noisier than necessary for small auth/rules edits.

## Tasks
1. Add `--files`, `--match`, and changed-file targeting to `scripts/test-rules.mjs`.
2. Keep full-suite mode as the default CI behavior.
3. Document selective local usage in the emulator/rules runbook.

## Acceptance Criteria
1. Operators can run a subset of rules tests locally without changing the CI default.
2. The runner still performs the same Java/Firebase bootstrap path for full-suite mode.
