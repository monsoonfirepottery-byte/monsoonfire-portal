# P2 — Legacy Archived Auth Route Deprecation Gate

Status: Proposed
Date: 2026-02-18
Priority: P2
Owner: Functions Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-05-security-surface-hardening-and-trust-controls.md

## Problem
An archived auth code path remains present and can create confusion during incident or deployment scenarios.

## Objective
Retire or hard-gate legacy archived auth handling with explicit deployment checks.

## Scope
1. Review archived auth path and identify active call sites.
2. Add explicit deprecation guard and environment-based block.
3. Document removal schedule and exceptions.

## Tasks
1. Inspect `functions/archive/index_old.ts` for current security impact.
2. Add environment/build-time checks to prevent accidental runtime usage.
3. Add migration notes to auth playbooks and runbooks.

## Acceptance Criteria
1. Archived auth path cannot be exercised in production environments.
2. Any remaining use emits clear warning/deprecation event.
3. Migration plan and owner are documented for final removal.

## References
- `functions/archive/index_old.ts:598`

