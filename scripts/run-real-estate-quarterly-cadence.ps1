<#
.SYNOPSIS
Runs quarterly real-estate trend generation and publishes a stable swarm prompt handoff.

.DESCRIPTION
Builds quarterly context from historical snapshots, maintains stable latest aliases,
and emits a memory-ingest payload intended for downstream swarm prompts.

.OUTPUTS
output/real-estate/quarterly-cadence-<timestamp>.json
output/real-estate/quarterly-cadence-latest.json
output/real-estate/quarterly-context-memory-<timestamp>.json
output/real-estate/quarterly-context-memory-latest.json
output/real-estate/agent-swarm-context-latest.json
#>
param(
  [string]$InputDir = "output/real-estate",
  [string]$OutputDir = "output/real-estate",
  [int]$ContextLookbackRuns = 8,
  [int]$TopCandidates = 10
)

$ErrorActionPreference = "Stop"

function Add-StepResult {
  param(
    [string]$Name,
    [string]$Status,
    [double]$DurationSec,
    [string]$Error
  )
  $script:Steps += [pscustomobject]@{
    name = $Name
    status = $Status
    durationSec = [math]::Round($DurationSec, 2)
    error = $Error
  }
}

$script:Steps = @()
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")

$buildStart = Get-Date
try {
  & (Join-Path $PSScriptRoot "build-real-estate-quarterly-context.ps1") `
    -InputDir $InputDir `
    -OutputDir $OutputDir `
    -ContextLookbackRuns $ContextLookbackRuns `
    -TopCandidates $TopCandidates
  Add-StepResult -Name "build_quarterly_context" -Status "ok" -DurationSec (((Get-Date) - $buildStart).TotalSeconds) -Error ""
} catch {
  Add-StepResult -Name "build_quarterly_context" -Status "error" -DurationSec (((Get-Date) - $buildStart).TotalSeconds) -Error ([string]$_.Exception.Message)
  throw
}

$handoffStart = Get-Date
try {
  $latestContextPath = Join-Path $OutputDir "agent-swarm-context-latest.json"
  if (-not (Test-Path $latestContextPath)) {
    throw "Latest agent-swarm context alias missing after context build: $latestContextPath"
  }

  $contextDoc = Get-Content -Raw $latestContextPath | ConvertFrom-Json
  if ($null -eq $contextDoc) {
    throw "Failed to parse quarter context artifact: $latestContextPath"
  }

  $quarterSlug = [string]$contextDoc.latestQuarter
  $reportPath = Join-Path $OutputDir "real-estate-quarterly-report-$quarterSlug.md"
  if (-not (Test-Path $reportPath)) {
    $fallbackReport = Get-ChildItem -Path $OutputDir -Filter "real-estate-quarterly-report-*.md" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $fallbackReport) {
      throw "Quarterly report artifact not found in $OutputDir"
    }
    $reportPath = $fallbackReport.FullName
  }

  $memoryHandoff = [pscustomobject]@{
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    runId = $runId
    runType = "quarterly_cadence"
    artifacts = [pscustomobject]@{
      quarter = $quarterSlug
      contextPath = if (Test-Path $latestContextPath) { (Resolve-Path $latestContextPath).Path } else { $latestContextPath }
      reportPath = (Resolve-Path $reportPath).Path
      historyCsvPath = Join-Path $OutputDir "market-watch-history.csv"
      latestMarketWatch = if (Get-ChildItem -Path $OutputDir -Filter "market-watch-*.json" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1) { 
        ((Get-ChildItem -Path $OutputDir -Filter "market-watch-*.json" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName)
      } else {
        $null
      }
    }
    memoryIngress = [pscustomobject]@{
      version = "real-estate-quarterly-swarm-memory-v1"
      qoqTrend = $contextDoc.qoqTrend
      baselineNotes = $contextDoc.baselineNotes
      topCandidateCount = @($contextDoc.topCandidates).Count
      latestSnapshot = $contextDoc.latestSnapshot
      quarterSummaries = @($contextDoc.quarterSummaries)
    }
  }

  $memoryHandoffPath = Join-Path $OutputDir "quarterly-context-memory-$runId.json"
  $memoryHandoffLatestPath = Join-Path $OutputDir "quarterly-context-memory-latest.json"
  $memoryHandoff | ConvertTo-Json -Depth 12 | Set-Content -Path $memoryHandoffPath -Encoding UTF8
  $memoryHandoff | ConvertTo-Json -Depth 12 | Set-Content -Path $memoryHandoffLatestPath -Encoding UTF8

  Add-StepResult -Name "prepare_memory_handoff" -Status "ok" -DurationSec (((Get-Date) - $handoffStart).TotalSeconds) -Error ""
} catch {
  Add-StepResult -Name "prepare_memory_handoff" -Status "error" -DurationSec (((Get-Date) - $handoffStart).TotalSeconds) -Error ([string]$_.Exception.Message)
  throw
}

$status = if ((@($script:Steps | Where-Object { $_.status -eq "error" })).Count -gt 0) { "error" } else { "ok" }
$manifest = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  status = $status
  outputDir = $OutputDir
  inputDir = $InputDir
  contextLookbackRuns = $ContextLookbackRuns
  topCandidates = $TopCandidates
  outputs = [pscustomobject]@{
    marketWatchHistoryCsvPath = Join-Path $OutputDir "market-watch-history.csv"
    contextPath = Join-Path $OutputDir "agent-swarm-context-latest.json"
    memoryHandoffPath = Join-Path $OutputDir "quarterly-context-memory-latest.json"
    reportPath = Join-Path $OutputDir "real-estate-quarterly-report-latest.md"
  }
  steps = $script:Steps
}

$manifestPath = Join-Path $OutputDir "quarterly-cadence-$runId.json"
$manifestLatestPath = Join-Path $OutputDir "quarterly-cadence-latest.json"

$manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $manifestPath -Encoding UTF8
$manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $manifestLatestPath -Encoding UTF8

Write-Host "Wrote $manifestPath"
Write-Host "Wrote $manifestLatestPath"
Write-Host "Wrote $((Join-Path $OutputDir "quarterly-context-memory-$runId.json"))"
Write-Host "Wrote $((Join-Path $OutputDir "quarterly-context-memory-latest.json"))"
Write-Host "Wrote $(Join-Path $OutputDir "agent-swarm-context-latest.json")"

if ($status -eq "error") {
  throw "Real-estate quarterly cadence failed. See $manifestLatestPath"
}
