# EPIC: REQUESTS-SURFACE-DEPRECATION-AND-AGENT-INTAKE-RATIONALIZATION

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Product + Staff Operations + Platform
Type: Epic
Epic Ticket: tickets/P1-EPIC-19-requests-surface-deprecation-and-agent-intake-rationalization.md

## Problem

The member-facing `Requests` page adds UI complexity and duplicates value already provided by Support, Lending Library flows, and Staff Agent Ops triage surfaces.

## Objective

Retire the member Requests surface and associated non-essential wiring while preserving operational request intake where it is still needed by staff and agent automation.

## Why This Is Safe To Evaluate

1. The member nav Requests entry appears to be a standalone path (`AgentRequestsView`) with no other first-class user journey linking into it.
2. Staff request triage is already centralized inside `AgentOpsModule` and does not depend on the member Requests page UI.
3. Existing request APIs can be decoupled from member-facing UI and retained behind staff/system-only entry points during migration.

## Risks To Control

1. Commission checkout currently has a member self-serve action in `AgentRequestsView`; that payment handoff needs a replacement path before hard deletion.
2. Existing canaries and docs still reference request endpoints and may fail noisily if removed without staged cleanup.
3. Integrations scopes (`requests:read`, `requests:write`) should not be removed until consumers are migrated.

## Scope

1. Usage and dependency audit for member Requests UI and request APIs.
2. Member navigation and route deprecation with safe fallback.
3. Commission checkout replacement flow.
4. Staff/system retention plan for required request backend capabilities.
5. Canary, runbook, and documentation cleanup.

## Decision Log

1. Keep a staged deprecation path (soft-hide -> fallback route -> hard removal) instead of immediate deletion.
2. Treat commission checkout continuity as a release blocker for hard removal.
3. Keep backend request routes available to staff/system clients until explicit migration completion.

## Tasks

1. Ship a dependency + usage gate report for Requests UI and API routes.
2. Remove Requests from member nav and route traffic to the replacement destination.
3. Add/ship commission checkout replacement entry point outside Requests page.
4. Retire `AgentRequestsView` and CSS after replacement flow is live.
5. Prune stale canary probes, runbook references, and docs tied to member Requests UI.

## Acceptance Criteria

1. Members no longer see or rely on the Requests page for day-to-day workflows.
2. Commission checkout remains available with a clear supported entry path.
3. Staff request triage and backend operations continue to function.
4. Automation and runbooks pass without referencing retired member Requests UI.
5. Deprecated code paths are removed or clearly isolated with a removal date.

## Child Tickets

- tickets/P1-EPIC-19-requests-surface-deprecation-and-agent-intake-rationalization.md
- tickets/P1-requests-surface-usage-audit-and-deprecation-gate.md
- tickets/P1-requests-nav-removal-and-routing-consolidation.md
- tickets/P1-commission-checkout-path-replacement-before-requests-removal.md
- tickets/P2-agent-request-backend-scope-reduction-and-ops-handoff.md
- tickets/P2-requests-canary-runbook-and-doc-cleanup.md

## Completion Summary (2026-02-28)

1. Member Requests surface removed from nav/route rendering, with legacy deep-link migration to supported destinations.
2. Commission checkout continuity shipped in Billing.
3. Backend/staff route ownership audited and retained where justified.
4. Canary/runbook/docs updated to post-Requests architecture.
