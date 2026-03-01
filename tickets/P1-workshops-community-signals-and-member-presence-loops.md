# P1 — Workshops: Community Signals and Member Presence Loops

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Community + Member Experience
Type: Ticket
Parent Epic: tickets/P1-EPIC-17-workshops-experience-and-community-signals.md

## Problem

The current Workshops flow does not surface social momentum or peer activity that helps members commit.

## Objective

Add community-building signals that increase confidence and participation.

## Scope

1. "I'm interested" and pre-registration intent signals.
2. Waitlist momentum and second-session interest indicators.
3. Optional buddy/cohort matching cues.
4. Outcome and showcase hooks post-workshop.

## Tasks

1. Add intent state model and UI indicators.
2. Add waitlist momentum model and staff-facing trigger suggestions.
3. Add optional buddy/circle participation controls.
4. Add post-workshop share/outcome prompts.

## Completion Evidence (2026-02-28)

1. Added member `I'm interested` toggle on workshop detail with persistence to `supportRequests`.
2. Added momentum + waitlist pressure indicators on workshop detail, including a visible momentum meter.
3. Added optional presence/buddy/circle cues and captured these signals in demand modeling.
4. Added community loop prompts (showcase-oriented follow-through cues) in workshop detail state.
5. Implemented interest signal writes using the existing rules-safe `supportRequests` schema keys only.
6. Added interest-withdrawal signaling path:
   - Interest removal now clears local demand contribution and writes a withdrawal support signal for staff awareness.
7. Added post-workshop showcase follow-up submission flow in Workshops detail:
   - Outcome note input + submission action to `supportRequests` for community highlight routing.

## Residual Notes

1. We intentionally avoid destructive delete of prior support tickets; withdrawal is represented as an explicit follow-up signal.
2. Showcase follow-up currently routes through staff intake (not an automated publish feed), which is acceptable for this phase.

## Validation

1. `npm --prefix web run build` passes.
2. `npm --prefix web run test -- src/utils/studioBrainHealth.test.ts src/views/NotificationsView.test.tsx` passes.

## Acceptance Criteria

1. Members can express interest before formal signup.
2. Waitlist pressure and demand are visible to staff and members.
3. Social participation features are opt-in and privacy-safe.
4. At least one community loop persists after workshop completion.
