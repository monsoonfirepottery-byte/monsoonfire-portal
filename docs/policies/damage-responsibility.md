---
slug: "damage-responsibility"
title: "Damage & responsibility"
status: "active"
version: "2026-02-17"
effectiveDate: "2026-02-17"
reviewDate: "2026-08-01"
owner: "Studio Operations"
sourceUrl: "/policies/damage-responsibility/"
summary: "Firing carries process variation. Damage from service or handling is reviewed case-by-case."
tags:
  - "policies"
  - "kiln"
  - "responsibility"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Damage intake, evidence collection, and incident review status."
  defaultActions:
    - "collect timeline, batch id, and photos"
    - "determine if handling/material deviation was present"
    - "log incident under correct case type and severity"
  requiredSignals:
    - "batch id or piece reference"
    - "time of event and symptom details"
    - "photos and transport notes"
  escalateWhen:
    - "high-value batch involved"
    - "multiple connected incidents"
    - "user requests reversal beyond policy scope"
  replyTemplate: "Acknowledge report, document evidence received, and state expected case review path."
---

## Purpose

To set expectations for inherent process variation, customer responsibilities, and incident handling.

## Scope

All pieces handled in the studio workflow from intake to pickup.

## Policy

- Ceramics can and do develop glaze and structural variation; some defects are process-level.
- Damage related to unapproved materials, packaging, or non-compliance is generally outside studio
  coverage.
- If damage is found to be due to handling or kiln/service error, the team reviews case-by-case.
- Customers should package for return or pickup transport with sufficient protection.

## Implementation in portal

- Include material compliance and condition requirements at submission.
- Capture intake photos where possible for later review.
- Keep incident status and resolution notes in timeline messages for accountability.

## Enforcement

Disputes are managed case-by-case and documented with the action taken and timeline status.

## Support language

Use structured triage:

- describe issue and symptoms
- provide package/handling history
- include photos and batch reference
- request an incident review.

