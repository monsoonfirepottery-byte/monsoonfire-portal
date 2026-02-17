# P2 — Portal UI: Integrations (Tokens + Events Feed + Webhooks)

Status: Completed

## Problem
- Even if backend supports PATs / events, clients need a first-class way to:
  - create tokens
  - scope them
  - revoke them
  - see recent usage / failures
- Without UI, operators end up sharing secrets informally (bad) and can’t revoke quickly.

## Goals
- Add an “Integrations” area in the Portal for the signed-in user.
- Tokens are displayed **once** at creation (copy-to-clipboard).
- Show audit/usage info: last used time, scope list, revoked state.
- (If Phase B webhooks are implemented) manage webhook endpoints here.

## Non-goals
- Multi-user org admin management (defer).
- Public developer portal.

## UX requirements
- Location: Profile/Settings (recommended) OR new left-nav item under “Studio & Resources”.
- Must be safe on mobile.
- Safety rails:
  - “Token will only be shown once” warning
  - Confirm revoke modal
  - Scope picker with short descriptions
  - Never store tokens in Firestore or localStorage (keep only in React state for that session)

## Data dependencies
- Backend endpoints from:
  - `tickets/P1-agent-integration-tokens.md`
  - `tickets/P1-agent-api-v1-contracts.md`
  - `tickets/P1-agent-events-feed-and-webhooks.md`

## Tasks
1. Add a new view:
  - `web/src/views/IntegrationsView.tsx`
  - `web/src/views/IntegrationsView.css`
2. Add to routing + nav.
3. Implement token management UI:
  - list tokens
  - create token:
    - label input
    - scopes multi-select
    - response shows plaintext token once with “Copy” button
  - revoke token
4. Add “Events Feed” help panel:
  - show example curl using PAT
  - show last 10 events fetched (optional)
5. (Optional) Webhook endpoint management if Phase B exists:
  - list endpoints, create, disable
  - show last delivery status.

## Acceptance
- A signed-in user can create/revoke/list integration tokens from the Portal UI.
- Tokens are not persisted client-side beyond the current session.
- UI remains responsive on mobile and doesn’t introduce white-screen behavior (keep ErrorBoundary intact).

## Progress
- Implemented:
  - `web/src/views/IntegrationsView.tsx`
  - `web/src/views/IntegrationsView.css`
  - Navigation entrypoint from Profile header (“Integrations” button)
  - Token create/list/revoke UX + “shown once” warning + copy-to-clipboard
  - Curl examples for `apiV1` endpoints and last-request debug panel (redacted)
  - Events feed smoke-test panel:
    - paste PAT (`events:read`)
    - fetch by cursor/limit
    - preview recent event rows and payloads
    - apply `nextCursor` directly for follow-up pulls
