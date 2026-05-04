---
slug: "studio-access"
title: "Studio access & supervision"
status: "active"
version: "2026-05-04"
effectiveDate: "2026-05-04"
reviewDate: "2026-10-02"
owner: "Studio Operations"
sourceUrl: "/policies/studio-access/"
summary: "Studio visits remain appointment-only while the portal reservation system is decommissioned during May 2026 and reaches end-of-life on May 31, 2026. Access details are shared only after account verification and staff-approved visit context."
tags:
  - "studio"
  - "access"
  - "supervision"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Appointment-only access, visit-window verification, guest approval, and supervised equipment requests."
  defaultActions:
    - "check visit-window status and share upcoming access steps"
    - "verify whether the approved visit context is sufficient to release access details"
    - "verify whether a request requires supervision flagging"
    - "collect and confirm guest list and approval requirement"
  allowedLowRiskActions:
    - "answer appointment-only and access-planning questions"
    - "collect preferred visit windows and tool needs"
    - "confirm whether supervision review is required"
  blockedActions:
    - "override appointment-only access without human approval"
    - "share address, gate code, or access instructions before account verification"
    - "approve guests or supervision exceptions on behalf of staff"
  requiredSignals:
    - "user category and account"
    - "staff-approved visit window, day-pass context, or preferred window"
    - "requested tools or stations"
  escalateWhen:
    - "safety or occupancy risk"
    - "walk-in request without a staff-approved visit window"
    - "repeated no-shows or access policy breaches"
    - "guest approval rejected by facility lead"
  replyTemplate: "State that the studio is appointment-only, confirm the approved visit status, explain when access details can be shared, and note whether supervision is needed."
---

## Purpose

To ensure safe, predictable, and respectful studio visits by requiring planned
access and clear supervision requirements.

## Scope

This policy applies to all in-person studio use, including open studio visits,
staff-approved visit windows, and equipment access under the support channel.

## Policy

- The studio is appointment-only. Walk-ins and drop-ins are not guaranteed and require prior approval.
- The portal reservation system is being decommissioned during May 2026 and reaches end-of-life on May 31, 2026.
- All visits are staff-coordinated appointment windows to keep occupancy and supervision manageable.
- Visit information, check-in instructions, and any day-visit constraints are shared in
  the portal only after the account and approved visit context are verified.
- The studio address, gate code, and access instructions are not released before approved visit context is confirmed.
- Visitors must check in on arrival and follow posted access windows.
- Repeated no-shows and late arrivals are logged for staff review and may limit future access until resolved.
- New users and special equipment use may require staff supervision.
- Guests are not automatic. Guest access is only allowed with prior studio approval.
- Users are expected to leave stations tidy and return shared tools as found.

## Implementation in portal

Portal workflows should enforce:

- appointment-only access before any planned visit
- pre-arrival access message
- guest approval field where needed
- check-in status recorded for staff visibility
- explicit deprecation copy for legacy reservation entry points through May 31, 2026

## Enforcement

Failure to follow access rules can lead to visit limits, suspension of studio
access, or temporary access hold until issues are resolved.

## Support language

Support responses should cite:

- the appointment-only requirement and whether a staff-approved visit window is already confirmed
- required access-planning steps
- whether access details can be shared yet
- current access instructions once approved visit context is confirmed
- whether staff supervision applies to requested tools
- how to request guest exceptions
- if applicable, the current fairness status (`no-show` / `late-arrival` counters and active overrides)
