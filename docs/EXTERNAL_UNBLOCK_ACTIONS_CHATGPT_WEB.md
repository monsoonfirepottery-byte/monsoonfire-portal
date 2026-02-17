# External Unblock Actions (Guided by ChatGPT Web)

This runbook is for completing the remaining blocked tickets that require external console access.

## Scope

- `tickets/P0-portal-hosting-cutover.md`
- `tickets/P1-prod-auth-oauth-provider-credentials.md`
- `tickets/P0-alpha-drills-real-auth.md`

## What Is Blocked

These items cannot be completed from repo-only tooling because they require:
- Namecheap DNS/hosting panel actions
- Firebase Console Auth provider configuration
- Microsoft/Apple/Facebook developer console OAuth setup
- A real production staff Firebase ID token and approved drill window

## Prerequisites

- Access to Namecheap DNS + hosting for `monsoonfire.com`
- Firebase project owner/editor access for `monsoonfire-portal`
- Access to provider consoles:
  - Microsoft Entra (Azure App Registration)
  - Apple Developer
  - Facebook Developers
- A production staff account able to sign in to portal auth
- PowerShell in repo root: `D:\monsoonfire-portal`

## Step 1: Run Consolidated Checklist

From repo root:

```powershell
scripts/run-external-cutover-checklist.ps1
```

If script supports report output in your branch, use it and keep the output artifact.

## Step 2: Portal Hosting Cutover (DNS/HTTPS/SPA)

Follow:
- `web/deploy/namecheap/README.md`
- `web/deploy/namecheap/.htaccess`
- `tickets/P0-portal-hosting-cutover.md`

Perform:
1. Point `portal.monsoonfire.com` DNS to hosting target.
2. Verify HTTPS cert issued and HTTP redirects to HTTPS.
3. Deploy portal build (`web/dist`) to hosting.
4. Ensure SPA rewrites:
   - non-file routes -> `/index.html`
   - `/.well-known/*` stays static
5. Verify cache policy:
   - `index.html` short/no cache
   - hashed `/assets/*` long cache immutable

Verify with:

```powershell
web/deploy/namecheap/verify-cutover.ps1
```

Capture evidence:
- Root URL load
- Deep-link refresh success
- `/.well-known/*` served
- Header/cache checks from verifier output

## Step 3: Firebase Auth + OAuth Provider Credentials

Follow:
- `docs/PROD_AUTH_PROVIDER_EXECUTION.md`
- `tickets/P1-prod-auth-oauth-provider-credentials.md`

In Firebase Console:
1. Add authorized domain: `portal.monsoonfire.com`.
2. Ensure required domains remain present (`monsoonfire.com`, `www.monsoonfire.com`, `localhost`, `127.0.0.1`).
3. Enable providers: Google, Email/Password, Email Link, Apple, Facebook, Microsoft.

In provider consoles:
1. Copy exact redirect URI from Firebase provider page (do not guess).
2. Create app/service credentials per provider.
3. Paste client ID + secret back into Firebase provider config.

Verify:
- Sign-in succeeds on `https://portal.monsoonfire.com` for each enabled provider.
- No `auth/unauthorized-domain` errors.

## Step 4: Production Notification Drill With Real Auth

Follow:
- `tickets/P0-alpha-drills-real-auth.md`
- `docs/NOTIFICATION_ONCALL_RUNBOOK.md`

Generate a sanitized drill log entry template:

```powershell
scripts/new-drill-log-entry.ps1
```

Run drills (example shape; use your approved args/window):

```powershell
scripts/run-notification-drills.ps1 -IdToken "<REAL_STAFF_ID_TOKEN>" -Uid "<STAFF_UID>" -OutputJson "docs/drill-output.json" -LogFile "docs/DRILL_EXECUTION_LOG.md"
```

Post-run verify Firestore artifacts:
- `notificationJobDeadLetters`
- `notificationDeliveryAttempts`
- `notificationMetrics/delivery_24h`

Capture:
- Command output JSON
- Log entry in `docs/DRILL_EXECUTION_LOG.md`
- Any screenshots/console evidence (sanitized)

## ChatGPT Web Prompt (Copy/Paste)

Use this prompt in ChatGPT web (GPT-5.2) to guide live console work:

```text
You are my production rollout copilot. I need a strict, step-by-step execution and verification walkthrough for Monsoon Fire portal unblock tasks.

Repository context:
- Local repo: D:\monsoonfire-portal
- Runbook: docs/EXTERNAL_UNBLOCK_ACTIONS_CHATGPT_WEB.md
- Related docs:
  - web/deploy/namecheap/README.md
  - docs/PROD_AUTH_PROVIDER_EXECUTION.md
  - docs/NOTIFICATION_ONCALL_RUNBOOK.md
  - tickets/P0-portal-hosting-cutover.md
  - tickets/P1-prod-auth-oauth-provider-credentials.md
  - tickets/P0-alpha-drills-real-auth.md

Your job:
1) Ask me for one action at a time.
2) Wait for my exact result before moving to next step.
3) For each step, provide:
   - where to click (console path),
   - exact value to paste,
   - command to run (if terminal),
   - expected pass/fail output.
4) Keep a running checklist with statuses: Pending / Passed / Failed / Blocked.
5) If a step fails, branch into targeted troubleshooting and then return to main checklist.
6) Ensure no secrets are pasted back into chat logs; tell me how to redact evidence.
7) End by producing a final evidence summary I can paste into ticket updates.
```

## Evidence Checklist (Done Criteria)

- Portal cutover verified with DNS/HTTPS/SPA/cache evidence.
- Firebase Auth domain + provider configs complete and verified with successful sign-ins.
- Notification drills executed with real staff auth and artifact collections verified.
- Ticket status updates performed from `Blocked` -> `Completed` (or remaining blocker documented).

## Ticket Update Template

```md
Update (YYYY-MM-DD):
- Completed external step(s): <list>
- Verification evidence: <links/files/screenshots>
- Residual issues: <none or details>
- Next action: <if any>
```

