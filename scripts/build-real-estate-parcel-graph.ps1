param(
  [string]$OutputDir = "output/real-estate",
  [string]$PublicSignalsPath = "output/real-estate/public-signals-latest.json",
  [int]$TopParcels = 50
)

$ErrorActionPreference = "Stop"

function Normalize-TextKey {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
  return ([regex]::Replace($Text.ToLowerInvariant(), "[^a-z0-9]+", "")).Trim()
}

function Normalize-ParcelKey {
  param([string]$ParcelId)
  if ([string]::IsNullOrWhiteSpace($ParcelId)) { return "" }
  return ([regex]::Replace($ParcelId.ToUpperInvariant(), "[^A-Z0-9]+", "")).Trim()
}

function Build-Markdown {
  param([pscustomobject]$Graph)

  $lines = @()
  $lines += "# Real Estate Parcel Graph Snapshot"
  $lines += ""
  $lines += "- generatedAtUtc: $($Graph.generatedAtUtc)"
  $lines += "- parcelCount: $($Graph.summary.parcelCount)"
  $lines += "- ownerCount: $($Graph.summary.ownerCount)"
  $lines += "- signalCount: $($Graph.summary.signalCount)"
  $lines += "- highPriorityParcelCount: $($Graph.summary.highPriorityParcelCount)"
  $lines += ""
  $lines += "## Top Parcels"
  $lines += ""
  $lines += "| Score | Priority | Parcel | City | Owner Count | Signal Count | Distress Types |"
  $lines += "| ---: | --- | --- | --- | ---: | ---: | --- |"
  foreach ($parcel in $Graph.topParcels) {
    $distressTypes = ($parcel.distressTypes -join ", ")
    $lines += "| $($parcel.parcelOpportunityScore) | $($parcel.priority) | $($parcel.parcelId) | $($parcel.city) | $($parcel.ownerCount) | $($parcel.signalCount) | $distressTypes |"
  }

  $lines += ""
  $lines += "## Next Actions"
  $lines += ""
  foreach ($action in $Graph.nextActions) {
    $lines += "- $action"
  }

  return ($lines -join "`n") + "`n"
}

$signalsDoc = $null
if (Test-Path $PublicSignalsPath) {
  $signalsDoc = Get-Content -Raw $PublicSignalsPath | ConvertFrom-Json
}

$signals = @()
if ($null -ne $signalsDoc -and $null -ne $signalsDoc.signals) {
  $signals = @($signalsDoc.signals)
}

$parcelIndex = @{}
$ownerIndex = @{}

foreach ($signal in $signals) {
  $parcelId = [string]$signal.parcelId
  $parcelKey = Normalize-ParcelKey $parcelId
  $ownerName = [string]$signal.ownerName
  $ownerKey = Normalize-TextKey $ownerName

  if ([string]::IsNullOrWhiteSpace($parcelKey)) {
    continue
  }

  if (-not $parcelIndex.ContainsKey($parcelKey)) {
    $parcelIndex[$parcelKey] = [ordered]@{
      parcelKey = $parcelKey
      parcelId = $parcelId
      city = [string]$signal.city
      state = [string]$signal.state
      postalCode = [string]$signal.postalCode
      addresses = New-Object System.Collections.Generic.HashSet[string]
      owners = New-Object System.Collections.Generic.HashSet[string]
      signalTypes = New-Object System.Collections.Generic.HashSet[string]
      sourceKeys = New-Object System.Collections.Generic.HashSet[string]
      maxSignalScore = 0
      totalSignalScore = 0
      signalCount = 0
      lastEventDate = ""
    }
  }

  $parcelNode = $parcelIndex[$parcelKey]
  if (-not [string]::IsNullOrWhiteSpace([string]$signal.address)) {
    [void]$parcelNode.addresses.Add([string]$signal.address)
  }
  if (-not [string]::IsNullOrWhiteSpace($ownerName)) {
    [void]$parcelNode.owners.Add($ownerName)
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$signal.signalType)) {
    [void]$parcelNode.signalTypes.Add([string]$signal.signalType)
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$signal.sourceKey)) {
    [void]$parcelNode.sourceKeys.Add([string]$signal.sourceKey)
  }

  $score = 0
  try {
    $score = [int]$signal.signalScore
  } catch {
    $score = 0
  }

  $parcelNode.signalCount += 1
  $parcelNode.totalSignalScore += $score
  if ($score -gt $parcelNode.maxSignalScore) {
    $parcelNode.maxSignalScore = $score
  }

  $eventDate = [string]$signal.eventDate
  if (-not [string]::IsNullOrWhiteSpace($eventDate)) {
    if ([string]::IsNullOrWhiteSpace($parcelNode.lastEventDate) -or ([datetime]$eventDate -gt [datetime]$parcelNode.lastEventDate)) {
      $parcelNode.lastEventDate = $eventDate
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($ownerKey)) {
    if (-not $ownerIndex.ContainsKey($ownerKey)) {
      $ownerIndex[$ownerKey] = [ordered]@{
        ownerKey = $ownerKey
        ownerName = $ownerName
        parcelKeys = New-Object System.Collections.Generic.HashSet[string]
        signalCount = 0
        totalSignalScore = 0
      }
    }

    $ownerNode = $ownerIndex[$ownerKey]
    [void]$ownerNode.parcelKeys.Add($parcelKey)
    $ownerNode.signalCount += 1
    $ownerNode.totalSignalScore += $score
  }
}

$parcels = @()
foreach ($entry in $parcelIndex.GetEnumerator()) {
  $node = $entry.Value
  $opportunityScore = [int]([math]::Round(($node.maxSignalScore * 0.6) + (($node.totalSignalScore / [math]::Max(1, $node.signalCount)) * 0.4), 0))
  $priority = if ($opportunityScore -ge 55) {
    "high"
  } elseif ($opportunityScore -ge 35) {
    "medium"
  } else {
    "low"
  }

  $parcels += [pscustomobject]@{
    parcelKey = $node.parcelKey
    parcelId = $node.parcelId
    city = $node.city
    state = $node.state
    postalCode = $node.postalCode
    addresses = @($node.addresses | Sort-Object)
    owners = @($node.owners | Sort-Object)
    distressTypes = @($node.signalTypes | Sort-Object)
    sourceKeys = @($node.sourceKeys | Sort-Object)
    ownerCount = $node.owners.Count
    signalCount = $node.signalCount
    maxSignalScore = $node.maxSignalScore
    avgSignalScore = [math]::Round(($node.totalSignalScore / [math]::Max(1, $node.signalCount)), 2)
    parcelOpportunityScore = $opportunityScore
    priority = $priority
    lastEventDate = $node.lastEventDate
  }
}

$owners = @()
foreach ($entry in $ownerIndex.GetEnumerator()) {
  $owner = $entry.Value
  $owners += [pscustomobject]@{
    ownerKey = $owner.ownerKey
    ownerName = $owner.ownerName
    parcelKeys = @($owner.parcelKeys | Sort-Object)
    parcelCount = $owner.parcelKeys.Count
    signalCount = $owner.signalCount
    avgSignalScore = [math]::Round(($owner.totalSignalScore / [math]::Max(1, $owner.signalCount)), 2)
  }
}

$topParcelRows = @(
  $parcels |
    Sort-Object @{ Expression = { $_.parcelOpportunityScore }; Descending = $true }, @{ Expression = { $_.signalCount }; Descending = $true } |
    Select-Object -First $TopParcels
)

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$graph = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  inputs = [pscustomobject]@{
    publicSignalsPath = if (Test-Path $PublicSignalsPath) { (Resolve-Path $PublicSignalsPath).Path } else { $PublicSignalsPath }
  }
  summary = [pscustomobject]@{
    parcelCount = $parcels.Count
    ownerCount = $owners.Count
    signalCount = $signals.Count
    highPriorityParcelCount = (@($parcels | Where-Object { $_.priority -eq "high" })).Count
    mediumPriorityParcelCount = (@($parcels | Where-Object { $_.priority -eq "medium" })).Count
    lowPriorityParcelCount = (@($parcels | Where-Object { $_.priority -eq "low" })).Count
  }
  topParcels = $topParcelRows
  parcels = $parcels
  owners = $owners
  nextActions = @(
    "Enrich top parcels with assessor timeline and ownership transfer history.",
    "Run title/encumbrance checks on high-priority parcels before broker outreach.",
    "Overlay utility capacity and permitting constraints for buildout viability.",
    "Publish parcel IDs + owner entities into swarm context for targeted outreach sequencing."
  )
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$jsonPath = Join-Path $OutputDir "parcel-graph-$runId.json"
$mdPath = Join-Path $OutputDir "parcel-graph-$runId.md"
$latestJsonPath = Join-Path $OutputDir "parcel-graph-latest.json"
$latestMdPath = Join-Path $OutputDir "parcel-graph-latest.md"

$graph | ConvertTo-Json -Depth 12 | Set-Content -Path $jsonPath -Encoding UTF8
$graph | ConvertTo-Json -Depth 12 | Set-Content -Path $latestJsonPath -Encoding UTF8
$markdown = Build-Markdown -Graph $graph
$markdown | Set-Content -Path $mdPath -Encoding UTF8
$markdown | Set-Content -Path $latestMdPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $mdPath"
Write-Host "Wrote $latestJsonPath"
Write-Host "Wrote $latestMdPath"
