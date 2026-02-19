<#
.SYNOPSIS
Builds channel adapter contracts for StudioBrain coordinator integration.

.DESCRIPTION
Transforms latest intelligence/review/task artifacts into channel-agnostic
command contracts and execution queues for Discord, CLI, and Portal adapters.

.OUTPUTS
output/real-estate/studiobrain-coordinator-<timestamp>.json
output/real-estate/studiobrain-coordinator-latest.json
#>
param(
  [string]$OutputDir = "output/real-estate",
  [string]$ReviewPacketPath = "output/real-estate/intelligence-review-packet-latest.json",
  [string]$IntelligencePath = "output/real-estate/intelligence-analysis-latest.json",
  [string]$AssetWatchlistPath = "output/real-estate/studio-asset-watchlist-latest.json"
)

$ErrorActionPreference = "Stop"

function Get-JsonOrNull {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) { return $null }
  try { return Get-Content -Raw $Path | ConvertFrom-Json } catch { return $null }
}

$review = Get-JsonOrNull -Path $ReviewPacketPath
$intel = Get-JsonOrNull -Path $IntelligencePath
$asset = Get-JsonOrNull -Path $AssetWatchlistPath

$opportunities = @()
if ($null -ne $review -and $null -ne $review.opportunities) {
  $opportunities = @($review.opportunities)
}

$realEstateTasks = @()
if ($null -ne $intel -and $null -ne $intel.taskQueue) {
  $realEstateTasks = @($intel.taskQueue)
}

$assetTasks = @()
if ($null -ne $asset -and $null -ne $asset.taskQueue) {
  $assetTasks = @($asset.taskQueue)
}

$executionQueue = @()
foreach ($task in $realEstateTasks) {
  $executionQueue += [pscustomobject]@{
    queueType = "real_estate"
    taskId = [string]$task.taskId
    priority = [string]$task.priority
    agentRole = [string]$task.agentRole
    objective = [string]$task.objective
    opportunityId = [string]$task.opportunityId
  }
}
foreach ($task in $assetTasks) {
  $executionQueue += [pscustomobject]@{
    queueType = "studio_assets"
    taskId = [string]$task.taskId
    priority = [string]$task.priority
    agentRole = [string]$task.agentRole
    objective = [string]$task.objective
    opportunityId = [string]$task.assetId
  }
}

$commands = [pscustomobject]@{
  discord = @(
    [pscustomobject]@{ command = "/intel review"; description = "Show latest review packet summary." },
    [pscustomobject]@{ command = "/intel opportunity <id>"; description = "Show one opportunity decision card." },
    [pscustomobject]@{ command = "/intel steer <id> <action> <reasonCode>"; description = "Append steering decision." },
    [pscustomobject]@{ command = "/assets watchlist"; description = "Show latest studio asset watchlist." }
  )
  cli = @(
    [pscustomobject]@{ command = "node ./scripts/ps1-run.mjs scripts/run-real-estate-weekly-cadence.ps1"; description = "Run full weekly intelligence cadence." },
    [pscustomobject]@{ command = "node ./scripts/ps1-run.mjs scripts/run-real-estate-test-suite.ps1"; description = "Run test suite checks." },
    [pscustomobject]@{ command = "node ./scripts/ps1-run.mjs scripts/add-intelligence-steering-entry.ps1 -OpportunityId <id> -Action <action> -ReasonCode <code>"; description = "Log steering action." }
  )
  portal = @(
    [pscustomobject]@{ action = "open_review_packet"; description = "Render latest review cards." },
    [pscustomobject]@{ action = "submit_steering_action"; description = "Persist steering decision contract." },
    [pscustomobject]@{ action = "open_asset_watchlist"; description = "Render local equipment opportunities." }
  )
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$result = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  summary = [pscustomobject]@{
    opportunities = $opportunities.Count
    realEstateTasks = $realEstateTasks.Count
    assetTasks = $assetTasks.Count
    executionQueue = $executionQueue.Count
  }
  inputs = [pscustomobject]@{
    reviewPacketPath = if (Test-Path $ReviewPacketPath) { (Resolve-Path $ReviewPacketPath).Path } else { $ReviewPacketPath }
    intelligencePath = if (Test-Path $IntelligencePath) { (Resolve-Path $IntelligencePath).Path } else { $IntelligencePath }
    assetWatchlistPath = if (Test-Path $AssetWatchlistPath) { (Resolve-Path $AssetWatchlistPath).Path } else { $AssetWatchlistPath }
  }
  commandContracts = $commands
  executionQueue = $executionQueue
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$jsonPath = Join-Path $OutputDir "studiobrain-coordinator-$runId.json"
$latestPath = Join-Path $OutputDir "studiobrain-coordinator-latest.json"
$result | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding UTF8
$result | ConvertTo-Json -Depth 10 | Set-Content -Path $latestPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $latestPath"
