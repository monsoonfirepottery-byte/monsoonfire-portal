<#
.SYNOPSIS
Appends a normalized human steering decision for intelligence opportunities.

.DESCRIPTION
Writes one JSONL steering record using a fixed action contract so agents can
consume human guidance deterministically across Portal/Discord/CLI channels.

Supported actions:
- approve_next_step
- hold
- reject
- request_more_evidence
- change_constraints
- change_risk_mode

.OUTPUTS
output/real-estate/intelligence-steering-log.jsonl
output/real-estate/intelligence-steering-log-latest.json
#>
param(
  [string]$OutputDir = "output/real-estate",
  [Parameter(Mandatory = $true)][string]$OpportunityId,
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$ReasonCode = "",
  [string]$RiskMode = "",
  [string]$ConstraintsPatchJson = "",
  [string]$Notes = "",
  [string]$Actor = "human_operator"
)

$ErrorActionPreference = "Stop"

$allowedActions = @(
  "approve_next_step",
  "hold",
  "reject",
  "request_more_evidence",
  "change_constraints",
  "change_risk_mode"
)

if (-not ($allowedActions -contains $Action)) {
  throw "Unsupported action '$Action'. Allowed actions: $($allowedActions -join ', ')"
}

$constraintsPatch = $null
if (-not [string]::IsNullOrWhiteSpace($ConstraintsPatchJson)) {
  try {
    $constraintsPatch = $ConstraintsPatchJson | ConvertFrom-Json
  } catch {
    throw "ConstraintsPatchJson is not valid JSON."
  }
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$logPath = Join-Path $OutputDir "intelligence-steering-log.jsonl"
$latestPath = Join-Path $OutputDir "intelligence-steering-log-latest.json"

$entry = [pscustomobject]@{
  timestampUtc = (Get-Date).ToUniversalTime().ToString("o")
  opportunityId = $OpportunityId
  action = $Action
  reasonCode = $ReasonCode
  riskMode = $RiskMode
  constraintsPatch = $constraintsPatch
  notes = $Notes
  actor = $Actor
}

$entryLine = $entry | ConvertTo-Json -Depth 10 -Compress
Add-Content -Path $logPath -Value $entryLine -Encoding UTF8

$items = @()
try {
  $items = @(Get-Content -Path $logPath -ErrorAction SilentlyContinue | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_ | ConvertFrom-Json })
} catch {
  $items = @()
}

$latestDoc = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  totalEntries = $items.Count
  recent = @($items | Select-Object -Last 200)
}
$latestDoc | ConvertTo-Json -Depth 10 | Set-Content -Path $latestPath -Encoding UTF8

Write-Host "Wrote $logPath"
Write-Host "Wrote $latestPath"
