# P2 — Home Automation + Camera Connector Stability and Source-of-Truth

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

Connector-backed automation (Hubitat, Home Assistant, Apple Home, and camera/IoT workflows) can drift out of sync with platform contracts, especially across environment moves from laptop-based development to Studiobrain-hosted services.

## Objective

Treat home automation and camera orchestration as a first-class source-of-truth domain for Epic-08 with clear contracts, auditability, and readiness checks.

## Scope

- `studio-brain/src/connectors/**` and associated connector tests
- `studio-brain/reports/connector-contract-summary.json` (or equivalent generated contract evidence)
- `studio-brain/lib/observability/*`
- `tickets/P2-agent-abuse-controls-and-observability.md` (if overlapping safety constraints)
- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `scripts/source-of-truth-deployment-gates.mjs`

## Tasks

1. Add explicit source entries for:
   - Hubitat connector identifiers and auth boundaries
   - Apple Home / Siri-related route assumptions (if present)
   - Home Assistant or other home-automation connectors used in this repo
   - Camera/device discovery workflows and their runbook owners
2. Require each connector capability package to expose a schema/signature file that can be lint-checked.
3. Add evidence artifacts proving connector contract signatures and policy scope during release smoke.
4. Add remediation guidance for revoked tokens, stale credentials, and network partition of camera/integration services.

## Acceptance Criteria

1. Source-of-truth index explicitly tracks home automation connector families and their authoritative documentation.
2. Deployment readiness gates fail if connector evidence is stale/missing in Epic-08 mode.
3. Rollback guidance is documented for camera/home automation connector failures.
4. Connector scope changes require ticketed approval and index updates.

## Definition of Done

- Home automation domains are no longer considered "soft assumptions" in readiness checks.
- Connector drift for Hubitat/Home Assistant/apple home family is observable in gate evidence.
- A clear owner and update process exists for future automation connector changes.
