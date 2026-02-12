# P1 — Agent Client Registry and Key Rotation

Status: Open

## Problem
- Agent integrations need a first-class identity model.
- Without controlled key lifecycle, compromised agents can keep transacting.

## Goals
- Create an `agentClients` registry with clear status and trust metadata.
- Support safe key creation, rotation, suspension, and revocation.
- Keep secrets server-side only.

## Scope
- Data model: `agentClients/{id}` with `name`, `status`, `scopes`, `trustTier`, `rateLimits`, `keyHash`, `lastUsedAt`.
- Staff endpoints: create, rotate, suspend, revoke.
- Staff UI module for key lifecycle and status transitions.

## Security
- Never store plaintext keys in Firestore.
- Show key material exactly once at creation/rotation.
- Hash keys with server-side pepper and constant-time compare.

## Acceptance
- Staff can create/rotate/revoke clients end-to-end.
- Revoked keys fail auth immediately.
- All key lifecycle events produce audit logs.
