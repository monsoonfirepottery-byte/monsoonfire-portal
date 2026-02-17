# Staff Claims Setup

Use Firebase custom claims to grant staff access in the portal.

## Prerequisites
- Firebase CLI authenticated to the correct project.
- User has signed in at least once so their auth record exists.

## Studiobrain local staff bootstrap (recommended)
1. Start the Auth emulator (and Firestore if needed).
2. Run:
   - `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node functions/scripts/setStaffClaim.js --email studio-brain-staff@monsoonfire.local --password "<PASSWORD>" --display-name "Studio Brain Staff"`
3. Record the generated/assigned password and use it to sign into the portal via the emulator mode sign-in form.
4. The command also supports existing users:
   - `... --uid <uid-or-existing-email>` to refresh staff role for an existing member.

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

## Messages form legacy CC/BCC verification
Use this once your staff session is active:
1. Set:
   - `PORTAL_STAFF_EMAIL=studio-brain-staff@monsoonfire.local`
   - `PORTAL_STAFF_PASSWORD=<PASSWORD>`
2. Run:
   - `npm --prefix web run check:messages-playwright`
3. A missing CC/BCC pass returns:
   - `PASS: no legacy CC/BCC fields rendered in new message form.`
