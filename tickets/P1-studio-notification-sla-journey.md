# P1 — Reservation Notification SLA and Delay Journey

Status: Open
Date: 2026-02-17

## Problem
Policies define that schedule windows, delays, and support messaging should be communicated, but current reservation flow has no end-to-end SLA/notification path for studio-side changes.

Competing pottery software features emphasize:
- automatic status change messages,
- ready-for-pickup alerts,
- delayed-firing explanations.
Community feedback similarly shows pain around missing "where is my work" updates and long delay uncertainty.

## Scope
- `functions/src/notifications.ts`
- `functions/src/notificationJobs.ts` (or equivalent scheduling entrypoint already used)
- `functions/src/createReservation.ts` (status metadata defaults)
- `firestore.rules` (if new reservation status fields/metadata are added)
- `web/src/views/ReservationsView.tsx`
- `functions/src/index.ts` (export/trigger registration as needed)
- `docs/policies/firing-scheduling.md`

## Tasks
1. Extend reservation data model with explicit ETA tracking:
   - `estimatedWindow.currentStart`,
   - `estimatedWindow.currentEnd`,
   - `estimatedWindow.updatedAt`,
   - `slaState` (`on_track`, `at_risk`, `delayed`).
2. Add transition hooks so every staff status change writes SLA state and enqueues notification jobs.
3. Add notification job templates for:
   - confirmed booking,
   - waitlist placement,
   - estimated date shift,
   - final pick-up ready.
4. Add escalation logic:
   - no user notification after delayed ETA after configured thresholds;
   - reminder cadence tied to `notifyReservations` preference (or global default).
5. Add dead-letter/retry instrumentation for failed sends and capture to runbook telemetry.
6. Add customer-facing copy in portal list card:
   - "Updated estimate: ...",
   - "Last change reason: ...",
   - "Suggested next update window".

## Acceptance
- Any status change from `REQUESTED -> CONFIRMED`, `CONFIRMED -> WAITLISTED`, `... -> CANCELLED`, and pickup-readiness states emits a customer-visible notification trail.
- If estimated window shifts, user receives at least one proactive update in the same day.
- Delayed jobs are retried and surfaced in delivery metrics.
- Policies in `docs/policies/firing-scheduling.md` are reflected in concrete copy and behavior.

## Dependencies
- `tickets/P1-studio-reservation-status-api.md`
- `tickets/P1-studio-reservation-queue-ops-ui.md`
- `tickets/P2-studio-reservation-doc-and-playbook-gap.md`
