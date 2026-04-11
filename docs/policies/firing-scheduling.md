---
slug: "firing-scheduling"
title: "Firing & scheduling policy"
status: "active"
version: "2026-04-02"
effectiveDate: "2026-04-02"
reviewDate: "2026-10-02"
owner: "Scheduling Lead"
sourceUrl: "/policies/firing-scheduling/"
summary: "Firing dates are estimate bands, deadline requests require staff confirmation, pre-load changes are no-penalty, and staged or loaded changes are best-effort only."
tags:
  - "kiln"
  - "scheduling"
  - "portal"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Estimate bands, deadline request routing, pre-load changes, and staged-or-loaded best-effort rescheduling."
  defaultActions:
    - "submit or validate required scheduling fields"
    - "advise current estimate band, load status, and queue context"
    - "flag deadline requests for staff confirmation without promising an exact date"
    - "explain whether a change is still no-penalty or now best-effort only"
  allowedLowRiskActions:
    - "share current estimate bands and queue-based timing"
    - "collect scheduling details, preferred windows, and deadline dates"
    - "explain when pickup timing is still estimated and same-day pickup is not guaranteed"
  blockedActions:
    - "guarantee an exact firing or pickup date"
    - "override queue order or kiln allocation"
    - "commit same-day turnaround without staff approval"
    - "promise a deadline without staff confirmation"
  requiredSignals:
    - "requested date or deadline window"
    - "order size and piece type"
    - "current queue, stage, or load status"
  escalateWhen:
    - "conflict with safety hold or kiln outage"
    - "urgent same-day schedule change"
    - "customer asks for guaranteed exact window or deadline promise"
    - "change request arrives after work is staged or loaded"
  replyTemplate: "Provide the current estimate band, state whether the request is still no-penalty or best-effort only, and note when staff confirmation is required."
---

## Purpose

To set clear expectations for when firings are submitted, queued, and completed.

## Scope

All kiln requests, batching, scheduling, and status communication in support and
portal workflows.

## Policy

- Firing requests must be submitted through portal channels.
- Queue placement is based on workload, materials, and kiln readiness.
- Estimated completion windows are guidance bands rather than guarantees and may shift due to safety,
  staffing, or technical delays.
- Deadline requests can be flagged for staff review, but they are not promised unless a human confirms them.
- Before a load is started, firing changes or cancellations can be handled without penalty.
- Once work is staged or loaded, changes become best-effort only and may move to the next available window.
- Pickup-ready notices start the pickup and storage timeline; same-day pickup is not guaranteed even if a load finishes early.
- Pickup coordination uses explicit pickup-window states:
  - `open` (staff offered),
  - `confirmed` (member accepted),
  - `missed` / `expired` (window missed or elapsed),
  - `completed` (pickup closed).
- Member pickup-window reschedules are capped to one request by default before staff-only override.
- Queue fairness policy applies deterministic penalties:
  - no-show evidence: `+2` points
  - late-arrival evidence: `+1` point
  - staff override boost can offset penalty points when documented with reason and expiry.
- Fairness actions must include a staff reason and write an audit evidence row to `reservationQueueFairnessAudit`.

## Implementation in portal

- Require clear required fields (clay body, glaze notes, target schedule window).
- Record estimated/actual firing window, whether work has started, and send delay notices on status changes.
- Flag deadline requests for staff review instead of auto-promising them.
- Keep previous and active batches visible in timeline/history views.
- Track pickup-window status and misses in reservation records for queue fairness and storage escalation.

## Enforcement

Changes requested after staging or loading are best-effort only and may move to the next available window.

## Support language

Support should include:

- what changed since last published estimate
- the current estimated band
- whether work has started yet
- whether the request remains no-penalty or is now best-effort only
- whether a deadline request is pending staff confirmation
- explicit copy lines:
  - `Updated estimate: ...`
  - `Last change reason: ...`
  - `Deadline status: pending staff confirmation` or `Deadline status: not confirmed`
  - `Suggested next update window: ...`
