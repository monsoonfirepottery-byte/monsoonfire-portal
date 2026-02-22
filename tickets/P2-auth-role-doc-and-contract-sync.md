# P2 — Auth Role Documentation and Contract Sync

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Portal + Docs Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-02-auth-role-consistency-and-traceability.md

## Problem
Operational docs and codebase role handling drift can silently reintroduce assumptions during future auth updates.

## Objective
Make docs reflect the single role contract and keep enforcement tests aligned.

## Scope
1. Update docs to reference shared parser and authority source.
2. Add ticket link checks in docs to avoid stale role assumptions.
3. Validate runbooks and onboarding guidance.

## Tasks
1. Update `docs/DESIGN_2026-01-20.md` and related onboarding docs with one source-of-truth statement.
2. Add a short section on migration compatibility and deprecation windows.
3. Add reviewer checklist item for role contract check before auth changes are merged.

## Acceptance Criteria
1. Documentation and code contract references match on claims precedence.
2. No conflicting role assumptions remain between design docs and implementation.
3. Review checklist includes auth-role contract verification.

## References
- `docs/DESIGN_2026-01-20.md:37`
- `docs/STAFF_CLAIMS_SETUP.md`
