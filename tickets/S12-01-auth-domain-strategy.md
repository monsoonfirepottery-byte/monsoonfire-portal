# S12-01 - Auth Domain Strategy for Apple + Multi-provider

Created: 2026-02-10
Sprint: 12
Status: Open
Swarm: A (Auth + Security)

## Problem

Portal production origin is `https://portal.monsoonfire.com` (Namecheap hosting). OAuth providers (Apple/Facebook/Microsoft) require stable redirect/return URLs.

Current web config uses `authDomain: monsoonfire-portal.firebaseapp.com` (Firebase hosted handler domain).

Unknown: whether Apple sign-in can remain stable using `*.firebaseapp.com/__/auth/handler`, or whether we must use a domain we control (e.g. `auth.monsoonfire.com`) to satisfy Apple requirements and long-term branding/security.

## Decision

Choose one:

1. Keep Firebase auth handler domain (`monsoonfire-portal.firebaseapp.com`) for alpha.
2. Introduce a dedicated auth handler domain:
   - `auth.monsoonfire.com` mapped to Firebase Hosting
   - `authDomain` updated via `VITE_AUTH_DOMAIN` (see `docs/AUTH_DOMAIN_SETUP.md`)

## Tasks

- Confirm the exact redirect URIs required for:
  - Apple
  - Facebook
  - Microsoft
- If option (2):
  - Set up DNS for `auth.monsoonfire.com`
  - Configure Firebase Hosting custom domain for `auth.monsoonfire.com`
  - Ensure `https://auth.monsoonfire.com/__/auth/handler` serves correctly
  - Set portal build env `VITE_AUTH_DOMAIN=auth.monsoonfire.com`
  - Update docs: `tickets/P1-prod-auth-oauth-provider-credentials.md`

## Acceptance

- Provider sign-in works on:
  - desktop Chrome
  - iOS Safari
  - in-app browsers (best effort)
- No `auth/unauthorized-domain` for `portal.monsoonfire.com`.
- Redirect-based auth works reliably on mobile (no popup dependency).

## Execution notes

- Step-by-step: `docs/AUTH_DOMAIN_SETUP.md`
