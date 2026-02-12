Status: Open
Priority: P1
Labels: security, v2-agentic, functions, staff-tools

## Title
Canonical audit ledger for privileged actions

## Problem statement
Security operations need one append-only audit stream across auth, token, and delegated actions.

## Scope
- Write `auditEvents` on allow/deny/error for privileged endpoints.
- Include actor type, owner, resource, requestId, reason code, hashed IP.

## Acceptance criteria
- At least integration-token and delegated-token lifecycle actions are logged.
- API v1 auth failures generate audit rows.
- Staff can query audit rows in triage tooling.

## Implementation notes
- Best effort logging must not break request flow.
- Keep schema deterministic for exports.

## Test plan
- Integration test verifies action writes audit row.
- Negative path test verifies deny writes audit row.

## Security notes
- Hash IP; do not store raw IP.
- Avoid logging secrets/token plaintext.

