---
slug: "studio-access"
title: "Studio access & supervision"
status: "active"
version: "2026-04-02"
effectiveDate: "2026-04-02"
reviewDate: "2026-10-02"
owner: "Studio Operations"
sourceUrl: "/policies/studio-access/"
summary: "Studio visits are appointment-only, reservations are required for all visits, and access details are shared only after account verification and approved booking context."
tags:
  - "studio"
  - "access"
  - "supervision"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Appointment-only access, reservation verification, guest approval, and supervised equipment requests."
  defaultActions:
    - "check reservation status and share upcoming access steps"
    - "verify whether the booking context is sufficient to release access details"
    - "verify whether a request requires supervision flagging"
    - "collect and confirm guest list and approval requirement"
  allowedLowRiskActions:
    - "answer appointment-only and reservation requirement questions"
    - "collect preferred visit windows and tool needs"
    - "confirm whether supervision review is required"
  blockedActions:
    - "override appointment-only access without human approval"
    - "share address, gate code, or access instructions before account verification"
    - "approve guests or supervision exceptions on behalf of staff"
  requiredSignals:
    - "user category and account"
    - "reservation id, day-pass booking, or preferred window"
    - "requested tools or stations"
  escalateWhen:
    - "safety or occupancy risk"
    - "walk-in request without a confirmed reservation"
    - "repeated no-shows or access policy breaches"
    - "guest approval rejected by facility lead"
  replyTemplate: "State that the studio is appointment-only, confirm the booking status, explain when access details can be shared, and note whether supervision is needed."
---

## Purpose

To ensure safe, predictable, and respectful studio visits by requiring planned
access and clear supervision requirements.

## Scope

This policy applies to all in-person studio use, including open studio visits,
reservation windows, and equipment access under the support channel.

## Policy

- The studio is appointment-only. Walk-ins and drop-ins are not guaranteed and require prior approval.
- All visits are reservation-based to keep occupancy and supervision manageable.
- Visit information, check-in instructions, and any day-visit constraints are shared in
  the portal only after the account and booking context are verified.
- The studio address, gate code, and access instructions are not released before booking context is confirmed.
- Members must check in on arrival and follow posted access windows.
- Repeated no-shows and late arrivals are logged to reservation queue fairness records and may reduce queue priority until resolved.
- New users and special equipment use may require staff supervision.
- Guests are not automatic. Guest access is only allowed with prior studio approval.
- Users are expected to leave stations tidy and return shared tools as found.

## Implementation in portal

Portal workflows should enforce:

- reservation requirement before any planned visit
- pre-arrival access message
- guest approval field on the booking form where needed
- check-in status recorded for staff visibility

## Enforcement

Failure to follow access rules can lead to reservation limits, suspension of
reservation privileges, or temporary access hold until issues are resolved.

## Support language

Support responses should cite:

- the appointment-only requirement and whether a reservation is already confirmed
- required reservation steps
- whether access details can be shared yet
- current access instructions once booking context is confirmed
- whether staff supervision applies to requested tools
- how to request guest exceptions
- if applicable, the current fairness status (`no-show` / `late-arrival` counters and active overrides)
