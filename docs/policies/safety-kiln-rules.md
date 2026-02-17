---
slug: "safety-kiln-rules"
title: "Safety & kiln rules"
status: "active"
version: "2026-02-17"
effectiveDate: "2026-02-17"
reviewDate: "2026-08-01"
owner: "Studio Operations"
sourceUrl: "/policies/safety-kiln-rules/"
summary: "Follow posted kiln safety guidance at all times. Keep dust controlled, use required PPE, and label all kiln-bound work."
tags:
  - "kiln"
  - "safety"
  - "access"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "PPE, dust control, kiln access, and handling constraints."
  defaultActions:
    - "confirm required PPE and dust-control behavior"
    - "confirm required piece labeling fields before kiln intake"
    - "recommend safe alternatives if unsafe instruction is requested"
  requiredSignals:
    - "intake item details"
    - "material/size/shape notes"
    - "requested kiln session type"
  escalateWhen:
    - "unclear material safety risk"
    - "requested unsafe action (e.g., dry sanding in kiln area)"
    - "incident report involving heat, burns, or alarm conditions"
  replyTemplate: "State exact safety requirements and required documentation before submission."
---

## Purpose

To protect people, workpieces, and equipment through strict kiln safety behavior.

## Scope

All members, guests, deliveries, and staff operations involving kiln areas,
fueled or electric firings, glazing prep, and piece handling.

## Policy

- Dry sanding, dry sweeping, and compressed air use are not allowed in active
  studio areas. Use wet cleanup or approved methods.
- PPE is required for dusty material handling: at minimum a well-fitted mask and eye
  protection.
- Kiln room access follows staff direction. Unapproved users must not open kiln
  controllers, lids, or alarm panels.
- Heat safety: all shelves and posts are treated as hot unless staff confirms cool-down
  completion.
- Every piece entering the kiln must be clearly labeled with owner name and firing type.

## Implementation in portal

- Keep kiln safety requirements visible on scheduling and submission flows.
- Link piece-labeling and material restrictions in submission forms.
- Provide hazard reminders near any request type that triggers kiln work.

## Enforcement

Unsafe actions can trigger work rejection, reservation delays, or staff-only access for
the session involved.

## Support language

Support responses should clarify:

- what cleanup and PPE requirements apply that day
- whether a workpiece must be re-tagged
- when kiln-related delays are expected for safety sequencing

