# P1 — Staff Role Source-of-Truth Contract

Status: Proposed
Date: 2026-02-18
Priority: P1
Owner: Portal + Security
Type: Ticket
Parent Epic: tickets/P1-EPIC-02-auth-role-consistency-and-traceability.md

## Problem
Current role behavior is described in multiple docs and inferred in multiple code points without a single contract.

## Objective
Publish and adopt one contract for staff role and permission derivation.

## Scope
1. Capture authoritative role fields and precedence in a short contract doc update.
2. Define expected behavior for missing/legacy token fields.
3. Define fallback policy for compatibility-only migration windows.

## Tasks
1. Add/update a concise contract section in docs and link from onboarding/runbook paths.
2. Map each protected client path to its role inputs and expected outputs.
3. Define explicit failure modes for missing/invalid role claims.

## Acceptance Criteria
1. Contract is explicit on claim source, precedence, and deprecation policy.
2. All staff-gated paths reference the contract before changes.
3. Legacy compatibility notes are temporary and time-boxed.

## References
- `docs/DESIGN_2026-01-20.md:37`
- `docs/STAFF_CLAIMS_SETUP.md`
- `web/src/App.tsx:1017`

