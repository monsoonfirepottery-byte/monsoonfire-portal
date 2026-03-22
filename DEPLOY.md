# Deployment Guide

## 1) Pre-Deployment Checklist
- Confirm work is on `main` and up-to-date:
  - `git pull origin main`
- Confirm required environment is set:
  - `firebase use monsoonfire-portal`

## 2) Deploy (Current Release)
Run from repository root:

```bash
npm run deploy:functions-hosting
```

Notes:
- `deploy:functions-hosting` deploys **all** Cloud Functions and Hosting together, so shared middleware changes are included.
- It is safer than targeting `functions:websiteKilnBoard` when a change touches shared function code.
- If needed, you can run:
  - `npm run deploy:functions` (functions only)
  - `npm run deploy:hosting` (hosting only)
  - `npm run deploy` (both sections from `firebase.json`)
- CLI output should end with:
  - `+  Deploy complete!`

## 3) Verification / Smoke Tests
- Function endpoint:
  - Open: `https://<your-domain>/api/websiteKilnBoard`
  - Expect JSON with fields:
    - `lastUpdated`
    - `updatedBy`
    - `kilns` array
- Frontend render:
  - Open kiln board page in the website
  - Confirm kiln cards render via dynamic JSON payload
  - Confirm no console errors
- Fallback behavior:
  - `/api/websiteKilnBoard` should be first attempted
  - `/data/kiln-status.json` is used only if function endpoint fails

## 4) Post-Deploy Notes
- If deploy asks for secrets, values are stored in Secret Manager.
- If anything looks wrong, confirm rewrite exists in `firebase.json`:
  - `"/api/websiteKilnBoard" -> function "websiteKilnBoard"`

## 5) Alerts / Follow-Up
- Watch Firebase logs for `websiteKilnBoard` errors during first few minutes.
- If endpoint degrades, inspect Cloud Function logs in Firebase Console.

## 6) Namecheap Portal Deploy Defaults
- Primary portal deploy command:
  - `npm run deploy:namecheap:portal`
- Shared runtime secrets path for Codex/worktrees:
  - `~/secrets/portal/portal-automation.env`
  - `~/secrets/portal/portal-agent-staff.json`
  - Refresh that shared copy from 1Password with:
    - `npm run secrets:portal:sync`
  - Mirror the shared cache into the current worktree with:
    - `npm run secrets:sync:runtime`
- Deploy script auto-load order:
  - `PORTAL_AUTOMATION_ENV_PATH` override, if set
  - `~/secrets/portal/portal-automation.env`, when present
  - `./secrets/portal/portal-automation.env`, when present
- Default SSH target is now configured in deploy tooling:
  - `monsggbd@66.29.137.142:21098`
- SSH key auto-discovery order:
  - `WEBSITE_DEPLOY_KEY`, if set
  - `~/.ssh/namecheap-portal`, when present
  - `IdentityFile` under `Host monsoonfire` in `~/.ssh/config`
- Post-deploy promotion gate now runs by default after sync:
  - Authenticated portal canary
  - Virtual staff backend regression
  - Firestore index contract guard
  - Override only when intentionally needed: `--skip-promotion-gate`
- Promotion gate credential note:
  - `portal-agent-staff.json` is now the normal-path credential source for both backend checks and the authenticated canary.
  - Raw `PORTAL_STAFF_PASSWORD` is optional and only used for explicit deep-diagnostic `--auth-mode password-ui` runs.
- Optional overrides (if infra changes):
  - `WEBSITE_DEPLOY_SERVER`
  - `WEBSITE_DEPLOY_PORT`
  - `WEBSITE_DEPLOY_KEY`
  - `WEBSITE_DEPLOY_REMOTE_PATH`
