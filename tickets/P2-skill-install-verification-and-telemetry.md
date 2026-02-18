# P2 — Skill Install Verification and Telemetry

Status: Proposed
Date: 2026-02-18
Priority: P2
Owner: Studio Brain Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-05-security-surface-hardening-and-trust-controls.md

## Problem
Skill install operations can accept weakly validated states without operator-level observability.

## Objective
Add high-signal telemetry around every verification decision in the skill install pipeline.

## Scope
1. Emit events for verify start, verification success, verify fail, and fallback.
2. Add explicit rejection reasons for missing chain/trust data.
3. Tie telemetry to audit trail identifiers for review.

## Tasks
1. Instrument verification entry and exit points with structured events.
2. Add event sampling or retention policy for high-volume attempts.
3. Add query examples for operations team.

## Acceptance Criteria
1. Every install flow records verification outcome.
2. Fallback cases are distinct from success/fail outcomes.
3. Audit and operations can trace each skill action to telemetry.

## References
- `studio-brain/docs/SKILL_SECURITY_MODEL.md:77`
- `studio-brain/src/skills/ingestion.test.ts`

