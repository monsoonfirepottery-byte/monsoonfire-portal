<#
.SYNOPSIS
Build parcel/entity resolution enrichment from structured public signals.

.DESCRIPTION
Normalizes owner entities (including LLC-style names), links signals to parcel
graph records when possible, and emits linkage confidence scores for swarm use.

.OUTPUTS
output/real-estate/entity-resolution-<timestamp>.json
output/real-estate/entity-resolution-<timestamp>.md
output/real-estate/entity-resolution-latest.json
output/real-estate/entity-resolution-latest.md
#>
param(
  [string]$PublicSignalsPath = "output/real-estate/public-signals-latest.json",
  [string]$ParcelGraphPath = "output/real-estate/parcel-graph-latest.json",
  [string]$OutputDir = "output/real-estate",
  [int]$Top = 200
)

$ErrorActionPreference = "Stop"

function Normalize-OwnerName {
  param([string]$Owner)
  if ([string]::IsNullOrWhiteSpace($Owner)) { return "" }
  $s = $Owner.ToUpperInvariant()
  $s = [regex]::Replace($s, "[^A-Z0-9\s]", " ")
  $tokens = @($s -split "\s+" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $drop = @(
    "LLC", "L", "L", "C", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY",
    "LP", "LTD", "TRUST", "HOLDINGS", "GROUP", "PROPERTIES", "PROPERTY", "INVESTMENTS",
    "ENTERPRISES", "ENTERPRISE", "PARTNERS", "PARTNERSHIP"
  )
  $kept = @($tokens | Where-Object { $drop -notcontains $_ })
  if ($kept.Count -eq 0) { return ($tokens -join " ") }
  return ($kept -join " ")
}

function Normalize-ParcelKey {
  param([string]$Parcel)
  if ([string]::IsNullOrWhiteSpace($Parcel)) { return "" }
  return ([regex]::Replace($Parcel.ToUpperInvariant(), "[^A-Z0-9]+", "")).Trim()
}

function Build-Markdown {
  param([pscustomobject]$Result)
  $lines = @()
  $lines += "# Real Estate Entity Resolution Run"
  $lines += ""
  $lines += "- generatedAtUtc: $($Result.generatedAtUtc)"
  $lines += "- entities: $($Result.summary.entities)"
  $lines += "- lowConfidenceEntities: $($Result.summary.lowConfidenceEntities)"
  $lines += "- parcelLinkedEntities: $($Result.summary.parcelLinkedEntities)"
  $lines += ""
  $lines += "## Top Entities"
  $lines += ""
  $lines += "| Confidence | Entity Key | Owner Normalized | Parcel Key | Signals | Sources |"
  $lines += "| ---: | --- | --- | --- | ---: | ---: |"
  foreach ($e in $Result.topEntities) {
    $lines += "| $($e.linkageConfidenceScore) | $($e.entityKey) | $($e.ownerNormalized) | $($e.parcelKey) | $($e.signalCount) | $($e.sourceCount) |"
  }
  return ($lines -join "`n") + "`n"
}

if (-not (Test-Path $PublicSignalsPath)) {
  throw "Public signals file not found: $PublicSignalsPath"
}

$signalsDoc = Get-Content -Raw $PublicSignalsPath | ConvertFrom-Json
$signals = @($signalsDoc.signals)

$parcelDoc = $null
if (Test-Path $ParcelGraphPath) {
  try {
    $parcelDoc = Get-Content -Raw $ParcelGraphPath | ConvertFrom-Json
  } catch {
    $parcelDoc = $null
  }
}

$parcelKeys = New-Object System.Collections.Generic.HashSet[string]
if ($null -ne $parcelDoc) {
  foreach ($collectionName in @("parcels", "parcelNodes", "nodes")) {
    $prop = $parcelDoc.PSObject.Properties[$collectionName]
    if ($null -eq $prop -or $null -eq $prop.Value) { continue }
    foreach ($row in @($prop.Value)) {
      foreach ($candidate in @([string]$row.parcelId, [string]$row.parcelKey, [string]$row.parcel)) {
        $k = Normalize-ParcelKey $candidate
        if (-not [string]::IsNullOrWhiteSpace($k)) {
          [void]$parcelKeys.Add($k)
        }
      }
    }
  }
}

$entityMap = @{}
foreach ($signal in $signals) {
  $parcelKey = Normalize-ParcelKey ([string]$signal.parcelId)
  $ownerNorm = Normalize-OwnerName ([string]$signal.ownerName)
  $entityKey = ""
  if (-not [string]::IsNullOrWhiteSpace($parcelKey)) {
    $entityKey = "parcel:$parcelKey"
  } elseif (-not [string]::IsNullOrWhiteSpace($ownerNorm)) {
    $entityKey = "owner:$ownerNorm"
  } else {
    $entityKey = "signal:$([string]$signal.signalId)"
  }

  if (-not $entityMap.ContainsKey($entityKey)) {
    $entityMap[$entityKey] = [pscustomobject]@{
      entityKey = $entityKey
      parcelKey = $parcelKey
      ownerNormalized = $ownerNorm
      signalCount = 0
      sourceKeys = New-Object System.Collections.Generic.HashSet[string]
      sampleSignalScores = New-Object System.Collections.Generic.List[int]
      hasCaseNumber = $false
      hasAddress = $false
      parcelLinked = $false
    }
  }

  $entry = $entityMap[$entityKey]
  $entry.signalCount += 1
  if (-not [string]::IsNullOrWhiteSpace([string]$signal.sourceKey)) {
    [void]$entry.sourceKeys.Add([string]$signal.sourceKey)
  }
  $score = 0
  try { $score = [int]$signal.signalScore } catch { $score = 0 }
  [void]$entry.sampleSignalScores.Add($score)
  if (-not [string]::IsNullOrWhiteSpace([string]$signal.caseNumber)) { $entry.hasCaseNumber = $true }
  if (-not [string]::IsNullOrWhiteSpace([string]$signal.address)) { $entry.hasAddress = $true }
}

$entities = @()
foreach ($kvp in $entityMap.GetEnumerator()) {
  $e = $kvp.Value
  $maxSignalScore = 0
  foreach ($s in @($e.sampleSignalScores)) {
    if ($s -gt $maxSignalScore) { $maxSignalScore = $s }
  }
  $parcelLinked = $false
  if (-not [string]::IsNullOrWhiteSpace([string]$e.parcelKey) -and $parcelKeys.Contains([string]$e.parcelKey)) {
    $parcelLinked = $true
  }

  $confidence = 0
  if ($parcelLinked) { $confidence += 40 }
  if (-not [string]::IsNullOrWhiteSpace([string]$e.ownerNormalized)) { $confidence += 20 }
  if ([bool]$e.hasCaseNumber) { $confidence += 10 }
  if ([bool]$e.hasAddress) { $confidence += 10 }
  $confidence += [math]::Min(20, [int][math]::Floor($maxSignalScore / 4))
  $confidence = [int][math]::Min(100, $confidence)

  $entities += [pscustomobject]@{
    entityKey = [string]$e.entityKey
    parcelKey = [string]$e.parcelKey
    ownerNormalized = [string]$e.ownerNormalized
    signalCount = [int]$e.signalCount
    sourceCount = $e.sourceKeys.Count
    hasCaseNumber = [bool]$e.hasCaseNumber
    hasAddress = [bool]$e.hasAddress
    parcelLinked = $parcelLinked
    linkageConfidenceScore = $confidence
  }
}

$ranked = @(
  $entities |
    Sort-Object @{ Expression = { $_.linkageConfidenceScore }; Descending = $true }, @{ Expression = { $_.signalCount }; Descending = $true } |
    Select-Object -First $Top
)

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$result = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  summary = [pscustomobject]@{
    entities = $entities.Count
    parcelLinkedEntities = (@($entities | Where-Object { $_.parcelLinked })).Count
    lowConfidenceEntities = (@($entities | Where-Object { $_.linkageConfidenceScore -lt 50 })).Count
  }
  inputs = [pscustomobject]@{
    publicSignalsPath = (Resolve-Path $PublicSignalsPath).Path
    parcelGraphPath = if (Test-Path $ParcelGraphPath) { (Resolve-Path $ParcelGraphPath).Path } else { $ParcelGraphPath }
  }
  topEntities = $ranked
  entities = $entities
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$jsonPath = Join-Path $OutputDir "entity-resolution-$runId.json"
$mdPath = Join-Path $OutputDir "entity-resolution-$runId.md"
$latestJsonPath = Join-Path $OutputDir "entity-resolution-latest.json"
$latestMdPath = Join-Path $OutputDir "entity-resolution-latest.md"

$result | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding UTF8
$result | ConvertTo-Json -Depth 10 | Set-Content -Path $latestJsonPath -Encoding UTF8
$md = Build-Markdown -Result $result
$md | Set-Content -Path $mdPath -Encoding UTF8
$md | Set-Content -Path $latestMdPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $mdPath"
Write-Host "Wrote $latestJsonPath"
Write-Host "Wrote $latestMdPath"

