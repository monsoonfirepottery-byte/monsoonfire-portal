# P1 — Lending Library: Lifecycle UX and Operational Feedback

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Library Ops + Platform UX
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Availability and request states are not expressive enough, leading to uncertainty about what to do next.

## Objective

Make lending lifecycle states explicit and actionable: availability, queue, reminder, and renewal flows.

## Scope

1. Queue position and waitlist context.
2. Notify-on-availability and ETA hints.
3. Renewal affordances when policy allows.
4. Better status messaging across member and staff views.

## Tasks

1. Add lifecycle state badges and next-step callouts.
2. Add notify/alert controls for unavailable items.
3. Add renewal action with conflict-aware guardrails.
4. Align staff triage states/messages with member-facing language.

## Acceptance Criteria

1. Members can understand item state and next action at a glance.
2. Waitlisted users can see queue/availability context.
3. Renewal flow prevents invalid transitions and communicates why.
4. Staff and member wording is consistent for state transitions.

## Completion Evidence (2026-02-28)

1. Added queue/waitlist lifecycle context surfaces in catalog cards, detail panel, and request rows with queue/ETA helpers in `web/src/views/LendingLibraryView.tsx`.
2. Added notify-on-availability controls with persisted user preference and `libraryAvailabilityAlerts` writes in `web/src/views/LendingLibraryView.tsx`.
3. Added renewal affordance messaging per loan plus guarded "Request renewal" flow to staff support triage in `web/src/views/LendingLibraryView.tsx`.
4. Extended lifecycle-related data model fields (`lifecycle`, request queue fields, loan renewal fields) in `web/src/types/library.ts` + `web/src/lib/normalizers/library.ts`.
