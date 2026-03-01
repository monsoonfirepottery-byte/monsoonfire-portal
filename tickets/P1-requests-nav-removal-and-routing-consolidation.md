# P1 — Requests Nav Removal and Routing Consolidation

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Portal Frontend
Type: Ticket
Parent Epic: tickets/P1-EPIC-19-requests-surface-deprecation-and-agent-intake-rationalization.md

## Problem

The Requests entry adds cruft to member navigation and duplicates existing support pathways.

## Objective

Remove member nav exposure of Requests and route users to supported alternatives.

## Tasks

1. Remove `requests` from Studio & Resources nav group.
2. Add fallback route behavior for legacy `requests` deep links.
3. Provide user-facing replacement guidance (Support / Lending / Workshops where applicable).
4. Remove lazy import + render switch for `AgentRequestsView` once fallback is live.

## Acceptance Criteria

1. Members can no longer navigate to Requests from primary nav.
2. Legacy links do not dead-end; users are redirected to a supported destination.
3. App build/tests pass with no Requests UI regressions.

## Implementation Log

1. Added legacy deep-link fallback handling for `/requests*` and `/#/requests*` in `web/src/App.tsx`.
2. Mapped legacy intent hints to supported destinations:
   - workshop/event intent -> `Workshops`
   - lending/library intent -> `Lending Library`
   - default -> `Support`
3. Added user-facing migration notice (`Requests has moved...`) so redirected users get replacement guidance.
4. Canonicalized legacy URLs back to `/` after routing so stale deep links do not persist.

## Evidence

1. Routing + guidance updates: `web/src/App.tsx`
2. Ongoing regression guard for legacy links: `scripts/portal-authenticated-canary.mjs` (`legacy requests deep links route to supported pages` check)

## Validation

1. `npm --prefix web run build` (passes).
2. `npm --prefix web run test -- src/views/NotificationsView.test.tsx src/views/LendingLibraryView.test.ts` (passes).
