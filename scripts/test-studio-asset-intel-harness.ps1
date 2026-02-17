<#
.SYNOPSIS
Deterministic harness tests for studio asset intelligence behavior.

.DESCRIPTION
Runs two focused checks against `run-studio-asset-intelligence.ps1`:
1) Manual-drop prioritization: verifies needed/wanted boost is applied.
2) Carry-forward continuity: verifies prior results are reused when live/local
   input is empty and carry-forward is enabled.
#>
param(
  [string]$ConfigPath = "docs/real-estate/studio-asset-intel-config.json",
  [string]$PriorityListPath = "docs/real-estate/studio-needed-wanted-list.json",
  [string]$HarnessRoot = "output/real-estate/test-harness/studio-assets"
)

$ErrorActionPreference = "Stop"

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Get-LatestJson {
  param([string]$Path)
  Assert-True -Condition (Test-Path $Path) -Message "Missing file: $Path"
  return (Get-Content -Raw $Path | ConvertFrom-Json)
}

if (-not (Test-Path $ConfigPath)) { throw "Missing config: $ConfigPath" }
if (-not (Test-Path $PriorityListPath)) { throw "Missing priority list: $PriorityListPath" }

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$runRoot = Join-Path $HarnessRoot $runId
$manualSeedDir = Join-Path $runRoot "manual-seed"
$autoSeedDir = Join-Path $runRoot "auto-seed"
$manualEmptyDir = Join-Path $runRoot "manual-empty"
$autoEmptyDir = Join-Path $runRoot "auto-empty"
New-Item -ItemType Directory -Path $manualSeedDir -Force | Out-Null
New-Item -ItemType Directory -Path $autoSeedDir -Force | Out-Null
New-Item -ItemType Directory -Path $manualEmptyDir -Force | Out-Null
New-Item -ItemType Directory -Path $autoEmptyDir -Force | Out-Null

$manualCsv = Join-Path $manualSeedDir "_all-sources.csv"
@"
title,url,summary,publishedAt,city,sourceQuery,notes,condition,price,location,sourceKey,sourceName,sourceType
Thick IFB firebrick lot,https://example.local/firebrick-lot,"insulating firebrick IFB + hard brick + kiln shell parts",2026-02-17T00:00:00Z,Phoenix,manual:asset_test,"pickup only; reduction kiln materials",used,900,phoenix,facebook_marketplace,Facebook Marketplace,community_marketplace
Used Skutt kiln,https://example.local/skutt-kiln,"skutt electric kiln tested working pickup only",2026-02-17T00:00:00Z,Goodyear,manual:asset_test,"local pickup",used,1800,goodyear,craigslist_phoenix,Craigslist Phoenix,local_marketplace
"@ | Set-Content -Path $manualCsv -Encoding UTF8

$assetScript = Join-Path $PSScriptRoot "run-studio-asset-intelligence.ps1"
Assert-True -Condition (Test-Path $assetScript) -Message "Missing script: $assetScript"

# Pass 1: seeded manual data should produce ranked results + needed/wanted boosts.
& $assetScript `
  -ConfigPath $ConfigPath `
  -PriorityListPath $PriorityListPath `
  -OutputDir $runRoot `
  -AutoFeedDir $autoSeedDir `
  -ManualDropDir $manualSeedDir `
  -MaxResultsPerQuery 0 `
  -Top 10 `
  -MinScore 10 `
  -EnableCarryForward:$true

$latestPath = Join-Path $runRoot "studio-asset-intelligence-latest.json"
$first = Get-LatestJson -Path $latestPath
Assert-True -Condition ([int]$first.summary.topReturned -ge 1) -Message "Expected at least one ranked asset in seeded pass."
Assert-True -Condition ([int]$first.summary.neededWantedBoostedAssets -ge 1) -Message "Expected needed/wanted boost to apply in seeded pass."

$neededWantedMatches = @()
foreach ($asset in @($first.topAssets)) {
  if ($null -ne $asset.evidence -and $null -ne $asset.evidence.neededWantedMatches) {
    $neededWantedMatches += @($asset.evidence.neededWantedMatches)
  }
}
Assert-True -Condition ((@($neededWantedMatches | Where-Object { [string]$_.id -eq "firebrick-and-reduction-build-materials" })).Count -ge 1) -Message "Expected firebrick/reduction needed-wanted priority match."

# Pass 2: empty inputs should carry forward previous pass.
& $assetScript `
  -ConfigPath $ConfigPath `
  -PriorityListPath $PriorityListPath `
  -OutputDir $runRoot `
  -AutoFeedDir $autoEmptyDir `
  -ManualDropDir $manualEmptyDir `
  -MaxResultsPerQuery 0 `
  -Top 10 `
  -MinScore 10 `
  -EnableCarryForward:$true

$second = Get-LatestJson -Path $latestPath
Assert-True -Condition ([bool]$second.summary.carryForwardUsed) -Message "Expected carry-forward to be used on empty-input pass."
Assert-True -Condition ([int]$second.summary.topReturned -ge 1) -Message "Expected carried-forward assets in empty-input pass."
Assert-True -Condition ((@($second.topAssets | Where-Object { [bool]$_.isCarryForward })).Count -ge 1) -Message "Expected top assets to be marked as carry-forward."

Write-Host "Studio asset harness passed:"
Write-Host (" - runRoot: {0}" -f $runRoot)
Write-Host (" - firstPassTop: {0}" -f $first.summary.topReturned)
Write-Host (" - secondPassTop: {0}" -f $second.summary.topReturned)

