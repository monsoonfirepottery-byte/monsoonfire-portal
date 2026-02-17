<#
.SYNOPSIS
Creates manual-drop CSV templates for studio asset intelligence sources.

.DESCRIPTION
Ensures per-source CSV templates exist in the manual-drop directory so humans
can paste/export listings from channels that do not provide reliable API/RSS
access (for example Meta Marketplace and private/local feeds).

.OUTPUTS
output/real-estate/manual-drops/studio-assets/<source-key>.csv
output/real-estate/manual-drops/studio-assets/_all-sources.csv
output/real-estate/manual-drops/studio-assets/seed-manifest-<timestamp>.json
output/real-estate/manual-drops/studio-assets/seed-manifest-latest.json
#>
param(
  [string]$ConfigPath = "docs/real-estate/studio-asset-intel-config.json",
  [string]$ManualDropDir = "output/real-estate/manual-drops/studio-assets"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ConfigPath)) {
  throw "Asset intelligence config not found: $ConfigPath"
}

$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$sources = @($config.sources)
if ($sources.Count -eq 0) {
  throw "No sources configured in $ConfigPath"
}

New-Item -ItemType Directory -Path $ManualDropDir -Force | Out-Null

$header = "title,url,summary,publishedAt,city,sourceQuery,notes,condition,price,location"
$seeded = @()
$skipped = @()

foreach ($source in $sources) {
  $key = [string]$source.key
  if ([string]::IsNullOrWhiteSpace($key)) { continue }
  $path = Join-Path $ManualDropDir "$key.csv"
  if (Test-Path $path) {
    $skipped += $path
    continue
  }
  Set-Content -Path $path -Value $header -Encoding UTF8
  $seeded += $path
}

$allSourcesPath = Join-Path $ManualDropDir "_all-sources.csv"
if (-not (Test-Path $allSourcesPath)) {
  Set-Content -Path $allSourcesPath -Value ($header + ",sourceKey,sourceName,sourceType") -Encoding UTF8
  $seeded += $allSourcesPath
} else {
  $skipped += $allSourcesPath
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$manifest = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  configPath = (Resolve-Path $ConfigPath).Path
  manualDropDir = (Resolve-Path $ManualDropDir).Path
  summary = [pscustomobject]@{
    configuredSources = $sources.Count
    seeded = $seeded.Count
    skipped = $skipped.Count
  }
  seededFiles = $seeded
  skippedFiles = $skipped
}

$manifestPath = Join-Path $ManualDropDir "seed-manifest-$runId.json"
$latestPath = Join-Path $ManualDropDir "seed-manifest-latest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $manifestPath -Encoding UTF8
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $latestPath -Encoding UTF8

Write-Host "Wrote $manifestPath"
Write-Host "Wrote $latestPath"

