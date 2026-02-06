# Staff Claims Setup

Use Firebase custom claims to grant staff access in the portal.

## Prerequisites
- Firebase CLI authenticated to the correct project.
- User has signed in at least once so their auth record exists.

## Apply staff claim (production or staging)
1. Apply claim with Admin SDK:
   - `admin.auth().setCustomUserClaims(uid, { staff: true })`
   - or `admin.auth().setCustomUserClaims(uid, { roles: ["staff"] })`
2. Ask the user to refresh auth token:
   - Sign out/in, or wait for token refresh.

## Emulator note
- Dev admin token tooling is emulator-only and gated by:
  - `VITE_ENABLE_DEV_ADMIN_TOKEN=true`
  - local functions base URL (`localhost`/`127.0.0.1`)
  - `ALLOW_DEV_ADMIN_TOKEN=true` on functions side

## Verification checklist
1. Open portal and sign in as the user.
2. Confirm staff nav/tools render.
3. Confirm staff-only endpoints return `200` with bearer token.
4. Confirm non-staff user gets `401/403` for staff routes.
