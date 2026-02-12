Status: Open
Priority: P1
Labels: auth, security, v2-agentic, staff-tools, functions, web

## Title
Delegation revocation + expiry controls in staff tooling

## Problem statement
Staff and owners need immediate controls to revoke suspicious delegations.

## Scope
- Expose list/revoke delegation APIs in staff module.
- Show expiry, status, scope summary, owner, and revoke reason.

## Acceptance criteria
- Staff can list delegations and revoke by ID.
- Owner can revoke own delegations.
- Revoked delegation fails strict delegated requests immediately.

## Implementation notes
- Keep revoke operation idempotent.
- Include reason codes and requestId in audit row.

## Test plan
- API tests for owner revoke and staff revoke.
- Negative test for unauthorized revoke.

## Security notes
- No delegated token values displayed in staff UI.
- Revoke is server-enforced only.
