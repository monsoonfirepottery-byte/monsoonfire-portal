<#
.SYNOPSIS
Runs a lightweight local test suite for real-estate intelligence workflows.

.DESCRIPTION
Supports three modes:
1) optional full cadence run
2) contract checks on latest outputs
3) deterministic studio-asset harness validation

Writes a test-suite report JSON for operators and agent workflows.
#>
param(
  [string]$OutputDir = "output/real-estate",
  [switch]$RunCadence,
  [switch]$SkipContractChecks,
  [switch]$SkipAssetHarness
)

$ErrorActionPreference = "Stop"

$steps = @()
function Add-StepResult {
  param(
    [string]$Name,
    [string]$Status,
    [double]$DurationSec,
    [string]$Error
  )
  $script:steps += [pscustomobject]@{
    name = $Name
    status = $Status
    durationSec = [math]::Round($DurationSec, 2)
    error = $Error
  }
}

$suiteStart = Get-Date

if ($RunCadence) {
  $start = Get-Date
  try {
    & (Join-Path $PSScriptRoot "run-real-estate-weekly-cadence.ps1") -OutputDir $OutputDir -PublicDataDir (Join-Path $OutputDir "public-data") -StagingDir (Join-Path $OutputDir "staging/public-signals") -ManualDropDir (Join-Path $OutputDir "manual-drops")
    Add-StepResult -Name "weekly_cadence" -Status "ok" -DurationSec (((Get-Date) - $start).TotalSeconds) -Error ""
  } catch {
    Add-StepResult -Name "weekly_cadence" -Status "error" -DurationSec (((Get-Date) - $start).TotalSeconds) -Error ([string]$_.Exception.Message)
  }
}

if (-not $SkipContractChecks) {
  $start = Get-Date
  try {
    & (Join-Path $PSScriptRoot "test-real-estate-contracts.ps1") -OutputDir $OutputDir
    Add-StepResult -Name "contract_checks" -Status "ok" -DurationSec (((Get-Date) - $start).TotalSeconds) -Error ""
  } catch {
    Add-StepResult -Name "contract_checks" -Status "error" -DurationSec (((Get-Date) - $start).TotalSeconds) -Error ([string]$_.Exception.Message)
  }
}

if (-not $SkipAssetHarness) {
  $start = Get-Date
  try {
    & (Join-Path $PSScriptRoot "test-studio-asset-intel-harness.ps1")
    Add-StepResult -Name "asset_harness" -Status "ok" -DurationSec (((Get-Date) - $start).TotalSeconds) -Error ""
  } catch {
    Add-StepResult -Name "asset_harness" -Status "error" -DurationSec (((Get-Date) - $start).TotalSeconds) -Error ([string]$_.Exception.Message)
  }
}

$status = if ((@($steps | Where-Object { $_.status -eq "error" })).Count -gt 0) { "error" } else { "ok" }
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$report = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  status = $status
  summary = [pscustomobject]@{
    totalSteps = $steps.Count
    passed = (@($steps | Where-Object { $_.status -eq "ok" })).Count
    failed = (@($steps | Where-Object { $_.status -eq "error" })).Count
    durationSec = [math]::Round(((Get-Date) - $suiteStart).TotalSeconds, 2)
  }
  steps = $steps
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$reportPath = Join-Path $OutputDir "test-suite-$runId.json"
$latestPath = Join-Path $OutputDir "test-suite-latest.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $latestPath -Encoding UTF8

Write-Host "Wrote $reportPath"
Write-Host "Wrote $latestPath"

if ($status -eq "error") {
  throw "Real-estate test suite failed. See $latestPath"
}

