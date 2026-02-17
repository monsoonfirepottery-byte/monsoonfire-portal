Status: Completed
Priority: P1
Labels: auth, security, firestore-rules, v2-agentic

## Title
Harden Firestore rules for delegation and security audit collections

## Problem statement
New authz entities need explicit rules to avoid accidental client writes and overbroad reads.

## Scope
- Add rules for `delegations` and `auditEvents`.
- Confirm sensitive collections remain write-denied to clients.

## Acceptance criteria
- `delegations` read access limited to owner/staff.
- `auditEvents` read access staff-only; writes denied from clients.
- Rules compile and deploy cleanly.

## Implementation notes
- Keep all privileged writes in Cloud Functions.

## Test plan
- Emulator rules tests: non-owner denied, owner allowed read delegation, staff allowed.
- Ensure direct client write to these collections is denied.

## Security notes
- Least privilege only.
- Avoid exposing audit metadata to non-staff users.
