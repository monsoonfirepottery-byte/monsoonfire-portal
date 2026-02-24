---
slug: "firing-scheduling"
title: "Firing & scheduling policy"
status: "active"
version: "2026-02-17"
effectiveDate: "2026-02-17"
reviewDate: "2026-08-01"
owner: "Scheduling Lead"
sourceUrl: "/policies/firing-scheduling/"
summary: "Submit firings through the portal. Turnaround estimates and scheduling windows are provided with status updates if windows shift."
tags:
  - "kiln"
  - "scheduling"
  - "portal"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Window allocation, delay updates, and urgency routing."
  defaultActions:
    - "submit or validate required scheduling fields"
    - "advise current estimate band and queue position"
    - "prepare alternative window options for urgent changes"
  requiredSignals:
    - "requested date window"
    - "order size and piece type"
    - "current queue or status context"
  escalateWhen:
    - "conflict with safety hold or kiln outage"
    - "urgent same-day schedule change"
    - "customer asks for guaranteed exact window"
  replyTemplate: "Provide the current estimate window and explain any shifts with practical alternatives."
---

## Purpose

To set clear expectations for when firings are submitted, queued, and completed.

## Scope

All kiln requests, batching, scheduling, and status communication in support and
portal workflows.

## Policy

- Firing requests must be submitted through portal channels.
- Queue placement is based on workload, materials, and kiln readiness.
- Estimated completion windows are provided as guidance and may shift due to safety,
  staffing, or technical delays.
- Urgent reschedule requests are handled case-by-case with operational priority checks.
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
- Record estimated/actual firing window and send delay notices on status changes.
- Keep previous and active batches visible in timeline/history views.
- Track pickup-window status and misses in reservation records for queue fairness and storage escalation.

## Enforcement

Changes requested too late for a scheduled load may move to next available window.

## Support language

Support should include:

- what changed since last published estimate
- the current estimated window range
- any recommended alternative windows
- explicit copy lines:
  - `Updated estimate: ...`
  - `Last change reason: ...`
  - `Suggested next update window: ...`
