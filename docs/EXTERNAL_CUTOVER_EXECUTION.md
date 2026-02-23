# External Cutover Execution Checklist

Generated at: 2026-02-13T21:40:10Z  
Operator: micah  
Portal URL: https://portal.monsoonfire.com  
Firebase project: monsoonfire-portal

## 0) Studiobrain network profile contract
- [x] Active network profile is static LAN (`lan-static`)
- [x] Active static IP: `192.168.1.226`
- [ ] `studio-brain/.env.network.profile` reflects current host contract:
  - `STUDIO_BRAIN_NETWORK_PROFILE=lan-static`
  - `STUDIO_BRAIN_STATIC_IP=192.168.1.226`
  - optional fallback: `STUDIO_BRAIN_DHCP_HOST=<stable-hostname>`
- [ ] Verify network profile gate before cutover commands:
  - `npm run studio:network:check:gate -- --strict --write-state --json`
- [ ] Verify stack profile snapshot for LAN-safe host wiring:
  - `npm run studio:stack:profile:snapshot:strict -- --json`

Rollback plan when static assignment is unavailable:
- switch to DHCP-host fallback profile:
  - `STUDIO_BRAIN_NETWORK_PROFILE=dhcp-host`
  - `STUDIO_BRAIN_DHCP_HOST=studiobrain.local`
- rerun:
  - `npm run studio:network:check:gate -- --strict --write-state --json`
- optional emergency override for one-off recovery:
  - `STUDIO_BRAIN_HOST=<reachable_host_or_ip>`

## 1) DNS + hosting cutover
- [ ] DNS A/CNAME for portal host points to target hosting
- [ ] TLS/HTTPS valid and HTTP -> HTTPS redirect active
- [ ] Upload latest `web/dist` build + Namecheap `.htaccess`
- [ ] Confirm `.well-known` files exist when needed

Run verifier:
- Execute verifier script (primary Node path): `node ./web/deploy/namecheap/verify-cutover.mjs --portal-url "https://portal.monsoonfire.com" --report-path "docs/cutover-verify.json"`
- Compatibility shell form:
  - `web/deploy/namecheap/verify-cutover -PortalUrl "https://portal.monsoonfire.com" -ReportPath "docs/cutover-verify.json"`

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
- Use `node ./scripts/ps1-run.mjs scripts/new-auth-provider-run-entry.ps1`
- `-OutFile docs/PROD_AUTH_PROVIDER_RUN_LOG.md`
- `-PortalUrl "https://portal.monsoonfire.com"`

## 4) Hosted auth verification
- [ ] Google sign-in succeeds on hosted portal
- [ ] Apple sign-in succeeds on hosted portal
- [ ] Facebook sign-in succeeds on hosted portal
- [ ] Microsoft sign-in succeeds on hosted portal
- [ ] No `auth/unauthorized-domain` errors
- [ ] Popup blocked fallback works

## 5) Notification drill execution (prod token required)
- [ ] Append run template:
  - Run `node ./scripts/ps1-run.mjs scripts/new-drill-log-entry.ps1`
  - `-Uid "<REAL_UID>"`
- [ ] Run drills:
  - Execute `node ./scripts/ps1-run.mjs scripts/run-notification-drills.ps1`
  - Parameters:
    - `-BaseUrl "https://us-central1-monsoonfire-portal.cloudfunctions.net"`
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
