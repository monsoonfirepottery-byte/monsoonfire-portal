# P2 — Deterministic CI Failure-Mode Regression Lane

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Platform + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-13-reliability-hardening-failure-mode-first-ux.md

## Objective

Add deterministic checks for hardening behaviors without external-service flake.

## Tasks

1. Add unit checks for AppError classification and message shaping.
2. Add deterministic request-capture contract checks.
3. Gate lane in CI after stabilization.

## Acceptance Criteria

1. Checks run locally and in CI without network dependency.
2. Failures identify specific file/behavior drift.
3. Lane remains stable across PRs.
