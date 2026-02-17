---
slug: "payments-refunds"
title: "Payment, refunds, and cancellations"
status: "active"
version: "2026-02-17"
effectiveDate: "2026-02-17"
reviewDate: "2026-08-01"
owner: "Billing Operations"
sourceUrl: "/policies/payments-refunds/"
summary: "Payment and refund timing is tied to workflow stage and transaction state."
tags:
  - "payments"
  - "billing"
  - "policy"
agent:
  canActForSelf: true
  canActForOthers: true
  decisionDomain: "Billing status, refund eligibility, cancellation handling."
  defaultActions:
    - "verify payment state and service progress"
    - "explain estimated refund/charge timing"
    - "prepare reversal or hold request if policy permits"
  requiredSignals:
    - "payment reference"
    - "order/workflow status"
    - "requested cancellation reason"
  escalateWhen:
    - "chargeback or payment dispute risk"
    - "billing mismatch across systems"
    - "manual intervention for partially completed service"
  replyTemplate: "Share state-based outcome (eligible, pending, manual review) and next expected timeline."
---

## Purpose

To define transparent payment timing, adjustment conditions, and cancellation outcomes.

## Scope

All membership, kiln, class, and supply payments across portal flows.

## Policy

- Payments are processed through approved Stripe flows and logged per transaction.
- Cancellations and schedule changes are handled case-by-case based on work status.
- Refund timing follows completed workflow stage and any consumable cost already incurred.
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
- current status
- what stage work is in
- expected settlement or refund timeline

