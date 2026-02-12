# P2 — Independent Agent Accounts, Prepay, and Limits

**Status:** Open

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
