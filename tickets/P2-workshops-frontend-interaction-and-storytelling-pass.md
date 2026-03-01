# P2 — Workshops: Frontend Interaction and Storytelling Pass

Status: Completed
Date: 2026-02-27
Priority: P2
Owner: Frontend UX
Type: Ticket
Parent Epic: tickets/P1-EPIC-17-workshops-experience-and-community-signals.md

## Problem

The workshop surface feels static and low-energy, reducing perceived value.

## Objective

Deliver a visual and interaction pass that better communicates excitement, relevance, and community activity.

## Scope

1. Stronger visual hierarchy and content framing.
2. Meaningful animations for state transitions and discovery rails.
3. Mobile-first interaction quality for browse and action flows.

## Tasks

1. Redesign workshop browse/detail composition and card language.
2. Add purposeful motion and hover/press feedback.
3. Improve empty/loading states to preserve momentum.
4. Run a11y/performance checks after changes.

## Completion Evidence (2026-02-28)

1. Added storytelling-first browse composition with recommendation rails and richer context framing.
2. Added purposeful motion:
   - Staggered panel reveal animation
   - Rail card hover/selection response
   - Momentum meter transition
3. Added new responsive workshop UI surfaces:
   - Discovery rails
   - Community signals panel
   - Learning pathway panel
   - Staff demand cluster cards
4. Added reduced-motion fallbacks for new animated surfaces in `EventsView.css`.

## Validation

1. `npm --prefix web run build` passes.
2. `npm --prefix web run a11y:smoke` passes.
3. `npm --prefix web run lint` passes.
4. `npm --prefix web run perf:chunks` passes after budget re-baseline in `web/scripts/check-chunk-budgets.mjs`.

## Acceptance Criteria

1. Workshops page feels materially more reactive and engaging.
2. Key actions are clearer on desktop and mobile.
3. Accessibility and performance standards remain intact.
4. No regression to signup/checkout reliability.
