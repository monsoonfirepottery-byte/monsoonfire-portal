# Notification Drill Execution Log

Use this log while running `node ./scripts/ps1-run.mjs scripts/run-notification-drills.ps1` against deployed functions.

IMPORTANT: Do not paste real Firebase ID tokens or admin tokens into this file. Keep token values in your shell/clipboard only and record sources/results here.

Helper:
- You can append a fresh run template automatically with:
  - `node ./scripts/ps1-run.mjs scripts/new-drill-log-entry.ps1 -Uid "<REAL_UID>"`
- For Studio OS v3 incident drills, append a v3 template with:
  - `scripts/new-studio-os-v3-drill-log-entry -ScenarioId "connector_outage" -Environment "staging" -StudioBrainBaseUrl "http://127.0.0.1:8787"`

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
```shell
node ./scripts/ps1-run.mjs scripts/run-notification-drills.ps1 \
  -BaseUrl "https://us-central1-monsoonfire-portal.cloudfunctions.net" \
  -IdToken "<REDACTED_ID_TOKEN>" \
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
```txt
dateUtc: 2026-02-13T21:40:17Z
executedBy: micah
baseUrl: https://us-central1-monsoonfire-portal.cloudfunctions.net
uid: <REAL_UID>
idTokenSource: (for example "Chrome DevTools -> Network -> Authorization header from <endpoint>")
adminTokenUsed: no
```

## Command used
```shell
node ./scripts/ps1-run.mjs scripts/run-notification-drills.ps1 \
  -BaseUrl "https://us-central1-monsoonfire-portal.cloudfunctions.net" \
  -IdToken "<REDACTED_ID_TOKEN>" \
  -Uid "<REAL_UID>"
```

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
```sh
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

---

## Studio OS v3 run metadata
```txt
dateUtc: 2026-02-17T09:10:00Z
executedBy: micah
environment: staging
studioBrainBaseUrl: http://127.0.0.1:8787
scenarioId: token_compromise
```

## Commands used
```sh
# Set only one chaos script per run entry.
CHAOS_MODE=true NODE_ENV=staging STUDIO_BRAIN_BASE_URL=http://127.0.0.1:8787 STUDIO_BRAIN_ADMIN_TOKEN=<REDACTED> node studio-brain/scripts/chaos/kill_switch_toggle.mjs
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
POST /api/ops/drills payload:
GET /api/ops/drills rows:
GET /api/ops/audit rows:
GET /api/capabilities/audit rows:
```

---

## Studio OS v3 run metadata
```txt
dateUtc: 2026-02-17T17:47:52Z
executedBy: codex (approved by micah)
environment: local-staging-harness
studioBrainBaseUrl: http://127.0.0.1:8788
scenarioId: token_compromise, connector_outage, policy_bypass_attempt, local_db_corruption
artifact: output/drills/studio-os-v3-local-2026-02-17T17-47-52-585Z.json
```

## Commands used
```sh
node scripts/run-studio-os-v3-local-drills.mjs
```

## Observed results
```txt
token_compromise
startTimeUtc: 2026-02-17T17:47:52.585Z
endTimeUtc: 2026-02-17T17:47:52.700Z
mttrMinutes: 4
outcome: success
notes: kill-switch toggle completed (`200 true` on enable and disable) after async harness fix.
unresolvedRisks:

connector_outage
startTimeUtc: 2026-02-17T17:47:52.706Z
endTimeUtc: 2026-02-17T17:47:53.246Z
mttrMinutes: 9
outcome: partial
notes: timeout storm completed with connector health responses (`status=200 connectors=0`); degraded mode entered/exited and audited.
unresolvedRisks: connector-retry-threshold-tuning

policy_bypass_attempt
startTimeUtc: 2026-02-17T17:47:53.250Z
endTimeUtc: 2026-02-17T17:47:53.352Z
mttrMinutes: 6
outcome: success
notes: delegation race executed and returned expected denial responses (`DELEGATION_ACTOR_MISMATCH`, `DELEGATION_REVOKED`, `DELEGATION_EXPIRED`).
unresolvedRisks:

local_db_corruption
startTimeUtc: 2026-02-17T17:47:53.356Z
endTimeUtc: 2026-02-17T17:47:53.359Z
mttrMinutes: 12
outcome: partial
notes: tabletop recovery simulation validated degraded-mode enter/exit and ops audit events.
unresolvedRisks: db-restore-runbook-step-order
```

## Studio Brain audit evidence
```txt
GET /api/ops/drills rows: token_compromise=2, connector_outage=2, policy_bypass_attempt=2, local_db_corruption=2
GET /api/ops/audit rows (key actions observed): studio_ops.drill_event, studio_ops.degraded_mode_entered, studio_ops.degraded_mode_exited
GET /api/capabilities/audit rows: 8 in this local harness run (kill-switch toggles + delegation denial traces)
```

---

## Studio OS v3 run metadata
```txt
dateUtc: 2026-02-17T09:10:00Z
executedBy: micah
environment: staging
studioBrainBaseUrl: http://127.0.0.1:8787
scenarioId: connector_outage
```

## Commands used
```sh
# Set only one chaos script per run entry.
CHAOS_MODE=true NODE_ENV=staging STUDIO_BRAIN_BASE_URL=http://127.0.0.1:8787 STUDIO_BRAIN_ADMIN_TOKEN=<REDACTED> node studio-brain/scripts/chaos/kill_switch_toggle.mjs
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
POST /api/ops/drills payload:
GET /api/ops/drills rows:
GET /api/ops/audit rows:
GET /api/capabilities/audit rows:
```

---

## Studio OS v3 run metadata
```txt
dateUtc: 2026-02-17T09:10:01Z
executedBy: micah
environment: staging
studioBrainBaseUrl: http://127.0.0.1:8787
scenarioId: policy_bypass_attempt
```

## Commands used
```sh
# Set only one chaos script per run entry.
CHAOS_MODE=true NODE_ENV=staging STUDIO_BRAIN_BASE_URL=http://127.0.0.1:8787 STUDIO_BRAIN_ADMIN_TOKEN=<REDACTED> node studio-brain/scripts/chaos/kill_switch_toggle.mjs
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
POST /api/ops/drills payload:
GET /api/ops/drills rows:
GET /api/ops/audit rows:
GET /api/capabilities/audit rows:
```

---

## Studio OS v3 run metadata
```txt
dateUtc: 2026-02-17T09:10:01Z
executedBy: micah
environment: staging
studioBrainBaseUrl: http://127.0.0.1:8787
scenarioId: local_db_corruption
```

## Commands used
```sh
# Set only one chaos script per run entry.
CHAOS_MODE=true NODE_ENV=staging STUDIO_BRAIN_BASE_URL=http://127.0.0.1:8787 STUDIO_BRAIN_ADMIN_TOKEN=<REDACTED> node studio-brain/scripts/chaos/kill_switch_toggle.mjs
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
POST /api/ops/drills payload:
GET /api/ops/drills rows:
GET /api/ops/audit rows:
GET /api/capabilities/audit rows:
```
