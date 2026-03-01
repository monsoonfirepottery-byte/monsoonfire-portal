# Ticket: P2 — Studio Notification SLA & ETA Communication

Status: Completed
Created: 2026-02-17  
Priority: P2  
Owner: Product + Functions Team  
Type: Ticket

## Problem

Users repeatedly report communication pain in pottery communities: repeated “is it ready?” asks and uncertainty around status timing. Current implementation has stage transitions but the notification/ETA path is not clearly unified.

## Goal

Define and execute a predictable communication journey around reservation state transitions.

## Scope

1. Standardize lifecycle events (`bisque`, `glaze`, `glaze_fire`, `ready`, `pickup_scheduled`, `completed`).
2. Associate SLA/ETA metadata per reservation transition.
3. Add notification rules:
   - event + frequency policy
   - user/channel preferences
   - escalation on missed windows
4. Add “why delayed” reason coding for out-of-window delays.
5. Add audit log for all outbound notifications.

## Acceptance Criteria

- Every transition writes:
  - status timestamp
  - SLA band
  - queue position impact (if applicable)
- Customers can understand expected timeline directly from status feed.
- At least 2 channels supported or clearly roadmap to 2 channels.
- Duplicate notifications deduplicated during state churn.

## Dependencies

- `P1-studio-operations-data-contract-and-api-parity-epic`
- `P2-studio-operations-web-kiln-board-live-feed-ticket`

## Definition of Done

- Notification policy documented and QA verified with at least:
  - transition to ready
  - delay reason
  - pickup completed

## Completion evidence (2026-02-28)
- SLA + reservation notification flow shipped under and validated via:
  - `tickets/P1-studio-notification-sla-journey.md` (`Status: Completed`)
  - `tickets/P2-studio-pickup-window-booking.md` (`Status: Completed`)
  - `tickets/P2-studio-no-show-and-queue-fairness-policy.md` (`Status: Completed`)
  - `tickets/P2-studio-notification-channel-and-fallback-controls.md` (`Status: Completed`)
- Core implementation files:
  - `functions/src/notifications.ts`
  - `functions/src/apiV1.ts`
- Regression and lifecycle validation coverage:
  - `functions/src/apiV1.test.ts` (pickup window progression, queue fairness, notifications mark-read/idempotency)
  - verification run: `node --test functions/lib/apiV1.test.js` (`115` pass, `0` fail)
- Operator documentation and telemetry runbooks:
  - `docs/EMAIL_NOTIFICATIONS.md`
  - `docs/NOTIFICATION_ONCALL_RUNBOOK.md`
