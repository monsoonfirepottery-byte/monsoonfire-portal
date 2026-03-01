# P2 — Community Page Content Governance and Rotation Runbook

Status: Completed
Date: 2026-02-27
Priority: P2
Owner: Member Experience + Operations
Type: Ticket
Parent Epic: tickets/P1-EPIC-18-community-page-experience-and-layout-resilience.md

## Problem

Frequent content swaps (events/videos/quotes) can accidentally introduce layout-risky text patterns.

## Objective

Document content formatting and rotation rules that preserve layout safety and member clarity.

## Tasks

1. Define copy length and formatting guidelines for Community cards/chiplets.
2. Add publishing checklist with canary verification steps.
3. Record fallback/rollback steps for content-induced layout regressions.

## Acceptance Criteria

1. Runbook exists with clear editor-safe content constraints.
2. Staff can rotate Community content without introducing avoidable UI regressions.
3. Canary verification is part of the content update checklist.

## Implementation Log

1. Added `docs/runbooks/COMMUNITY_CONTENT_ROTATION_RUNBOOK.md` with concrete hard copy limits for Community content fields.
2. Documented safe formatting rules to prevent known overflow and layout-risky patterns.
3. Added required canary verification commands and pass criteria for post-edit validation.
4. Added explicit rollback procedure (revert + rerun canaries + ticket evidence).

## Evidence

1. New runbook: `docs/runbooks/COMMUNITY_CONTENT_ROTATION_RUNBOOK.md`
2. Automation linkage: `docs/runbooks/PORTAL_AUTOMATION_MATRIX.md`

## Validation

1. `npm run portal:canary:community-layout` (required for each rotation)
