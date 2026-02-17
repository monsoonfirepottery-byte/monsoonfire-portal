<#
.SYNOPSIS
Runs the full real-estate intelligence pipeline end-to-end on a weekly cadence.

.DESCRIPTION
Executes deterministic stages in sequence:
1) public data pull and staging
2) structured signal scoring and guardrails
3) macro + parcel context builds
4) agentic lead scan
5) skepticism-first opportunity research scan
6) studio needs context derivation
7) intelligence analysis and task queue generation
8) human review packet generation

Produces a machine-readable manifest with per-step status and duration.

.OUTPUTS
output/real-estate/weekly-cadence-<timestamp>.json
output/real-estate/weekly-cadence-latest.json
#>
param(
  [string]$OutputDir = "output/real-estate",
  [string]$PublicDataDir = "output/real-estate/public-data",
  [string]$StagingDir = "output/real-estate/staging/public-signals",
  [string]$ManualDropDir = "output/real-estate/manual-drops"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$startUtc = (Get-Date).ToUniversalTime().ToString("o")

$steps = @(
  @{ name = "fetch_public_data"; cmd = "pwsh -File scripts/fetch-real-estate-public-data.ps1 -OutDir `"$PublicDataDir`"" },
  @{ name = "seed_manual_drops"; cmd = "pwsh -File scripts/seed-real-estate-manual-drops.ps1 -ManualDropDir `"$ManualDropDir`"" },
  @{ name = "build_staging"; cmd = "pwsh -File scripts/build-real-estate-public-signal-staging.ps1 -PublicDataManifestPath `"$PublicDataDir/latest-manifest.json`" -StagingDir `"$StagingDir`" -ManualDropDir `"$ManualDropDir`"" },
  @{ name = "run_recorder_fallback_adapter"; cmd = "pwsh -File scripts/run-recorder-fallback-adapter.ps1 -ManualDir `"$ManualDropDir/recorder-fallback`" -StagingDir `"$StagingDir`" -OutputDir `"$OutputDir`"" },
  @{ name = "run_public_signals"; cmd = "pwsh -File scripts/run-real-estate-public-signals.ps1 -ConfigPath `"docs/real-estate/public-signal-sources.json`" -OutputDir `"$OutputDir`" -AutoStagingDir `"$StagingDir`" -ManualDropDir `"$ManualDropDir`"" },
  @{ name = "build_macro_context"; cmd = "pwsh -File scripts/build-real-estate-macro-context.ps1 -PublicDataManifestPath `"$PublicDataDir/latest-manifest.json`" -OutputDir `"$OutputDir`"" },
  @{ name = "build_parcel_graph"; cmd = "pwsh -File scripts/build-real-estate-parcel-graph.ps1 -PublicSignalsPath `"$OutputDir/public-signals-latest.json`" -OutputDir `"$OutputDir`"" },
  @{ name = "build_entity_resolution"; cmd = "pwsh -File scripts/build-real-estate-entity-resolution.ps1 -PublicSignalsPath `"$OutputDir/public-signals-latest.json`" -ParcelGraphPath `"$OutputDir/parcel-graph-latest.json`" -OutputDir `"$OutputDir`"" },
  @{ name = "run_agentic_research"; cmd = "pwsh -File scripts/run-real-estate-agentic-research.ps1 -OutputDir `"$OutputDir`" -PublicSignalsPath `"$OutputDir/public-signals-latest.json`" -MacroContextPath `"$OutputDir/macro-context-latest.json`"" },
  @{ name = "run_opportunity_research"; cmd = "pwsh -File scripts/run-real-estate-opportunity-research.ps1 -OutputDir `"$OutputDir`" -ConfigPath `"docs/real-estate/opportunity-research-config.json`" -PublicSignalsPath `"$OutputDir/public-signals-latest.json`" -AgenticResearchPath `"$OutputDir/agentic-research-latest.json`" -PublicDataManifestPath `"$PublicDataDir/latest-manifest.json`" -MacroContextPath `"$OutputDir/macro-context-latest.json`"" },
  @{ name = "seed_studio_asset_manual_drops"; cmd = "pwsh -File scripts/seed-studio-asset-manual-drops.ps1 -ConfigPath `"docs/real-estate/studio-asset-intel-config.json`" -ManualDropDir `"$ManualDropDir/studio-assets`"" },
  @{ name = "fetch_studio_asset_community_data"; cmd = "pwsh -File scripts/fetch-studio-asset-community-data.ps1 -ConfigPath `"docs/real-estate/studio-asset-intel-config.json`" -OutDir `"$OutputDir/asset-community-data`" -StagingDir `"$OutputDir/staging/studio-assets`"" },
  @{ name = "run_studio_asset_intelligence"; cmd = "pwsh -File scripts/run-studio-asset-intelligence.ps1 -ConfigPath `"docs/real-estate/studio-asset-intel-config.json`" -PriorityListPath `"docs/real-estate/studio-needed-wanted-list.json`" -OutputDir `"$OutputDir`" -AutoFeedDir `"$OutputDir/staging/studio-assets`" -ManualDropDir `"$ManualDropDir/studio-assets`"" },
  @{ name = "build_needs_context"; cmd = "pwsh -File scripts/build-real-estate-needs-context.ps1 -NeedsProfilePath `"docs/real-estate/studio-needs-profile.json`" -OutputDir `"$OutputDir`" -PublicSignalsPath `"$OutputDir/public-signals-latest.json`"" },
  @{ name = "run_intelligence_analysis"; cmd = "pwsh -File scripts/run-real-estate-intelligence-analysis.ps1 -OutputDir `"$OutputDir`" -PublicSignalsPath `"$OutputDir/public-signals-latest.json`" -ParcelGraphPath `"$OutputDir/parcel-graph-latest.json`" -MacroContextPath `"$OutputDir/macro-context-latest.json`" -NeedsContextPath `"$OutputDir/needs-context-latest.json`" -WeightsPath `"docs/real-estate/intelligence-weights.json`"" },
  @{ name = "build_review_packet"; cmd = "pwsh -File scripts/run-real-estate-review-packet.ps1 -OutputDir `"$OutputDir`" -IntelligencePath `"$OutputDir/intelligence-analysis-latest.json`" -NeedsContextPath `"$OutputDir/needs-context-latest.json`"" },
  @{ name = "build_studiobrain_coordinator_adapters"; cmd = "pwsh -File scripts/build-studiobrain-coordinator-adapters.ps1 -OutputDir `"$OutputDir`" -ReviewPacketPath `"$OutputDir/intelligence-review-packet-latest.json`" -IntelligencePath `"$OutputDir/intelligence-analysis-latest.json`" -AssetWatchlistPath `"$OutputDir/studio-asset-watchlist-latest.json`"" }
)

$results = @()
foreach ($step in $steps) {
  $stepStart = Get-Date
  try {
    Invoke-Expression ([string]$step.cmd)
    $results += [pscustomobject]@{
      name = [string]$step.name
      status = "ok"
      startedAtUtc = $stepStart.ToUniversalTime().ToString("o")
      durationSec = [math]::Round(((Get-Date) - $stepStart).TotalSeconds, 2)
      error = ""
    }
  } catch {
    $results += [pscustomobject]@{
      name = [string]$step.name
      status = "error"
      startedAtUtc = $stepStart.ToUniversalTime().ToString("o")
      durationSec = [math]::Round(((Get-Date) - $stepStart).TotalSeconds, 2)
      error = [string]$_.Exception.Message
    }
    break
  }
}

$manifest = [pscustomobject]@{
  runId = $runId
  startedAtUtc = $startUtc
  finishedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  status = if ((@($results | Where-Object { $_.status -eq "error" })).Count -gt 0) { "error" } else { "ok" }
  outputDir = $OutputDir
  publicDataDir = $PublicDataDir
  stagingDir = $StagingDir
  manualDropDir = $ManualDropDir
  steps = $results
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$jsonPath = Join-Path $OutputDir "weekly-cadence-$runId.json"
$latestPath = Join-Path $OutputDir "weekly-cadence-latest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $jsonPath -Encoding UTF8
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $latestPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $latestPath"
