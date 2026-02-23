# External Cutover Execution Checklist
Generated at: 2026-02-23T21:44:16.252Z

Primary checklist is platform-neutral and uses compatibility-aware script entrypoints.

Portal URL: https://portal.monsoonfire.com
Firebase project: monsoonfire-portal

## 1) DNS + hosting cutover
- [ ] DNS A/CNAME for portal host points to target hosting
- [ ] TLS/HTTPS valid and HTTP -> HTTPS redirect active
- [ ] Upload latest `web/dist` build + Namecheap `.htaccess`
- [ ] Confirm `.well-known` files exist when needed

Run verifier:
- Execute the Node verifier (primary path):
  - `node ./web/deploy/namecheap/verify-cutover.mjs --portal-url "https://portal.monsoonfire.com" --report-path "docs/cutover-verify.json"`
- Execute authenticated protected-function verifier (required for cutover close-out):
  - `PORTAL_CUTOVER_ID_TOKEN="<REAL_ID_TOKEN>" node ./web/deploy/namecheap/verify-cutover.mjs`
    - `--portal-url "https://portal.monsoonfire.com"`
    - `--report-path "docs/cutover-verify.json"`
    - `--require-protected-check true`
    - `--functions-base-url https://us-central1-monsoonfire-portal.cloudfunctions.net`
    - `--protected-fn listMaterialsProducts`
    - `--protected-body '{"includeInactive":false}'`
  - Do not commit or log the raw token.
- Compatibility fallback (legacy alias):
  - `web/deploy/namecheap/verify-cutover`
    - `-PortalUrl "https://portal.monsoonfire.com"`
    - `-ReportPath "docs/cutover-verify.json"`

## 2) Firebase Auth baseline
- [ ] Firebase Console -> Authentication -> Settings -> Authorized domains include:
  - `portal.monsoonfire.com`
  - `monsoonfire.com`
  - `www.monsoonfire.com`
  - `localhost`
  - `127.0.0.1`
- [ ] Firebase sign-in methods enabled: Google, Email/Password, Email Link

## 3) OAuth provider credentials (external consoles)
- [ ] Apple configured in Firebase (Service ID + key)
- [ ] Facebook configured in Firebase (App ID + secret)
- [ ] Microsoft configured in Firebase (App ID + secret)
- [ ] Redirect URIs copied from Firebase provider panels exactly

Log entry helper:
- Run from compatibility-friendly shell:
  - `node ./scripts/ps1-run.mjs scripts/new-auth-provider-run-entry.ps1`
  - `-OutFile docs/PROD_AUTH_PROVIDER_RUN_LOG.md`
  - `-PortalUrl "https://portal.monsoonfire.com"`

## 4) Hosted auth verification
- [ ] Google sign-in succeeds on hosted portal
- [ ] Apple sign-in succeeds on hosted portal
- [ ] Facebook sign-in succeeds on hosted portal
- [ ] Microsoft sign-in succeeds on hosted portal
- [ ] No `auth/unauthorized-domain` errors
- [ ] Popup blocked fallback works

## 4b) Protected function verification from hosted auth context
- [ ] Capture a valid user ID token from hosted sign-in session (no token in git)
- [ ] Run authenticated verifier command (section 1)
- [ ] Confirm report includes `protectedFunction` in passed checks

## 5) Notification drill execution (prod token required)
- [ ] Append run template:
  - Run `node ./scripts/ps1-run.mjs scripts/new-drill-log-entry.ps1`
  - `-Uid "<REAL_UID>"`
- [ ] Run drills:
  - Execute `node ./scripts/ps1-run.mjs scripts/run-notification-drills.ps1`
  - Parameters:
    - `-BaseUrl https://us-central1-{PROJECT_ID}.cloudfunctions.net`
    - `-IdToken "<REAL_ID_TOKEN>"`
    - `-Uid "<REAL_UID>"`
    - `-OutputJson`
    - `-LogFile "docs/drill-runs.jsonl"`
- [ ] Verify Firestore evidence collections and update `docs/DRILL_EXECUTION_LOG.md`

## 6) Final evidence handoff
- [ ] Attach cutover verifier JSON report
- [ ] Attach provider run log entry
- [ ] Attach drill summary/log output
- [ ] Mark tickets complete:
  - `tickets/P0-portal-hosting-cutover.md`
  - `tickets/P1-prod-auth-oauth-provider-credentials.md`
  - `tickets/P0-alpha-drills-real-auth.md`

> Verifier execution intentionally skipped (--skip-verifier).
