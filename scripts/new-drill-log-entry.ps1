param(
  [string]$BaseUrl = "https://us-central1-monsoonfire-portal.cloudfunctions.net",
  [string]$Uid = "",
  [string]$ExecutedBy = "",
  [string]$OutFile = "docs/DRILL_EXECUTION_LOG.md"
)

$ErrorActionPreference = "Stop"

if (-not $ExecutedBy) {
  $ExecutedBy = $env:USERNAME
}

$dateUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$uidText = if ($Uid) { $Uid } else { "<REAL_UID>" }

$entry = @"

---

## Run metadata
```txt
dateUtc: $dateUtc
executedBy: $ExecutedBy
baseUrl: $BaseUrl
uid: $uidText
idTokenSource: (for example "Chrome DevTools -> Network -> Authorization header from <endpoint>")
adminTokenUsed: no
```

## Command used
```sh
node ./scripts/ps1-run.mjs scripts/run-notification-drills.ps1 `
  -BaseUrl "$BaseUrl" `
  -IdToken "<REDACTED_ID_TOKEN>" `
  -Uid "$uidText"
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
"@

if (-not (Test-Path $OutFile)) {
  throw "Output file not found: $OutFile"
}

Add-Content -Path $OutFile -Value $entry
Write-Host "Appended drill log template to $OutFile"
