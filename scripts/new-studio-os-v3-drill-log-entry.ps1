param(
  [string]$ScenarioId = "connector_outage",
  [string]$StudioBrainBaseUrl = "http://127.0.0.1:8787",
  [string]$Environment = "staging",
  [string]$ExecutedBy = "",
  [string]$OutFile = "docs/DRILL_EXECUTION_LOG.md"
)

$ErrorActionPreference = "Stop"

if (-not $ExecutedBy) {
  $ExecutedBy = $env:USERNAME
}

$dateUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$template = @'

---

## Studio OS v3 run metadata
```txt
dateUtc: {DATE_UTC}
executedBy: {EXECUTED_BY}
environment: {ENVIRONMENT}
studioBrainBaseUrl: {STUDIO_BRAIN_BASE_URL}
scenarioId: {SCENARIO_ID}
```

## Commands used
```sh
# Set only one chaos script per run entry.
CHAOS_MODE=true NODE_ENV={ENVIRONMENT} STUDIO_BRAIN_BASE_URL={STUDIO_BRAIN_BASE_URL} STUDIO_BRAIN_ADMIN_TOKEN=<REDACTED> node studio-brain/scripts/chaos/kill_switch_toggle.mjs
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
'@

$entry = $template.
  Replace("{DATE_UTC}", $dateUtc).
  Replace("{EXECUTED_BY}", $ExecutedBy).
  Replace("{ENVIRONMENT}", $Environment).
  Replace("{STUDIO_BRAIN_BASE_URL}", $StudioBrainBaseUrl).
  Replace("{SCENARIO_ID}", $ScenarioId)

if (-not (Test-Path $OutFile)) {
  throw "Output file not found: $OutFile"
}

Add-Content -Path $OutFile -Value $entry
Write-Host "Appended Studio OS v3 drill template to $OutFile"
