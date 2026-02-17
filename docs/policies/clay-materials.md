---
slug: "clay-materials"
title: "Clay & materials policy"
status: "active"
version: "2026-02-17"
effectiveDate: "2026-02-17"
reviewDate: "2026-08-01"
owner: "Studio Operations"
sourceUrl: "/policies/clay-materials/"
summary: "Use approved clay bodies and glazes. Ask for approval before introducing new materials."
tags:
  - "materials"
  - "kiln"
  - "approval"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Material approval and compatibility triage."
  defaultActions:
    - "collect full material list from request"
    - "check if requested materials are in approved set"
    - "route unknown materials to review and block until approval is logged"
  requiredSignals:
    - "supplier/material names"
    - "batch details"
    - "urgency or timeline constraint"
  escalateWhen:
    - "unapproved chemical materials"
    - "safety data missing for unknown glaze"
    - "high-value firing requiring exception review"
  replyTemplate: "Hold submission if new materials are unapproved; request composition, source, and firing intent."
---

## Purpose

To keep firings reliable and avoid avoidable kiln damage from incompatible materials.

## Scope

All submitted clay bodies, glazes, stains, underglazes, and any third-party
materials used in production.

## Policy

- Use only approved clay bodies and glaze systems unless staff has approved a new
  material in advance.
- Mixed sourcing is allowed when labeling and compatibility are clear, and when the
  submission includes the full material list.
- Unknown or unverified materials may be rejected before loading.
- Staff reserves the right to request additional testing before accepting risky formulas.

## Implementation in portal

- Surface material requirements on submission forms.
- Block unknown-material flags for entries missing material names.
- Provide a "needs review" state for approved exceptions.

## Enforcement

The studio may pause or refuse work that presents kiln safety or quality risks.

## Support language

Support should request:

- full material list (including slip body, glaze components, and any additives)
- photos of test tiles when available
- whether substitution with approved alternatives is acceptable

