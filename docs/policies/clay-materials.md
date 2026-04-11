---
slug: "clay-materials"
title: "Clay & materials policy"
status: "active"
version: "2026-04-02"
effectiveDate: "2026-04-02"
reviewDate: "2026-10-02"
owner: "Studio Operations"
sourceUrl: "/policies/clay-materials/"
summary: "Use approved clay bodies and glazes, disclose the full material stack, and route first-use or unknown materials to review before loading."
tags:
  - "materials"
  - "kiln"
  - "approval"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Approved-material verification, first-use review routing, and compatibility triage."
  defaultActions:
    - "collect full material list from request"
    - "check if requested materials are in approved set"
    - "route first-use or unknown materials to review and block until approval is logged"
  allowedLowRiskActions:
    - "list approved materials and request missing composition details"
    - "hold intake pending approval documentation"
    - "route unknown materials for review"
  blockedActions:
    - "approve unreviewed materials"
    - "grant firing exceptions for incompatible clay or glaze"
    - "override missing safety-data requirements"
  requiredSignals:
    - "supplier/material names"
    - "whether the material is first-use or already approved"
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
- First-use, unknown, or unverified materials may require advance approval, supporting documentation, or test tiles before loading.
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
- whether each material is already approved or is a first-use request
- photos of test tiles when available
- whether substitution with approved alternatives is acceptable

