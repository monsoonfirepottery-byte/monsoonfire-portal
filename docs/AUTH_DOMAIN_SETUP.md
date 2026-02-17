# Auth Domain Setup (portal on Namecheap, auth handler on Firebase)

Date: 2026-02-10

## Goal

Host the portal at `https://portal.monsoonfire.com` (Namecheap/static hosting) while using a Firebase Hosting custom domain for OAuth redirect handling:
- Auth handler domain: `https://auth.monsoonfire.com`
- Firebase Auth redirect handler path: `/__/auth/handler`

This reduces OAuth provider friction (Apple/Facebook/Microsoft) and makes redirect-based auth stable on mobile.

## High-level architecture

- Portal UI: Namecheap -> `portal.monsoonfire.com`
- OAuth redirect target: Firebase Hosting -> `auth.monsoonfire.com/__/auth/handler`
- Firebase project: `monsoonfire-portal`

## Steps

### 1) Create/confirm the auth handler domain in Firebase Hosting

In Firebase Console (project `monsoonfire-portal`):
- Hosting -> Add custom domain
- Domain: `auth.monsoonfire.com`

Firebase will show the DNS records you must add in Namecheap.

### 2) DNS (Namecheap)

Add the exact records Firebase provides for `auth.monsoonfire.com`.

Notes:
- Firebase may use `A` records and/or a `CNAME` depending on the setup.
- Do not improvise the record values, copy/paste from Firebase.

### 3) Firebase Auth -> Authorized domains

Firebase Console -> Authentication -> Settings -> Authorized domains:
- Add `portal.monsoonfire.com`
- Add `auth.monsoonfire.com`
- Ensure existing entries remain:
  - `monsoonfire.com`, `www.monsoonfire.com`, `localhost`, `127.0.0.1`

### 4) Update portal build environment (web)

Set the auth domain for the portal build:
- `VITE_AUTH_DOMAIN=auth.monsoonfire.com`

Reference:
- `web/src/firebase.ts` reads `VITE_AUTH_DOMAIN` (defaults to `monsoonfire-portal.firebaseapp.com`).
- `web/.env.example` documents the variable.

### 5) Configure OAuth providers using the new handler URL

In Firebase Console -> Authentication -> Sign-in method:
- For Apple/Facebook/Microsoft, Firebase shows the redirect URL.

With `auth.monsoonfire.com`, the expected redirect handler is:
- `https://auth.monsoonfire.com/__/auth/handler`

Copy/paste the redirect URL shown by Firebase into each provider console:
- Apple Developer (Service ID Return URLs)
- Facebook Developers (Valid OAuth Redirect URIs)
- Microsoft Entra ID (Web Redirect URIs)

### 6) Verify redirect-based sign-in end-to-end

On `https://portal.monsoonfire.com`:
- Test Google
- Test Email/password
- Test Email link
- Test Apple/Facebook/Microsoft

Expected:
- No `auth/unauthorized-domain`
- No popup dependency (redirect works on mobile)

## Non-goals

- This doc does not cover iOS/Android Universal Links; see `docs/DEEP_LINK_CONTRACT.md`.

