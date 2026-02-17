# P2 — Agent IP/Copyright and Prohibited Commissions Gate

Status: Completed

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

## Progress notes
- Added commission policy gate in `functions/src/apiV1.ts`:
  - `agent.requests.create` now supports:
    - `rightsAttested: boolean`
    - `intendedUse: string | null`
  - Commission requests without `rightsAttested=true` are rejected (`FAILED_PRECONDITION`).
  - Added prohibited-pattern checks with deterministic reason codes; disallowed requests are rejected.
  - Added versioned commission policy metadata (`commissionPolicyVersion`) and `policy` object on request docs.
- Added commission decision guard in `agent.requests.updateStatus`:
  - Staff updates to `accepted` / `rejected` for commission requests require `reasonCode`.
  - Allowed reason codes are enforced server-side.
  - Policy version + reason code are written into both per-request audit and `agentAuditLogs`.
- Updated staff triage UI in `web/src/views/staff/AgentOpsModule.tsx`:
  - Added reason-code selector for policy-aligned decisions.
- Updated user request intake UI in `web/src/views/AgentRequestsView.tsx`:
  - Commission flow now captures intended use + rights attestation before submission.
