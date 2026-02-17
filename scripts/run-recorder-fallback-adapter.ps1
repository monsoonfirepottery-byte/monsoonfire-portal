<#
.SYNOPSIS
Manual/export fallback adapter for Maricopa Recorder signals.

.DESCRIPTION
Creates a stable manual template and stages any provided recorder export into
the canonical staging file expected by structured public signal ingestion.
This is a practical anti-bot fallback for sources that block direct scraping.

.OUTPUTS
output/real-estate/manual-drops/recorder-fallback/recorder-export.csv (template)
output/real-estate/staging/public-signals/maricopa_recorder_document_feed.csv
output/real-estate/recorder-fallback-<timestamp>.json
output/real-estate/recorder-fallback-latest.json
#>
param(
  [string]$ManualDir = "output/real-estate/manual-drops/recorder-fallback",
  [string]$StagingDir = "output/real-estate/staging/public-signals",
  [string]$OutputDir = "output/real-estate"
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Path $ManualDir -Force | Out-Null
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$templatePath = Join-Path $ManualDir "recorder-export.csv"
if (-not (Test-Path $templatePath)) {
  @"
parcel,owner_name,address,city,state,zip,signal_type,status,amount,recorded_date,case_number,record_url,notes
"@ | Set-Content -Path $templatePath -Encoding UTF8
}

$manualRows = @()
try {
  $manualRows = @(Import-Csv -Path $templatePath)
} catch {
  $manualRows = @()
}

$validRows = @()
foreach ($row in $manualRows) {
  $hasCore = (-not [string]::IsNullOrWhiteSpace([string]$row.parcel)) -or
             (-not [string]::IsNullOrWhiteSpace([string]$row.case_number)) -or
             (-not [string]::IsNullOrWhiteSpace([string]$row.record_url))
  if ($hasCore) {
    $validRows += $row
  }
}

$stagingPath = Join-Path $StagingDir "maricopa_recorder_document_feed.csv"
if ($validRows.Count -gt 0) {
  $validRows | Export-Csv -Path $stagingPath -NoTypeInformation -Encoding UTF8
} elseif (-not (Test-Path $stagingPath)) {
  "parcel,owner_name,address,city,state,zip,signal_type,status,amount,recorded_date,case_number,record_url,notes" | Set-Content -Path $stagingPath -Encoding UTF8
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$manifest = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  summary = [pscustomobject]@{
    manualRows = $manualRows.Count
    validRows = $validRows.Count
    staged = ($validRows.Count -gt 0)
  }
  templatePath = $templatePath
  stagingPath = $stagingPath
}

$jsonPath = Join-Path $OutputDir "recorder-fallback-$runId.json"
$latestPath = Join-Path $OutputDir "recorder-fallback-latest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $jsonPath -Encoding UTF8
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $latestPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $latestPath"

