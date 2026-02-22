# Epic: P1 — Security Surface Hardening and Trust Controls

Status: Completed
Date: 2026-02-18
Priority: P1
Owner: Security + Functions + Studio Brain Teams
Type: Epic

## Problem
Several trust boundaries still depend on placeholders or legacy pathways, weakening verification and auditability across runtime surfaces.

## Objective
Close obvious trust-surface gaps and enforce concrete verification posture for skill execution and legacy auth cleanup.

## Tickets
- `tickets/P1-studio-brain-skill-trust-anchor-hardening.md`
- `tickets/P2-legacy-archived-auth-route-deprecation-gate.md`
- `tickets/P2-skill-install-verification-and-telemetry.md`

## Scope
1. Move skill verification from placeholder to anchored trust checks.
2. Remove or gate stale auth/archive paths to prevent accidental reuse.
3. Add security telemetry for trust-reliance decisions.

## Dependencies
- `studio-brain/docs/SKILL_SECURITY_MODEL.md`
- `functions/archive/index_old.ts`

## Acceptance Criteria
1. No production trust decision depends on placeholder values.
2. Legacy archived auth paths are either removed or hard-gated.
3. Security-sensitive decisions emit explicit audit telemetry.

## Definition of Done
1. Parent ticket close criteria include evidence in runbook and code review.
2. Known bypass paths are documented and assigned owners.
3. Telemetry confirms no untracked fallback trust usage.

## Completion Notes (2026-02-22)
1. Replaced signature placeholder flow with trust-anchor verification in `studio-brain/src/skills/trustAnchor.ts` and wired deny-default behavior into `studio-brain/src/skills/ingestion.ts`.
2. Added structured install verification telemetry (`started`, `fallback`, `failed`, `success`) and regression tests in `studio-brain/src/skills/ingestion.test.ts` and `studio-brain/src/skills/trustAnchor.test.ts`.
3. Added legacy archive route runtime gate in `functions/archive/index_old.ts` and CI/build guard in `functions/scripts/check-archive-deprecation-gate.mjs`, wired into `functions/package.json`.
