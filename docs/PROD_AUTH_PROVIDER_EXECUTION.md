# Production Auth Provider Execution Checklist

This checklist is the execution companion for `tickets/P1-prod-auth-oauth-provider-credentials.md`.

One-command planner:
- `pwsh scripts/run-external-cutover-checklist.ps1 -PortalUrl https://portal.monsoonfire.com`
- Generates `docs/EXTERNAL_CUTOVER_EXECUTION.md` and runs cutover verifier when DNS resolves.

## Scope
- Firebase project: `monsoonfire-portal`
- Primary portal domain: `portal.monsoonfire.com`

## 1) Firebase Auth baseline
1. Open Firebase Console -> Authentication -> Settings -> Authorized domains.
2. Confirm these are present:
   - `portal.monsoonfire.com`
   - `monsoonfire.com`
   - `www.monsoonfire.com`
   - `localhost`
   - `127.0.0.1`
3. Authentication -> Sign-in method:
   - Enable Google
   - Enable Email/Password
   - Enable Email Link
   - Enable Apple, Facebook, Microsoft (after provider app setup)

## 2) Redirect URI source of truth
Always copy redirect URIs directly from Firebase provider panels.

Use one of:
- `https://auth.monsoonfire.com/__/auth/handler` (if auth handler domain is enabled)
- `https://monsoonfire-portal.firebaseapp.com/__/auth/handler` (default)

Do not guess or hand-type variants.

## 3) Provider setup steps
### Microsoft (Entra)
1. Create app registration.
2. Add Firebase redirect URI.
3. Generate client secret.
4. Copy to Firebase Microsoft provider:
   - Application ID
   - Application secret

### Apple
1. Create Service ID + key in Apple Developer portal.
2. Add Firebase return URL from Firebase Apple provider docs/panel.
3. Copy to Firebase Apple provider fields.

### Facebook
1. Create Facebook app.
2. Add Firebase OAuth redirect URI.
3. Copy App ID + App Secret to Firebase Facebook provider.

## 4) Verification script
For each provider:
1. Visit `https://portal.monsoonfire.com`
2. Click provider sign in
3. Confirm successful return to portal session
4. Confirm no `auth/unauthorized-domain`
5. Confirm popup-blocked case falls back to redirect

## 5) Evidence capture (for ticket close)
Record and store in release notes/internal doc:
- date/time (UTC)
- operator
- provider tested
- result (pass/fail)
- screenshot path (optional)
- failure notes + remediation

Suggested table:

| Provider | Result | Tested by | Date (UTC) | Notes |
|---|---|---|---|---|
| Google |  |  |  |  |
| Apple |  |  |  |  |
| Facebook |  |  |  |  |
| Microsoft |  |  |  |  |

Helper:
- `pwsh scripts/new-auth-provider-run-entry.ps1`
- Optional: `-OutFile docs/PROD_AUTH_PROVIDER_RUN_LOG.md`

## 6) Rollback
If a provider breaks sign-in:
1. Disable the provider in Firebase Auth temporarily.
2. Keep Google + Email enabled.
3. Document incident and reopen provider setup task with exact failing step.
