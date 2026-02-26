# P1: Automated Key Rotation on Secret Alerts

## Objective
Automate response when a secret-scanning incident suggests compromised Google API key exposure.

## Scope
- Add `Security Key Rotation` workflow triggered by:
  - manual `workflow_dispatch`
  - hourly `schedule` that polls secret-scanning alerts and rotates only for new open `google_api_key` alerts outside baseline
- Create script to:
  - issue new restricted Firebase web API key,
  - update GitHub secrets,
  - disable previous key,
  - resolve alert as revoked when configured.

## Acceptance Criteria
- A `google_api_key` secret-scanning alert triggers rotation automatically when required secrets are configured.
- Manual dispatch can rotate keys for non-alert incidents (e.g., suspected improper issuance).
- Rotation writes auditable artifact report and does not log plaintext key values.

## Operational Requirements
- `SECURITY_AUTOMATION_GH_TOKEN` secret configured.
- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL` secret configured.
- `FIREBASE_WEB_API_KEY_RESOURCE` stored after first successful rotation for automatic disable.
