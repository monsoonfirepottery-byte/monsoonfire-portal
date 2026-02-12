# Notification Drill Execution Log

Use this log while running `scripts/run-notification-drills.ps1` against deployed functions.

IMPORTANT: Do not paste real Firebase ID tokens or admin tokens into this file. Keep token values in your shell/clipboard only and record sources/results here.

Helper:
- You can append a fresh run template automatically with:
  - `pwsh scripts/new-drill-log-entry.ps1 -Uid "<REAL_UID>"`

## Run metadata
```txt
dateUtc:
executedBy:
baseUrl:
uid:
idTokenSource: (for example "Chrome DevTools -> Network -> Authorization header from <endpoint>")
adminTokenUsed: yes/no (should be "no" for production drills)
```

## Command used
```powershell
pwsh -File scripts/run-notification-drills.ps1 `
  -BaseUrl "https://us-central1-monsoonfire-portal.cloudfunctions.net" `
  -IdToken "<REDACTED_ID_TOKEN>" `
  -Uid "<REAL_UID>"
```

## Expected outcomes by mode
1. `auth`: non-retryable, failed + dead-letter.
2. `provider_4xx`: non-retryable, failed + dead-letter.
3. `provider_5xx`: retryable, queued retries then dead-letter if exhausted.
4. `network`: retryable, queued retries then dead-letter if exhausted.
5. `success`: telemetry sent path.

## Captured outputs
```txt
runNotificationFailureDrill responses:

runNotificationMetricsAggregationNow response:
```

## Firestore checks
```txt
notificationJobs:
notificationJobDeadLetters:
notificationDeliveryAttempts:
notificationMetrics/delivery_24h:
```

## Evidence handoff
- Copy key counters and outcomes into `docs/RELEASE_CANDIDATE_EVIDENCE.md`.
