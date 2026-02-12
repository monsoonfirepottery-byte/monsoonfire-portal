# P2 — Agent IP/Copyright and Prohibited Commissions Gate

Status: Open

## Problem
- Agent-generated commissions can include illegal, infringing, or prohibited requests.
- Studio needs enforceable controls before work enters production.

## Goals
- Build policy gates for prohibited work and IP/copyright risk.
- Keep high-risk commissions in manual review before acceptance.

## Scope
- Structured intake fields for rights attestation and intended use.
- Policy checks for prohibited categories and known risk patterns.
- Manual review queue with approve/reject + reason codes.

## Security
- Block fulfillment when legal gate fails.
- Store evidence snapshot for decisions.
- Staff actions require policy reference and reason code.

## Acceptance
- Non-compliant commissions cannot proceed to reserve/pay.
- Staff can review and decide with documented rationale.
- Audit logs include policy version used for decision.
