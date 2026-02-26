# Security Key Rotation Automation

This repo includes automated Firebase Web API key rotation for secret incidents.

## Workflow
- File: `.github/workflows/security-key-rotation.yml`
- Triggers:
  - `secret_scanning_alert` (`created`, `reopened`) for `google_api_key`
  - `workflow_dispatch` for manual emergency rotation

## What rotation does
1. Creates a new Google API key in project `monsoonfire-portal` with browser/API restrictions.
2. Updates GitHub secret `FIREBASE_WEB_API_KEY` used by web deploy builds.
3. Updates GitHub secret `FIREBASE_WEB_API_KEY_RESOURCE` with the new resource name.
4. Optionally disables the previous key resource (default enabled).
5. Optionally resolves the triggering secret-scanning alert as `revoked`.
6. Uploads rotation report artifacts under `output/security/key-rotation-*.json`.

## Required repository secrets
- `SECURITY_AUTOMATION_GH_TOKEN`
  - Personal access token for automation steps that update repo secrets and resolve secret-scanning alerts.
- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL`
  - Service account JSON with permission to create/disable API keys.
- `FIREBASE_WEB_API_KEY_RESOURCE` (optional initially, then maintained automatically)
  - Previous key resource path, for example:
    - `projects/monsoonfire-portal/locations/global/keys/abcd1234...`

## Optional repository variables
- `WEB_KEY_ALLOWED_REFERRERS`
  - Comma-separated browser referrers. If omitted, script defaults are used.
- `WEB_KEY_API_TARGETS`
  - Comma-separated API services. If omitted, script defaults are used.

## Manual emergency usage
1. Run `Security Key Rotation` via `workflow_dispatch`.
2. Set `reason` and (optionally) `alert_number`.
3. Leave `disable_previous=true` unless you need temporary overlap.
4. Use `dry_run=true` first if validating permissions and configuration.

## Guardrails
- Rotation does nothing for non-`google_api_key` secret alert events.
- Rotation fails fast if required automation secrets are missing.
- New key values are masked in workflow logs.
- The script never writes key values to repo files.
