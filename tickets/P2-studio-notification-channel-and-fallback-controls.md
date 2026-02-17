# P2 — Notification Channel Strategy and Delivery Fallback Controls

Status: Open
Date: 2026-02-17

## Problem
Studio users and staff rely on timely notifications for status transitions, but there is no explicit channel-strategy layer covering delivery preference, fallback, and dedupe behavior for missed transitions.

## Objective
Build a predictable communications layer for stage and pickup updates that supports SMS + email fallback behavior, per-user preferences, and idempotent sends.

## Scope
- `functions/src/notifications.ts` (or equivalent notification pipeline)
- `web/src/views/ReservationsView.tsx`
- `web/src/api/portalContracts.ts`
- `tickets/P1-studio-notification-sla-journey.md` integration boundaries

## Tasks
1. Define communication matrix:
   - event family (`stage transition`, `pickup reminder`, `status hold`, `no-show escalations`)
   - recipient target and allowed channels
   - retry and cooldown policy by event severity.
2. Add explicit member-staff channel preferences:
   - email, sms, in-app
   - quiet-hours guardrails
   - one-click opt-out for low-priority alerts.
3. Implement delivery fallback:
   - if SMS provider returns hard failure, escalate to email
   - avoid duplicate sends through dedupe keys (`reservationId` + `stageEvent` + `version`).
4. Add dead-letter and manual review path for repeatedly failed messages.
5. Add observability:
   - delivery status by channel
   - failed transition and retry counters
   - SLA breaches by event type.
6. Expose communication state in queue and customer-facing reservation views for trust transparency.

## Acceptance
- Every critical status transition has at least one configured outbound message path.
- Duplicate notifications for the same event are prevented under transient retry conditions.
- Failed sends are visible in a manual recovery workflow.
- Quiet-hour and preference rules are enforced consistently.

## Dependencies
- `tickets/P1-studio-notification-sla-journey.md`
- `tickets/P1-studio-reservation-status-api.md`

