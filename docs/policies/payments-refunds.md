---
slug: "payments-refunds"
title: "Payment, refunds, and cancellations"
status: "active"
version: "2026-04-02"
effectiveDate: "2026-04-02"
reviewDate: "2026-10-02"
owner: "Billing Operations"
sourceUrl: "/policies/payments-refunds/"
summary: "Paid requests can receive full refunds before work starts, unpaid cancellations are penalty-free, and started work is reviewed on a prorated basis."
tags:
  - "payments"
  - "billing"
  - "policy"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Billing status, refund eligibility, no-penalty cancellations, and prorated review after work starts."
  defaultActions:
    - "verify payment state and service progress"
    - "determine whether the request qualifies for full refund, no-penalty cancellation, or prorated review"
    - "explain estimated refund or review timing"
  allowedLowRiskActions:
    - "answer policy questions about payment state, full refunds, no-penalty cancellations, and prorated review"
    - "collect transaction references, service stage details, and cancellation requests"
    - "explain when human approval is required"
  blockedActions:
    - "issue refunds or credits directly"
    - "waive fees or override settled charges"
    - "promise cancellation exceptions without billing approval"
  requiredSignals:
    - "payment reference"
    - "whether work has started"
    - "order/workflow status"
    - "requested cancellation reason"
  escalateWhen:
    - "chargeback or payment dispute risk"
    - "billing mismatch across systems"
    - "dispute over prorated charges after work has started"
  replyTemplate: "State whether the case qualifies for a full refund, a no-penalty cancellation, or prorated review, and include the next human review step when approval is required."
---

## Purpose

To define transparent payment timing, adjustment conditions, and cancellation outcomes.

## Scope

All membership, kiln, class, and supply payments across portal flows.

## Policy

- Payments are processed through approved Stripe flows and logged per transaction.
- If a customer has already paid and work has not started, the default outcome is a full refund after verification.
- If a customer cancels before payment is captured, the request can be canceled without penalty.
- If work has already started, refunds are reviewed on a prorated basis using workflow stage and any consumable cost already incurred.
- Members can ask for account credit alternatives where supported in current plan structure.

## Implementation in portal

- Capture payment state on each request and expose a consistent status label.
- Keep a clear cancellation/reversal path in the account UI.
- Require confirmation before void, reversal, or refund submission.

## Enforcement

Payment disputes may be held pending verification if services or production have already
started.

## Support language

Support should state:

- transaction reference
- whether work has started
- whether the request qualifies for full refund, no-penalty cancellation, or prorated review
- expected settlement or review timeline

