# P1 - Production Auth: Create OAuth Apps + Configure Provider Secrets

Created: 2026-02-10

## Why

Firebase Auth provider setup for Microsoft/Facebook/Apple requires OAuth client IDs + secrets that are issued by each provider's developer console. These are not repo values and must be created and pasted into Firebase Console.

If this is not completed, sign-in buttons may fail and/or providers cannot be enabled.

## Scope

- Portal domain: `portal.monsoonfire.com` (no `www.portal.*`)
- Firebase project: `monsoonfire-portal`

## Tasks (Firebase Console)

- Authentication -> Settings -> Authorized domains:
  - Add `portal.monsoonfire.com`
  - Ensure `monsoonfire.com`, `www.monsoonfire.com`, `localhost`, `127.0.0.1` are present
- Authentication -> Sign-in method:
  - Enable: Google, Email/Password, Email Link, Apple, Facebook, Microsoft

## Tasks (Provider Consoles)

Redirect URI note:
- If you adopt the Hosting-backed auth handler domain (`auth.monsoonfire.com`), the redirect URI will be:
  - `https://auth.monsoonfire.com/__/auth/handler`
- Otherwise it will remain on the default Firebase domain:
  - `https://monsoonfire-portal.firebaseapp.com/__/auth/handler`

### Microsoft (Entra ID / Azure App Registration)

- Create a new app registration
- Add Redirect URI shown in Firebase Console (copy/paste exactly):
- Copy/paste the exact redirect URI shown in Firebase (do not guess).
- Copy values into Firebase:
  - `Application (client) ID` -> Firebase "Application ID"
  - Create `Client secret` -> Firebase "Application secret"

### Apple

- Create Service ID + key
- Add Firebase redirect/return URL shown in Firebase Console for Apple provider
- Paste Apple Service ID + secret/key details into Firebase Apple provider config

### Facebook

- Create Facebook app
- Add Firebase OAuth redirect URI shown in Firebase Console for Facebook provider
- Paste App ID + App Secret into Firebase Facebook provider config

## Acceptance

- Visiting `https://portal.monsoonfire.com` and clicking each provider sign-in completes successfully.
- No `auth/unauthorized-domain` errors.
- Popup blocked cases fall back to redirect (client code).
