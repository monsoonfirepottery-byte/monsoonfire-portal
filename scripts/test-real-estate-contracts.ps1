<#
.SYNOPSIS
Validates latest real-estate intelligence output contracts.

.DESCRIPTION
Performs fast contract checks against `*-latest.json` artifacts to ensure
critical files and expected top-level fields exist for downstream agents.

This is a schema/contract smoke test (not deep business-logic verification).
#>
param(
  [string]$OutputDir = "output/real-estate"
)

$ErrorActionPreference = "Stop"

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Get-Json {
  param([string]$Path)
  Assert-True -Condition (Test-Path $Path) -Message "Missing required file: $Path"
  try {
    return Get-Content -Raw $Path | ConvertFrom-Json
  } catch {
    throw "Invalid JSON at ${Path}: $($_.Exception.Message)"
  }
}

function Assert-HasProp {
  param(
    [object]$Object,
    [string]$PropPath,
    [string]$Label
  )
  $current = $Object
  foreach ($segment in ($PropPath -split "\.")) {
    if ($null -eq $current) {
      throw "Missing property ($Label): $PropPath"
    }
    $prop = $current.PSObject.Properties[$segment]
    if ($null -eq $prop) {
      throw "Missing property ($Label): $PropPath"
    }
    $current = $prop.Value
  }
}

$paths = [ordered]@{
  weekly = Join-Path $OutputDir "weekly-cadence-latest.json"
  publicSignals = Join-Path $OutputDir "public-signals-latest.json"
  assetIntel = Join-Path $OutputDir "studio-asset-intelligence-latest.json"
  assetWatchlist = Join-Path $OutputDir "studio-asset-watchlist-latest.json"
  opportunityResearch = Join-Path $OutputDir "opportunity-research-latest.json"
  needs = Join-Path $OutputDir "needs-context-latest.json"
  intelligence = Join-Path $OutputDir "intelligence-analysis-latest.json"
  review = Join-Path $OutputDir "intelligence-review-packet-latest.json"
  taskQueue = Join-Path $OutputDir "intelligence-task-queue-latest.json"
  steeringLog = Join-Path $OutputDir "intelligence-steering-log-latest.json"
}

$weekly = Get-Json -Path $paths.weekly
Assert-HasProp -Object $weekly -PropPath "runId" -Label "weekly"
Assert-HasProp -Object $weekly -PropPath "status" -Label "weekly"
Assert-HasProp -Object $weekly -PropPath "steps" -Label "weekly"
Assert-True -Condition ((@($weekly.steps)).Count -gt 0) -Message "weekly.steps is empty"

$publicSignals = Get-Json -Path $paths.publicSignals
Assert-HasProp -Object $publicSignals -PropPath "summary.totalSignals" -Label "publicSignals"
Assert-HasProp -Object $publicSignals -PropPath "summary.promptInjectionScanned" -Label "publicSignals"

$assetIntel = Get-Json -Path $paths.assetIntel
Assert-HasProp -Object $assetIntel -PropPath "summary.topReturned" -Label "assetIntel"
Assert-HasProp -Object $assetIntel -PropPath "summary.channelMix" -Label "assetIntel"
Assert-HasProp -Object $assetIntel -PropPath "watchlist.taskQueue" -Label "assetIntel"
Assert-HasProp -Object $assetIntel -PropPath "neededWantedContext.consumables" -Label "assetIntel"

$assetWatchlist = Get-Json -Path $paths.assetWatchlist
Assert-HasProp -Object $assetWatchlist -PropPath "assetCount" -Label "assetWatchlist"
Assert-HasProp -Object $assetWatchlist -PropPath "taskQueue" -Label "assetWatchlist"

$opportunityResearch = Get-Json -Path $paths.opportunityResearch
Assert-HasProp -Object $opportunityResearch -PropPath "summary.totalOpportunities" -Label "opportunityResearch"
Assert-HasProp -Object $opportunityResearch -PropPath "dataPolicy.defaultTrustLevel" -Label "opportunityResearch"
Assert-HasProp -Object $opportunityResearch -PropPath "topOpportunities" -Label "opportunityResearch"
Assert-HasProp -Object $opportunityResearch -PropPath "followUpQueue" -Label "opportunityResearch"

$needs = Get-Json -Path $paths.needs
Assert-HasProp -Object $needs -PropPath "summary.activeProfileId" -Label "needs"
Assert-HasProp -Object $needs -PropPath "summary.recommendedProfileId" -Label "needs"

$intelligence = Get-Json -Path $paths.intelligence
Assert-HasProp -Object $intelligence -PropPath "summary.marketRegime" -Label "intelligence"
Assert-HasProp -Object $intelligence -PropPath "topOpportunities" -Label "intelligence"
Assert-HasProp -Object $intelligence -PropPath "taskQueue" -Label "intelligence"

$review = Get-Json -Path $paths.review
Assert-HasProp -Object $review -PropPath "opportunities" -Label "review"
Assert-HasProp -Object $review -PropPath "humanActions" -Label "review"
Assert-HasProp -Object $review -PropPath "steeringContract.sinkPath" -Label "review"

$taskQueue = Get-Json -Path $paths.taskQueue
Assert-HasProp -Object $taskQueue -PropPath "tasks" -Label "taskQueue"

$steering = Get-Json -Path $paths.steeringLog
Assert-HasProp -Object $steering -PropPath "totalEntries" -Label "steeringLog"
Assert-HasProp -Object $steering -PropPath "recent" -Label "steeringLog"

Write-Host "Contract validation passed:"
foreach ($kvp in $paths.GetEnumerator()) {
  Write-Host (" - {0}: {1}" -f $kvp.Key, $kvp.Value)
}

