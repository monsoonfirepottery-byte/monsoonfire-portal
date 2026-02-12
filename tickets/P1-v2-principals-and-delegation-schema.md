Status: Open
Priority: P1
Labels: auth, security, v2-agentic, firestore-rules, functions

## Title
Define V2 principals + delegation schema

## Problem statement
Delegated agent actions need a first-class, revocable grant model bound to owner, scope, and resource.

## Scope
- Finalize principal taxonomy (`human`, `staff`, `agent_pat`, `agent_delegated`).
- Define `delegations/{id}` schema and lifecycle fields.
- Add schema docs + examples.

## Acceptance criteria
- `delegations` schema documented in `docs/`.
- Firestore collection contract includes owner, agent client, scopes, resources, expiry, revocation.
- Strict mode enforcement path can resolve delegation by ID.

## Implementation notes
- Keep backward compatibility for existing delegated tokens while strict flag is off.
- Include migration note for old delegated calls.

## Test plan
- Unit tests for schema parsing and validation.
- Emulator smoke test for delegation reads and revocation updates via Functions.

## Security notes
- No secret material in delegation docs.
- Delegation IDs are opaque and non-sequential.
