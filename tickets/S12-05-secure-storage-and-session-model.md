# S12-05 - Secure Storage + Session Model (Mobile)

Created: 2026-02-10
Sprint: 12
Status: Open
Swarm: A (Auth + Security)

## Problem

Web stores transient dev-only values in session/local storage. Mobile must use platform secure storage and keep secrets out of logs.

We also need to define how token refresh and staff claim changes propagate to UI state.

## Tasks

- Define storage rules:
  - iOS: Keychain for refresh tokens/session, UserDefaults for non-sensitive flags
  - Android: Keystore/EncryptedSharedPreferences
- Define logging/redaction rules:
  - never log raw ID tokens
  - preserve redacted curl and request metadata for debugging
- Define staff claim refresh behavior:
  - refresh token schedule and how UI updates
  - explicit “Refresh access” action in Staff tools
- Document the model in:
  - `docs/IOS_RUNBOOK.md`
  - `docs/MOBILE_PARITY_TODOS.md`

## Acceptance

- Tokens are never persisted in plaintext.
- Staff claim changes become visible without requiring app reinstall.

