# S12-01 - Auth Domain Strategy for Apple + Multi-provider

Created: 2026-02-10
Sprint: 12
Status: Completed
Swarm: A (Auth + Security)

## Problem

Portal production origin is `https://portal.monsoonfire.com` (Namecheap hosting). OAuth providers (Apple/Facebook/Microsoft) require stable redirect/return URLs.

Current web config uses `authDomain: monsoonfire-portal.firebaseapp.com` (Firebase hosted handler domain).

Unknown: whether Apple sign-in can remain stable using `*.firebaseapp.com/__/auth/handler`, or whether we must use a domain we control (e.g. `auth.monsoonfire.com`) to satisfy Apple requirements and long-term branding/security.

## Decision

Adopt option (2) for alpha and beyond:
- Dedicated auth handler domain `auth.monsoonfire.com` on Firebase Hosting
- Portal runtime uses `VITE_AUTH_DOMAIN=auth.monsoonfire.com`
- Redirect handler target is `https://auth.monsoonfire.com/__/auth/handler`

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

## Progress updates

- `web/src/firebase.ts` supports override via `VITE_AUTH_DOMAIN`.
- End-to-end DNS + Firebase + provider setup process documented in `docs/AUTH_DOMAIN_SETUP.md`.
- Provider credential ticket already references this decision path:
  - `tickets/P1-prod-auth-oauth-provider-credentials.md`
