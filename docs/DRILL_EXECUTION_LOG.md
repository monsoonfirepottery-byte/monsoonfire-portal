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

---

## Run metadata
`	xt
dateUtc: 2026-02-13T21:40:17Z
executedBy: micah
baseUrl: https://us-central1-monsoonfire-portal.cloudfunctions.net
uid: <REAL_UID>
idTokenSource: (for example "Chrome DevTools -> Network -> Authorization header from <endpoint>")
adminTokenUsed: no
`

## Command used
`powershell
pwsh -File scripts/run-notification-drills.ps1 
  -BaseUrl "https://us-central1-monsoonfire-portal.cloudfunctions.net" 
  -IdToken "<REDACTED_ID_TOKEN>" 
  -Uid "<REAL_UID>"
`

## Captured outputs
`	xt
runNotificationFailureDrill responses:

runNotificationMetricsAggregationNow response:
`

## Firestore checks
`	xt
notificationJobs:
notificationJobDeadLetters:
notificationDeliveryAttempts:
notificationMetrics/delivery_24h:
`

## Evidence handoff
- Copy key counters and outcomes into docs/RELEASE_CANDIDATE_EVIDENCE.md.

---

# Studio OS v3 Drill Execution Log

Use this section for Studio Brain / Studio OS v3 safety drills.

## Run metadata
```txt
dateUtc:
executedBy:
environment: (staging/local)
studioBrainBaseUrl:
scenarioId: (token_compromise | connector_outage | policy_bypass_attempt | local_db_corruption)
```

## Commands used
```powershell
# Example: kill switch toggle
CHAOS_MODE=true NODE_ENV=staging STUDIO_BRAIN_BASE_URL=http://127.0.0.1:8787 STUDIO_BRAIN_ADMIN_TOKEN=<REDACTED> node studio-brain/scripts/chaos/kill_switch_toggle.mjs

# Example: connector timeout storm
CHAOS_MODE=true NODE_ENV=staging STUDIO_BRAIN_BASE_URL=http://127.0.0.1:8787 STUDIO_BRAIN_ADMIN_TOKEN=<REDACTED> node studio-brain/scripts/chaos/connector_timeout_storm.mjs

# Example: delegation revocation race
CHAOS_MODE=true NODE_ENV=staging STUDIO_BRAIN_BASE_URL=http://127.0.0.1:8787 STUDIO_BRAIN_ADMIN_TOKEN=<REDACTED> node studio-brain/scripts/chaos/delegation_revocation_race.mjs
```

## Expected safe-failure behavior
```txt
- privileged writes denied unless approved and policy-allowed
- kill switch refusal visible in audit logs
- connector outages surface as degraded state, not silent success
- portal remains usable if studio-brain is offline
```

## Observed results
```txt
startTimeUtc:
endTimeUtc:
mttrMinutes:
outcome: (success | partial | failed)
notes:
unresolvedRisks:
```

## Studio Brain audit evidence
```txt
GET /api/ops/drills rows:
GET /api/ops/audit rows:
GET /api/capabilities/audit rows:
```
