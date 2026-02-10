# Notification On-Call Runbook

## Scope
Use this runbook when notification delivery shows elevated failures, delayed sends, or token invalidation spikes.

## Primary data sources
- Dead letters: `notificationJobDeadLetters`
- Delivery attempts: `notificationDeliveryAttempts`
- 24h aggregate snapshot: `notificationMetrics/delivery_24h`

## Thresholds (starting baseline)
- `failed` delivery attempts > 10% of total over 24h
- `provider_5xx` + `network` job failures > 5% over 24h
- Token deactivations (`deactivationReason` set by provider) > 3x weekly baseline

## Triage steps
1. Read `notificationMetrics/delivery_24h` and capture `statusCounts`, `reasonCounts`, `providerCounts`.
2. Query last 50 docs from `notificationJobDeadLetters` and identify dominant `errorClass`.
3. If dominant class is `auth`, rotate relay key and verify `APNS_RELAY_KEY` runtime environment configuration.
4. If dominant class is `provider_5xx` or `network`, confirm relay health and reduce traffic burst if needed.
5. If dominant class is `provider_4xx`, inspect provider codes and validate token invalidation behavior.

## Drill endpoint (staff-gated)
Manual aggregation trigger:
- `POST /runNotificationMetricsAggregationNow`
- Requires:
  - `Authorization: Bearer <ID_TOKEN>` (must be a real Firebase ID token JWT)
  - staff role (production) or dev admin token flow (emulator only)

Expected response:
- `{ ok: true, windowHours, totalAttempts, statusCounts, reasonCounts, providerCounts }`

### Getting A Real Firebase ID Token
1. Open the portal in a browser and sign in as the staff user.
2. Optional (local dev only): if you are running the portal locally, you can use:
   - `await window.__mfGetUid?.()` to confirm the Firebase Auth UID
   - `await window.__mfGetIdToken?.()` to copy a fresh ID token (JWT)
2. Open DevTools -> `Network`.
3. Trigger any portal action that calls Cloud Functions.
4. Click the request to `*.cloudfunctions.net/*`.
5. Copy the `Authorization` request header value (`Bearer ...`).
6. Paste only the token string (without `Bearer `) into `-IdToken`.

Notes:
- ID tokens expire (typically about 1 hour). If you see `UNAUTHENTICATED`, re-copy a fresh token.
- Do not paste real tokens into repo files. Keep them in your shell history only.
- `-AdminToken` is the dev-only `x-admin-token` header. It is not a Firebase ID token and should normally be omitted for production drills.

Drill runner script:
- `scripts/run-notification-drills.ps1`
- Production example (recommended):
  - `pwsh -File scripts/run-notification-drills.ps1 -BaseUrl "https://us-central1-monsoonfire-portal.cloudfunctions.net" -IdToken "<REAL_ID_TOKEN>" -Uid "<REAL_UID>"`
- Emulator example (dev-only):
  - `pwsh -File scripts/run-notification-drills.ps1 -BaseUrl "http://127.0.0.1:5001/monsoonfire-portal/us-central1" -IdToken "<REAL_ID_TOKEN>" -Uid "<REAL_UID>" -AdminToken "<DEV_ADMIN_TOKEN>"`

## Immediate mitigations
- Keep queue processing enabled; retry/backoff is automatic up to max attempts.
- For persistent provider failures, temporarily disable push channel in user prefs and rely on in-app/email.
- If relay credential issues are confirmed, rotate secret and redeploy functions.

## Escalation matrix
- Primary owner: Backend notifications on-call
- Secondary owner: Mobile integrations on-call
- Escalate to platform lead when outage duration exceeds 30 minutes or failure rate exceeds 25%.

## Post-incident checklist
1. Confirm `notificationMetrics/delivery_24h` has recovered below threshold.
2. Review `notificationJobDeadLetters` tail to ensure no fresh systemic failure pattern.
3. Record incident summary and mitigation in release evidence pack.
