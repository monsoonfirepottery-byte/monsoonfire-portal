# Local Secrets Layout (Gitignored)

Purpose: keep local automation secrets in canonical, repo-local paths while keeping values out of source control.

## Paths

- `secrets/portal/portal-automation.env`
- `secrets/portal/portal-agent-staff.json`
- `secrets/portal/firebase-service-account-monsoonfire-portal-github-action.json`
- `secrets/studio-brain/studio-brain-automation.env`

## Rules

- Store secret values only in `secrets/` (gitignored), never in tracked docs/code.
- In docs, record variable names and file paths only.
- If a script adds a new required secret, update this runbook and the relevant feature runbook in the same change.

## Portal Automation Variables

Required:

- `PORTAL_AGENT_STAFF_CREDENTIALS`
- `PORTAL_STAFF_EMAIL`
- `PORTAL_STAFF_PASSWORD`
- `FIREBASE_RULES_API_TOKEN` (supports OAuth access token or Firebase CLI refresh token format `1//...`)
- `PORTAL_FIREBASE_API_KEY`
- `FIREBASE_WEB_API_KEY` (mirror of `PORTAL_FIREBASE_API_KEY` for tool compatibility)

Operational note:
- As of March 1, 2026, the canonical local file `secrets/portal/portal-automation.env` is expected to carry populated `PORTAL_FIREBASE_API_KEY` and `FIREBASE_WEB_API_KEY` entries (not placeholders).
- Local automation should store `FIREBASE_RULES_API_TOKEN` as a Firebase CLI refresh token (`1//...`) so scripts can exchange it for a fresh short-lived access token at runtime.
- The rotated GitHub Actions service-account JSON is stored locally at `secrets/portal/firebase-service-account-monsoonfire-portal-github-action.json`; `portal-automation.env` should point `GOOGLE_APPLICATION_CREDENTIALS` to this file for index/promotion operations.
- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL` remains optional locally when a valid `GOOGLE_APPLICATION_CREDENTIALS` file path is present.

Recommended:

- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL` or `GOOGLE_APPLICATION_CREDENTIALS`
- `WEBSITE_DEPLOY_KEY`

## Studio Brain Automation Variables

Common:

- `STUDIO_BRAIN_ADMIN_TOKEN`
- `STUDIO_BRAIN_ID_TOKEN`
- `STUDIO_BRAIN_EXPORT_SIGNING_KEY`

Optional integrations:

- `GOOGLE_CALENDAR_CREDENTIALS`
- `GITHUB_LOOKUP_TOKEN`
- `TWILIO_AUTH_TOKEN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## Shell Load

```bash
set -a
source /home/wuff/monsoonfire-portal/secrets/portal/portal-automation.env
source /home/wuff/monsoonfire-portal/secrets/studio-brain/studio-brain-automation.env
set +a
```
