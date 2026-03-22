# Local Secrets Layout (Gitignored)

Purpose: keep local automation secrets in canonical gitignored cache paths while keeping values out of source control.

## Paths

- `~/secrets/portal/portal-automation.env`
- `~/secrets/portal/portal-agent-staff.json`
- `secrets/portal/firebase-service-account-monsoonfire-portal-github-action.json`
- `secrets/studio-brain/studio-brain-automation.env`

## Rules

- Store secret values only in `secrets/` (gitignored), never in tracked docs/code.
- In docs, record variable names and file paths only.
- If a script adds a new required secret, update this runbook and the relevant feature runbook in the same change.
- Portal automation source of truth is the dedicated 1Password vault `Monsoon Fire Portal Automation`.
- Refresh the shared local cache with `npm run secrets:portal:sync`, then mirror it into the current worktree with `npm run secrets:sync:runtime` when needed.
- `npm run secrets:portal:sync --json` emits machine-readable JSON even on Windows/npm setups where `npm` consumes the flag before Node sees it.
- For home-cache-only refresh without repo mirroring, use `node ./scripts/sync-portal-secrets-from-1password.mjs --skip-runtime-mirror --json`.

## Portal Automation Variables

Required:

- `PORTAL_AGENT_STAFF_CREDENTIALS`
- `PORTAL_STAFF_EMAIL`
- `FIREBASE_RULES_API_TOKEN` (supports OAuth access token or durable OAuth refresh token format `1//...`)
- `PORTAL_FIREBASE_API_KEY`
- `FIREBASE_WEB_API_KEY` (mirror of `PORTAL_FIREBASE_API_KEY` for tool compatibility)

Operational note:
- As of March 1, 2026, the canonical local file `secrets/portal/portal-automation.env` is expected to carry populated `PORTAL_FIREBASE_API_KEY` and `FIREBASE_WEB_API_KEY` entries (not placeholders).
- Local automation should store `FIREBASE_RULES_API_TOKEN` as a durable `1//...` refresh token so scripts can exchange it for a fresh short-lived access token at runtime.
- Prefer a Firebase CLI or Google authorized-user refresh token; do not store short-lived `ya29...` access tokens in the 1Password source item.
- The rotated GitHub Actions service-account JSON is stored locally at `secrets/portal/firebase-service-account-monsoonfire-portal-github-action.json`; `portal-automation.env` should point `GOOGLE_APPLICATION_CREDENTIALS` to this file for index/promotion operations.
- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL` remains optional locally when a valid `GOOGLE_APPLICATION_CREDENTIALS` file path is present.

Recommended:

- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL` or `GOOGLE_APPLICATION_CREDENTIALS`
- `WEBSITE_DEPLOY_KEY`
- `PORTAL_STAFF_PASSWORD` (optional deep-diagnostic fallback only)

## Dedicated 1Password Items

- Vault: `Monsoon Fire Portal Automation`
- Secure note: `portal-automation-env`
- Secure note or document: `portal-agent-staff`
- Optional login item: `portal-staff-password`

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
source ~/secrets/portal/portal-automation.env
source /home/wuff/monsoonfire-portal/secrets/studio-brain/studio-brain-automation.env
set +a
```
