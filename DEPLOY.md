# Deployment Guide

## 1) Pre-Deployment Checklist
- Confirm work is on `main` and up-to-date:
  - `git pull origin main`
- Confirm required environment is set:
  - `firebase use monsoonfire-portal`

## 2) Deploy (Current Release)
Run from repository root:

```bash
npm run -C functions build
firebase deploy --only functions:websiteKilnBoard,hosting
```

Notes:
- `functions` deploy will prompt for missing Secret Manager values when needed.
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
