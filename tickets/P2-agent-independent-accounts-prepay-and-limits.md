# P2 — Independent Agent Accounts, Prepay, and Limits

Status: Completed

## Problem
- Future agents may transact independently without a human principal.
- This creates elevated fraud and non-payment risk.

## Goals
- Introduce `agentAccounts` for independent agents with strict funding controls.
- Require prepay/deposit before reservation finalization.

## Scope
- Agent account model with status, funding method refs, and spending caps.
- Reserve/pay flow checks for available prepaid balance or confirmed Stripe payment.
- Velocity caps by agent/day and by service category.

## Security
- Independent mode disabled by default.
- Over-limit attempts hard fail and emit risk audit.
- Manual review gate for high-value or atypical jobs.

## Acceptance
- Independent agents cannot finalize unpaid reservations.
- Spending caps are enforced consistently.
- Staff can place account on hold and unblock with audit trail.

## Progress notes
- Added independent account model in `functions/src/apiV1.ts` (`agentAccounts/{agentClientId}`):
  - `status` (`active|on_hold`)
  - `independentEnabled`
  - `prepayRequired`
  - `prepaidBalanceCents`
  - `dailySpendCapCents`
  - daily spend tracking fields
- Added agent account endpoints:
  - `v1/agent.account.get`
  - `v1/agent.account.update` (staff-only)
- Enforced independent account checks in reserve/pay flows:
  - On-hold accounts hard fail.
  - Prepay-required accounts fail when balance is insufficient.
  - Daily/category spend caps enforced.
- Added prepaid debit behavior:
  - Independent-mode pay can settle from internal prepaid balance.
  - Writes account ledger entries under `agentAccounts/{id}/ledger/{orderId}`.
- Added staff controls in `web/src/views/staff/AgentOpsModule.tsx`:
  - hold/unhold, independent mode toggle, prepay toggle, daily cap, balance delta, reason.
