# P1 — Workshops: Discovery and Recommendation Rails

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Member Experience + Program Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-17-workshops-experience-and-community-signals.md

## Problem

Workshop discovery is largely list-based, making it harder for members to find relevant sessions quickly.

## Objective

Introduce recommendation and curation rails that make discovery contextual, intentional, and conversion-oriented.

## Scope

1. Recommended workshops based on member context.
2. Staff curated tracks (beginner, technique focus, seasonal).
3. "If you liked this, try this" chaining.

## Tasks

1. Define recommendation rail taxonomy and ranking inputs.
2. Implement reusable rail components on workshops page.
3. Add staff controls for curated collections and ordering.
4. Track engagement by rail (views, clicks, signup starts).

## Completion Evidence (2026-02-28)

1. Added inferred technique taxonomy + member-context ranking heuristics in `web/src/views/EventsView.tsx`.
2. Added dynamic rails on the Workshops page:
   - Recommended for you
   - Staff curation: beginner runway
   - Staff curation: technique intensives
   - Staff curation: seasonal community picks
   - If-you-liked-this chaining from selected workshop
3. Added member context controls (level, schedule, technique chips) that immediately re-rank rails.
4. Added no-match guardrail that routes directly into prefilled workshop request flow.
5. Added staff-editable curation controls (no code edits required) for beginner/intensive/seasonal rails in `web/src/views/EventsView.tsx`.
6. Added rail telemetry events:
   - `workshops_rails_rendered`
   - `workshops_staff_curation_updated`
   - `workshops_rail_event_selected`

## Acceptance Criteria

1. Workshops page includes dynamic recommendation rails.
2. Staff can maintain curated rails without code edits.
3. Member can move from recommendation to signup in one continuous flow.
4. Rail-level telemetry is available for tuning.
