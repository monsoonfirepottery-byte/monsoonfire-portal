---
slug: "damage-responsibility"
title: "Damage & responsibility"
status: "active"
version: "2026-04-02"
effectiveDate: "2026-04-02"
reviewDate: "2026-10-02"
owner: "Studio Operations"
sourceUrl: "/policies/damage-responsibility/"
summary: "Firing carries process variation. Damage reports are acknowledged with a documented review path, and any remedy is decided only after human review."
tags:
  - "policies"
  - "kiln"
  - "responsibility"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Damage intake, evidence collection, acknowledgment, and human-reviewed outcome routing."
  defaultActions:
    - "collect timeline, batch id, and photos"
    - "determine if handling/material deviation was present"
    - "log incident under correct case type and severity"
    - "document the review owner and next follow-up step before closing the intake"
  allowedLowRiskActions:
    - "acknowledge reports and collect batch evidence"
    - "summarize case-review steps, ownership, and timelines"
    - "log the claimed issue type and severity"
  blockedActions:
    - "promise compensation, refund, or remake outcomes"
    - "assign blame before case review"
    - "close damage claims without human review"
  requiredSignals:
    - "batch id or piece reference"
    - "time of event and symptom details"
    - "photos and transport notes"
  escalateWhen:
    - "high-value batch involved"
    - "multiple connected incidents"
    - "user requests reversal beyond policy scope"
    - "staff is considering refund, credit, remake, replacement, or other remedy"
  replyTemplate: "Acknowledge the report, document evidence received, identify the next review step, and note that remedies are only decided after human review."
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
- Customer-facing damage reports should receive acknowledgment and a documented next review step once the incident is logged.
- No refund, remake, credit, replacement, or other remedy is guaranteed before human review closes with evidence and workflow context.
- Customers should package for return or pickup transport with sufficient protection.

## Implementation in portal

- Include material compliance and condition requirements at submission.
- Capture intake photos where possible for later review.
- Keep incident status and resolution notes in timeline messages for accountability.

## Enforcement

Disputes are managed case-by-case and documented with the action taken, review owner, and timeline status. Any remedy decision requires human review.

## Support language

Use structured triage:

- describe issue and symptoms
- provide package/handling history
- include photos and batch reference
- request an incident review
- avoid promising compensation, remake, or blame assignment before review closes.

