# P1 — Workshops: Technique Learning Pathways and Lending Bridge

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Program Ops + Library Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-17-workshops-experience-and-community-signals.md

## Problem

Members cannot consistently navigate between workshop topics and relevant reading/resources.

## Objective

Create clear technique pathways that bridge Workshops and Lending in both directions.

## Scope

1. Technique tags shared across workshops and lending items.
2. Workshop detail includes related books/resources.
3. Lending/technique views include related workshops and requests.
4. Pre-work and post-work reading suggestions around workshop enrollment.

## Tasks

1. Define canonical technique taxonomy and mapping rules.
2. Implement cross-link components between Workshops and Lending.
3. Add pre-work/post-work recommendation slots to workshop detail.
4. Ensure request flow appears when no workshop exists for a technique.

## Completion Evidence (2026-02-28)

1. Added canonical in-view technique taxonomy and workshop-to-technique inference in `web/src/views/EventsView.tsx`.
2. Added workshop detail learning pathway panel with technique-specific:
   - Lending shelf cue
   - Pre-work suggestion
   - Post-work suggestion
3. Added Lending bridge links that route to Community > Lending Library navigation context.
4. Added no-match request-flow bridge that pre-fills technique/level/schedule when no workshop matches the current focus.
5. Added direct Workshops -> Lending handoff payload (`mf_lending_handoff_v1`) with technique-aware search/focus context.
6. Added Lending-side handoff consumption in `web/src/views/LendingLibraryView.tsx` so members arrive with pre-applied query and workshop request bridge context.

## Residual Notes

1. Taxonomy remains frontend-defined; a future config service could centralize these mappings without requiring UI releases.

## Validation

1. `npm --prefix web run build` passes.
2. `npm --prefix web run test -- src/utils/studioBrainHealth.test.ts src/views/NotificationsView.test.tsx` passes.

## Acceptance Criteria

1. Members can move from workshop to relevant books in <=2 clicks.
2. Members can move from technique/book to workshop discovery or request flow.
3. Shared technique mapping is consistent across modules.
4. Staff can tune mappings without redeploying core UI.
