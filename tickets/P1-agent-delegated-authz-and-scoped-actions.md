# P1 — Delegated Agent AuthZ and Scoped Actions

Status: Open

## Problem
- Agents acting for humans/entities can become confused deputies.
- Broad auth without scope/TTL is unsafe for money movement.

## Goals
- Introduce delegated credentials with strict operation scope.
- Enforce audience, short TTL, nonce/replay checks, and principal attribution.

## Scope
- Delegated token schema: `principalUid|entityId`, `agentClientId`, `scopes`, `aud`, `exp`, `nonce`.
- Middleware for endpoint scope checks: quote/reserve/pay/status.
- Replay cache for nonce + TTL window.

## Security
- Fail closed on missing/invalid claims.
- Block cross-audience token use.
- Audit every denied request with reason code.

## Acceptance
- Delegated flow works for allowed scopes only.
- Replay attempts are rejected.
- Every successful action records both agent and principal identity.
