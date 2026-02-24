# P1 — Reservation Notification SLA and Delay Journey

Status: Completed
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

## Completion Evidence (2026-02-23)
- Reservation lifecycle notification trigger is now wired in functions:
  - `onReservationLifecycleUpdated` listens to `reservations/{reservationId}` changes and enqueues:
    - status transition notifications (`confirmed`, `waitlisted`, `cancelled`)
    - ETA shift notifications
    - ready-for-pickup notifications when load reaches `loaded`
    - delayed ETA follow-up jobs
  - file: `functions/src/notifications.ts`
- Delayed ETA escalation cadence implemented:
  - initial follow-up scheduled at `+12h` on delayed shift
  - recurring follow-up scheduled at `+24h` while reservation remains delayed
  - follow-ups auto-skip when reservation is no longer delayed/cancelled/loaded
  - file: `functions/src/notifications.ts`
- Reservation notifications now use explicit customer-facing copy lines:
  - `Updated estimate: ...`
  - `Last change reason: ...`
  - `Suggested next update window: ...`
  - in-app/email/push content generation:
    - file: `functions/src/notifications.ts`
  - portal reservation cards:
    - files: `web/src/views/ReservationsView.tsx`, `web/src/views/ReservationsView.css`
- Preferences and safety gates applied:
  - global notification/channel prefs (`users/{uid}/prefs/notifications`)
  - reservation opt-in (`profiles/{uid}.notifyReservations`, default true)
  - file: `functions/src/notifications.ts`
- Policy/doc alignment updates:
  - support language in scheduling policy updated with explicit copy labels
    - file: `docs/policies/firing-scheduling.md`
  - notification doc updated with reservation flow + cadence behavior
    - file: `docs/EMAIL_NOTIFICATIONS.md`
