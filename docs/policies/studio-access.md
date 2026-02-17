---
slug: "studio-access"
title: "Studio access & supervision"
status: "active"
version: "2026-02-17"
effectiveDate: "2026-02-17"
reviewDate: "2026-08-01"
owner: "Studio Operations"
sourceUrl: "/policies/studio-access/"
summary: "Reservations are required for all visits. Access details and any supervised equipment requirements are listed in the portal."
tags:
  - "studio"
  - "access"
  - "supervision"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Reservations, check-in, and supervised equipment requests."
  defaultActions:
    - "check reservation status and share upcoming access steps"
    - "verify whether a request requires supervision flagging"
    - "collect and confirm guest list and approval requirement"
  requiredSignals:
    - "user category and account"
    - "reservation id or preferred window"
    - "requested tools or stations"
  escalateWhen:
    - "safety or occupancy risk"
    - "repeated no-shows or access policy breaches"
    - "guest approval rejected by facility lead"
  replyTemplate: "Share reservation requirements, required arrival steps, and whether supervision is needed."
---

## Purpose

To ensure safe, predictable, and respectful studio visits by requiring planned
access and clear supervision requirements.

## Scope

This policy applies to all in-person studio use, including open studio visits,
reservation windows, and equipment access under the support channel.

## Policy

- All visits are reservation-based to keep occupancy and supervision manageable.
- Visit information, check-in instructions, and any day-visit constraints are shared in
  the portal before arrival.
- Members must check in on arrival and follow posted access windows.
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

- required reservation steps
- current access instructions
- whether staff supervision applies to requested tools
- how to request guest exceptions

