# Mobile Secure Storage + Session Model

Date: 2026-02-12
Owner: Auth + Security

## Storage boundaries
Sensitive (secure enclave/keychain-backed only):
- refresh token/session secrets
- delegated integration token cache (if enabled)
- admin/dev token overrides in dev builds only

Non-sensitive (UserDefaults/SharedPrefs):
- UI preferences
- non-secret feature flags
- last environment selection

## Logging + redaction policy
- Never log raw ID token, refresh token, PAT, Stripe secret, or APNs/FCM raw token.
- Diagnostic logs may include:
  - requestId
  - endpoint path
  - redacted curl shell (`Authorization: Bearer <REDACTED>`)
  - token hash suffix only

## Session refresh model
- Refresh ID token when:
  - app foregrounds and token age > 45m
  - privileged action (staff/admin) is requested
  - backend returns auth-expired error
- Staff claim refresh:
  - explicit `Refresh access` action in staff tools
  - background claim check at most every 10m while staff screen is open

## UI state contract
- Auth states: `signed_out`, `signed_in`, `refreshing`, `expired`.
- Staff-only navigation should re-evaluate claims on every successful refresh.
- If claims downgrade, close staff routes and show non-destructive notice.

## Incident controls
- Remote kill switch can force token cache clear on next launch.
- On suspected compromise, invalidate refresh tokens server-side and require full re-auth.

## Validation checklist
- Tokens are encrypted at rest on device.
- No secrets appear in analytics, crash reports, or console logs.
- Staff claim updates propagate without reinstall.
