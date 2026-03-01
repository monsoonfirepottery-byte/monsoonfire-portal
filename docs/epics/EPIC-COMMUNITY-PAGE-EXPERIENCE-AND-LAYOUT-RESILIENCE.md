# EPIC: COMMUNITY-PAGE-EXPERIENCE-AND-LAYOUT-RESILIENCE

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Member Experience + Frontend + QA Automation
Type: Epic
Epic Ticket: tickets/P1-EPIC-18-community-page-experience-and-layout-resilience.md

## Problem

The Community page copy feels uneven in places and the right rail can degrade under async content loads, especially when report history and chiplets refresh.

## Objective

Improve Community page clarity and tone for members while hardening right-rail layout behavior and adding canary coverage for intermittent overflow regressions.

## Scope

1. Humanized copy and flow pass for Community page sections.
2. Right-rail and chiplet layout stability under async loading states.
3. Automated canary + workflow for intermittent sidebar/chiplet overflow failures.
4. Follow-up content governance guidance for rotating community cards safely.

## Decision Log

1. Keep Community within the existing portal for now; prioritize readability + resilience before structural moves.
2. Add deterministic data hooks (`data-community-*`) to support reliable regression probes.
3. Treat right-rail overflow as a production stability concern and gate it with scheduled canary checks.

## Tasks

1. Update Community copy for clearer member-first language and flow.
2. Harden sidebar/chiplet CSS against dynamic width and overflow issues.
3. Implement and ship Playwright-based Community layout canary.
4. Add scheduled GitHub workflow and artifact reporting.
5. Document operational expectations for content rotation and layout-safe card formatting.

## Acceptance Criteria

1. Community copy is clearer, more natural, and aligned to member workflows.
2. Right rail remains visually stable after report-history refresh and async data load.
3. No chiplet text clipping/overflow in normal desktop and mobile layouts.
4. Canary runs on schedule and fails on detectable layout regressions.
5. Team has a documented path for maintaining layout-safe content updates.

## Child Tickets

- tickets/P1-EPIC-18-community-page-experience-and-layout-resilience.md
- tickets/P1-community-copy-and-flow-humanization-pass.md
- tickets/P1-community-right-rail-layout-stability-and-chiplet-overflow-guard.md
- tickets/P1-community-layout-intermittent-regression-canary-and-workflow.md
- tickets/P2-community-page-content-governance-and-rotation-runbook.md

## Completion Summary (2026-02-28)

1. Community copy/flow pass shipped with member-first language and clearer action guidance.
2. Right-rail/chiplet layout hardening shipped in Community CSS/markup.
3. Community layout canary + scheduled workflow shipped with artifact capture.
4. Content rotation governance runbook added and linked into automation docs.
