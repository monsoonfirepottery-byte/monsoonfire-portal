# P1 — EPIC 17: Workshops Experience and Community Signals

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Program Ops + Member Experience + Community
Type: Epic Ticket
Parent Epic: docs/epics/EPIC-WORKSHOPS-EXPERIENCE-AND-COMMUNITY-SIGNALS.md

## Problem

Workshops currently optimize for basic registration but under-deliver on discovery, social momentum, and demand capture.

## Objective

Turn Workshops into a richer community-learning funnel that increases participation, conversion, and retention.

## Scope

1. Member-facing discovery and social proof.
2. Request and demand pathways for new workshop creation.
3. Staff intelligence for schedule and curriculum planning.

## Tasks

1. Deliver all child tickets in this epic.
2. Keep data contracts aligned with Events, Lending, and Staff modules.
3. Validate behavior with staff and member QA before broad rollout.

## Acceptance Criteria

1. Child tickets ship without regression to current signup/checkout flows.
2. Demand and community signals are persisted and visible to staff.
3. Technique and workshop discovery loops are functional in both directions.
4. Engagement quality improves for workshop browse-to-signup journey.

## Progress Snapshot (2026-02-28)

1. Completed:
   - `tickets/P1-workshops-request-intake-and-demand-routing.md`
   - `tickets/P1-workshops-community-signals-and-member-presence-loops.md`
   - `tickets/P1-workshops-technique-learning-pathways-and-lending-bridge.md`
   - `tickets/P1-workshops-discovery-and-recommendation-rails.md`
   - `tickets/P2-workshops-frontend-interaction-and-storytelling-pass.md`
   - `tickets/P2-workshops-staff-programming-intelligence-dashboard.md`
2. Validation baseline:
   - `npm --prefix web run build`
   - `npm --prefix web run lint`
   - `npm --prefix web run a11y:smoke`
   - `npm --prefix web run perf:chunks`
