# P1 — Staff Console: StudioBrain Disabled Mode and Health Signal Clarity

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Staff Console + Platform Reliability
Type: Ticket
Parent Epic: tickets/P1-EPIC-15-staff-console-usability-and-signal-hardening.md

## Problem

Staff operators report false Studio Brain "offline" warnings during conditions that are not true outages. This creates alert fatigue and lowers confidence in real health incidents.

## Objective

Make Studio Brain status explicit and trustworthy by separating disabled mode, unknown signal state, degraded state, and confirmed offline state.

## Scope

1. Health signal semantics and UI labels in staff console.
2. Disabled-mode copy and behavior for intentional non-operational windows.
3. Operator-facing health context (last successful signal timestamp and reason codes).

## Tasks

1. Define a clear health-state contract (`disabled`, `unknown`, `degraded`, `offline`, `healthy`) for staff rendering.
2. Update staff-console health messaging so disabled mode is not treated as offline.
3. Add explicit reason text and last-known-good timestamp when status is not healthy.
4. Add safe fallback behavior for stale telemetry so transient delays do not immediately page as offline.
5. Add regression checks for false-offline scenarios and disabled-mode display.

## Acceptance Criteria

1. Disabled Studio Brain state renders as disabled, not offline.
2. Known false-positive scenarios no longer display offline warnings.
3. Non-healthy states include actionable context (reason and recency).
4. Staff can distinguish true outage vs signal delay from the console alone.
5. Regression coverage exists for offline/disabled/unknown/degraded transitions.

## Completion Evidence (2026-02-28)

1. Health-state contract and rendering clarity implemented in `web/src/views/StaffView.tsx`:
   - Added explicit modes: `healthy`, `degraded`, `offline`, `disabled`, `unknown`.
   - Updated Staff hero messaging to render each mode with distinct copy and semantics.
2. Added context fields for operator trust in `web/src/views/StaffView.tsx`:
   - Added `reasonCode` and detailed `reason` text per health state.
   - Added `lastKnownGoodAt` and `signalAgeMinutes`, surfaced in the UI as last-known-good timing.
3. False-offline guardrail implemented in `web/src/views/StaffView.tsx`:
   - Ready-check fetch failures are held as `unknown` while signal is stale/delayed.
   - `offline` is only asserted after signal-gap threshold with explicit context text.
4. Extracted and hardened status utilities in `web/src/utils/studioBrainHealth.ts`:
   - Added explicit unavailable/fetch failure resolvers and stale-signal timing helpers.
   - Staff view now uses shared utility contract for status decisions.
5. Regression coverage added in `web/src/utils/studioBrainHealth.test.ts`:
   - Disabled/unknown/degraded/offline transition checks
   - Stale-signal and minute/hour/day recency formatting checks
6. Styling support added in `web/src/App.css`:
   - Added staff health note variants (`ok`, `warn`, `muted`) for clearer non-healthy state differentiation.

## Validation

1. `npm --prefix web run build` passes.
2. `npm --prefix web run test -- src/utils/studioBrainHealth.test.ts src/views/NotificationsView.test.tsx` passes.
