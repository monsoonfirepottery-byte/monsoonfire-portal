# P2 — Remove Unsafe `as any` in High-Risk Function Paths

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Functions Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-04-functions-type-safety-and-data-contract-fidelity.md

## Problem
Unsafe casts are currently present in core handlers and can hide schema mismatches and undefined behavior.

## Objective
Eliminate or narrow `as any` usage in high-risk functions and replace with safe parsing.

## Scope
1. Audit high-impact files for unsafe casts and replace with guards.
2. Add regression tests for malformed fields.
3. Prevent silent acceptance of malformed documents.

## Tasks
1. Refactor casting in `functions/src/integrationEvents.ts:88`, `functions/src/jukebox.ts:264`, and related handlers.
2. Add schema-safe read helpers for payment and reservation event payloads.
3. Enforce compile-time checks in touched modules where feasible.

## Acceptance Criteria
1. Targeted `as any` instances are replaced or documented with explicit justification.
2. Input validation catches malformed payloads with structured errors.
3. Unit tests verify parser behavior under type violations.

## References
- `functions/src/integrationEvents.ts:88`
- `functions/src/jukebox.ts:264`
- `functions/src/materials.ts:688`
