# P1 — Shared AppError Model and Reusable Error UI

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Platform + UX
Type: Ticket
Parent Epic: tickets/P1-EPIC-13-reliability-hardening-failure-mode-first-ux.md

## Problem

Portal error handling is uneven across views, making failures harder to interpret and recover from.

## Objective

Introduce a shared AppError contract and reusable ErrorBanner/ErrorPanel components for consistent client-facing messaging and diagnostics.

## Scope

- `web/src/utils/*` error model helpers
- `web/src/components/ErrorBanner.tsx`
- `web/src/components/ErrorPanel.tsx`
- initial wiring in high-impact views

## Tasks

1. Define typed `AppError` shape and classification helper.
2. Include user-safe message, debug detail, retryability, and support code.
3. Implement reusable ErrorBanner UI.
4. Implement reusable ErrorPanel UI for advanced diagnostics.
5. Wire components into at least two critical portal surfaces.

## Acceptance Criteria

1. Error UI uses shared components (not ad-hoc strings only).
2. AppError includes `kind`, `userMessage`, `debugMessage`, `correlationId`, `retryable`.
3. Banner copy is calm and actionable.
