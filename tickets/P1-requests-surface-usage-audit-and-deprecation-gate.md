# P1 — Requests Surface: Usage Audit and Deprecation Gate

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Platform + Product Analytics
Type: Ticket
Parent Epic: tickets/P1-EPIC-19-requests-surface-deprecation-and-agent-intake-rationalization.md

## Problem

We need a deterministic go/no-go signal before removing member Requests UX.

## Objective

Produce a dependency matrix for UI, APIs, automations, docs, and payment paths tied to Requests.

## Tasks

1. Inventory all references to `AgentRequestsView`, nav wiring, and request API endpoints.
2. Classify dependencies as `member-critical`, `staff-critical`, `system-only`, or `retirable`.
3. Publish a deprecation gate checklist with blockers and owners.

## Acceptance Criteria

1. A single markdown report identifies removal blockers and safe-to-remove paths.
2. Commission checkout dependency is explicitly called out with replacement owner.
3. Epic execution can proceed without hidden dependencies.

## Implementation Log

1. Audit report added: `docs/audits/REQUESTS_SURFACE_DEPRECATION_AUDIT_2026-02-27.md`.
2. Member commission checkout dependency re-homed to Billing flow.
3. `AgentRequestsView` removed from portal route/nav rendering and replaced by Billing + supported destination routes.
