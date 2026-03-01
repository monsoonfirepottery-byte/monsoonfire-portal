# P2 — Requests Canary, Runbook, and Doc Cleanup

Status: Completed
Date: 2026-02-27
Priority: P2
Owner: QA Automation + Docs
Type: Ticket
Parent Epic: tickets/P1-EPIC-19-requests-surface-deprecation-and-agent-intake-rationalization.md

## Problem

Automation checks and runbooks still reference Requests-related paths and endpoints that may be retired.

## Objective

Align canaries, smoke probes, and documentation with the post-Requests architecture.

## Tasks

1. Remove or revise stale Requests assertions in smoke/canary scripts.
2. Update QA runbooks to reference replacement user journeys.
3. Deprecate obsolete docs and link forward to current operational flows.

## Acceptance Criteria

1. CI automation remains green with no stale Requests dependencies.
2. Runbooks describe current supported workflows only.
3. Portal docs do not direct members to removed Requests UI.

## Implementation Log

1. Added authenticated canary coverage that verifies legacy `/requests` links route to supported destinations and display migration guidance.
2. Updated non-staff QA loop runbook to explicitly validate Requests fallback behavior and replacement-path outcomes.
3. Updated automation matrix to document the new canary coverage and tie it to replacement routes.

## Evidence

1. Canary assertions: `scripts/portal-authenticated-canary.mjs`
2. QA loop updates: `docs/runbooks/PORTAL_QA_LOOP_NON_STAFF.md`
3. Automation matrix updates: `docs/runbooks/PORTAL_AUTOMATION_MATRIX.md`

## Validation

1. `npm run portal:canary:auth -- --json` (run in CI cadence; local run optional due credential requirements)
