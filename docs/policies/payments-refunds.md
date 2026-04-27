---
slug: "payments-refunds"
title: "Payment, refunds, and cancellations"
status: "active"
version: "2026-04-15"
effectiveDate: "2026-04-15"
reviewDate: "2026-10-15"
owner: "Billing Operations"
sourceUrl: "/policies/payments-refunds/"
summary: "Firing services are charged when work is accepted into service, unpaid cancellations before acceptance are penalty-free, and confirmed studio-side firing mistakes are resolved with generous credits after review."
tags:
  - "payments"
  - "billing"
  - "policy"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Billing status, firing-service charge timing, cancellation eligibility before acceptance, and credit review after confirmed studio-side firing mistakes."
  defaultActions:
    - "verify service type, payment state, and whether work was accepted into service"
    - "determine whether the request qualifies for no-penalty cancellation, billing review, or studio-side credit review"
    - "explain expected review timing and next manual approval step"
  allowedLowRiskActions:
    - "answer policy questions about firing-service charge timing, cancellations before acceptance, and credit-review routing"
    - "collect transaction references, service stage details, and claimed studio-side mistake details"
    - "explain when human approval is required"
  blockedActions:
    - "issue refunds or credits directly"
    - "waive fees or override settled charges"
    - "promise cancellation exceptions without billing approval"
  requiredSignals:
    - "payment reference"
    - "service type"
    - "whether work was accepted into service"
    - "order/workflow status"
    - "whether a studio-side mistake is claimed or confirmed"
  escalateWhen:
    - "chargeback or payment dispute risk"
    - "billing mismatch across systems"
    - "dispute over responsibility for a firing outcome"
  replyTemplate: "State whether the firing charge was due at service acceptance, whether the case qualifies for no-penalty cancellation before acceptance, and whether it should enter generous credit review for a confirmed studio-side mistake."
---

## Purpose

To define transparent payment timing, adjustment conditions, and cancellation outcomes, with a specific firing-service rule that charges are collected once work is accepted into service.

## Scope

All membership, kiln, class, and supply payments across portal flows, with kiln firing services called out separately because their charge timing differs from the prior unload-first practice.

## Policy

- Payments are processed through approved Stripe flows and/or approved in-person payment handling, then logged per transaction.
- Kiln firing services are charged when the work is accepted into service, typically at drop-off or check-in, rather than waiting until unload.
- If a firing request is canceled before the work is accepted into service and before payment is captured, the request can be canceled without penalty.
- Once kiln work has been accepted into service, the firing charge normally remains in place even if the kiln cycle has not completed yet, because intake, queue planning, and handling work have already started.
- If a confirmed studio-side handling or firing mistake occurs, the default financial remedy is a generous credit applied to the affected firing service after review.
- If the issue is traced to maker-side materials, construction, glaze behavior, or firing-direction errors, firing credits are not automatic and any adjustment remains case-by-case.
- Non-kiln services continue to follow their published payment flow, including immediate charges for supplies/day passes and attendance-based workshop billing where applicable.

## Implementation in portal

- Capture payment state on each request and expose a consistent status label.
- Show firing-service charge timing clearly in intake, FAQ, support, and policy surfaces.
- Keep a documented credit-review path for confirmed studio-side firing mistakes.
- Require confirmation before any manual void, reversal, refund, or credit submission.

## Enforcement

Payment disputes may be held pending verification if work has already been accepted into service or if responsibility for a firing outcome is still under review.

## Support language

Support should state:

- transaction reference when one exists
- whether the work was accepted into service
- whether the request qualifies for no-penalty cancellation before acceptance
- whether the case should enter generous credit review for a confirmed studio-side mistake
- expected settlement or review timeline

