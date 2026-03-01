# P2 — Events: QA Runbook and Canary Regression Gate

Status: Active
Date: 2026-03-01
Priority: P2
Owner: QA Automation + Frontend
Type: Ticket
Parent Epic: tickets/P1-EPIC-20-events-page-industry-events-local-remote-expansion.md

## Problem

Industry-event listings are vulnerable to silent regressions (empty rails, stale cards, broken links) if not explicitly monitored.

## Objective

Introduce deterministic QA runbook and canary checks for industry-event quality and rendering reliability.

## Scope

1. Runbook for manual verification (local + prod smoke).
2. Automated canary checks for:
   - non-empty feed when fixtures exist
   - filter behavior
   - valid outbound links
   - stale-event suppression
3. Artifact output for failures.

## Tasks

1. Create runbook covering member and staff verification flows.
2. Add canary script assertions for industry-events panel.
3. Add scheduled workflow or gate hook for ongoing checks.
4. Add escalation guidance for stale-feed incidents.

## Acceptance Criteria

1. Team has a repeatable test plan for industry-events reliability.
2. Canary catches card-shape and stale-feed regressions before release.
3. Failures provide enough context to debug quickly.
4. Verification can run without touching lending modules.
