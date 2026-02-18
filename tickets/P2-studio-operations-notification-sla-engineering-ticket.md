# Ticket: P2 — Studio Notification SLA & ETA Communication

Status: Planned
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
