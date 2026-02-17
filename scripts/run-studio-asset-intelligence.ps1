<#
.SYNOPSIS
Runs location-first studio asset intelligence for pottery equipment opportunities.

.DESCRIPTION
Searches local/community/institutional channels for heavy, shipping-sensitive
pottery assets where local availability matters more than broad demand.
Supports three intake paths:
1) search-index results
2) staged direct-feed CSVs
3) manual-drop CSVs

If live ingestion returns no opportunities, can carry forward recent prior
results to avoid empty watchlists.

.OUTPUTS
output/real-estate/studio-asset-intelligence-<timestamp>.json
output/real-estate/studio-asset-intelligence-<timestamp>.md
output/real-estate/studio-asset-intelligence-latest.json
output/real-estate/studio-asset-watchlist-<timestamp>.json
output/real-estate/studio-asset-watchlist-latest.json
#>
param(
  [string]$ConfigPath = "docs/real-estate/studio-asset-intel-config.json",
  [string]$PriorityListPath = "docs/real-estate/studio-needed-wanted-list.json",
  [string]$OutputDir = "output/real-estate",
  [string]$AutoFeedDir = "output/real-estate/staging/studio-assets",
  [string]$ManualDropDir = "output/real-estate/manual-drops/studio-assets",
  [int]$MaxResultsPerQuery = 20,
  [int]$Top = 30,
  [int]$MinScore = 25,
  [bool]$EnableCarryForward = $true,
  [int]$CarryForwardMaxAgeDays = 21
)

$ErrorActionPreference = "Stop"

function Convert-RssFieldToString {
  param([object]$Value)

  if ($null -eq $Value) { return "" }
  if ($Value -is [string]) { return $Value.Trim() }
  if ($Value -is [System.Xml.XmlNode]) { return ([string]$Value.InnerText).Trim() }

  foreach ($name in @("#text", "InnerText", "href", "Value")) {
    $prop = $Value.PSObject.Properties[$name]
    if ($null -ne $prop -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
      return ([string]$prop.Value).Trim()
    }
  }
  return ([string]$Value).Trim()
}

function Invoke-BingRssSearch {
  param(
    [Parameter(Mandatory = $true)][string]$Query,
    [int]$MaxItems = 20,
    [string]$SourceKey = "",
    [string]$SourceName = "",
    [string]$SourceType = "",
    [string[]]$SourceDomains = @()
  )

  $uri = "https://www.bing.com/search?format=rss&q=$([uri]::EscapeDataString($Query))"
  try {
    $rss = Invoke-RestMethod -Method Get -Uri $uri -TimeoutSec 30
  } catch {
    return @()
  }

  if ($null -eq $rss -or $null -eq $rss.channel -or $null -eq $rss.channel.item) {
    return @()
  }

  $rows = @()
  foreach ($item in @($rss.channel.item | Select-Object -First $MaxItems)) {
    $title = Convert-RssFieldToString $item.title
    $url = Convert-RssFieldToString $item.link
    $summary = Convert-RssFieldToString $item.description
    $published = Convert-RssFieldToString $item.pubDate
    if ([string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($url)) { continue }

    $rows += [pscustomobject]@{
      title = $title
      url = $url
      summary = $summary
      publishedAt = $published
      city = ""
      sourceQuery = $Query
      notes = ""
      sourceKey = $SourceKey
      sourceName = $SourceName
      sourceType = $SourceType
      sourceDomains = @($SourceDomains)
      ingestChannel = "search_index"
    }
  }
  return $rows
}

function Import-LocalAssetCsv {
  param(
    [string]$Path,
    [pscustomobject]$Source,
    [string]$Channel
  )

  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) { return @() }

  $rows = @()
  try {
    $rows = @(Import-Csv -Path $Path)
  } catch {
    return @()
  }

  $items = @()
  foreach ($row in $rows) {
    $title = [string]$row.title
    $url = [string]$row.url
    if ([string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($url)) { continue }

    $items += [pscustomobject]@{
      title = $title
      url = [string]$row.url
      summary = [string]$row.summary
      publishedAt = [string]$row.publishedAt
      city = [string]$row.city
      sourceQuery = if (-not [string]::IsNullOrWhiteSpace([string]$row.sourceQuery)) { [string]$row.sourceQuery } else { "local:$Channel" }
      notes = [string]$row.notes
      sourceKey = if (-not [string]::IsNullOrWhiteSpace([string]$row.sourceKey)) { [string]$row.sourceKey } else { [string]$Source.key }
      sourceName = if (-not [string]::IsNullOrWhiteSpace([string]$row.sourceName)) { [string]$row.sourceName } else { [string]$Source.name }
      sourceType = if (-not [string]::IsNullOrWhiteSpace([string]$row.sourceType)) { [string]$row.sourceType } else { [string]$Source.sourceType }
      sourceDomains = @($Source.domains)
      ingestChannel = $Channel
    }
  }
  return $items
}

function Get-UrlHost {
  param([string]$Url)
  if ([string]::IsNullOrWhiteSpace($Url)) { return "" }
  try {
    return ([uri]$Url).Host.ToLowerInvariant()
  } catch {
    return ""
  }
}

function Test-DomainMatch {
  param(
    [string]$DomainHost,
    [string[]]$Candidates
  )

  if ([string]::IsNullOrWhiteSpace($DomainHost)) { return $false }
  $hostLower = $DomainHost.ToLowerInvariant()
  foreach ($candidate in $Candidates) {
    $cand = ([string]$candidate).ToLowerInvariant()
    if ($hostLower -eq $cand -or $hostLower.EndsWith("." + $cand)) {
      return $true
    }
  }
  return $false
}

function Get-MatchedKeywords {
  param(
    [string]$Text,
    [pscustomobject]$KeywordWeights
  )

  $foundMatches = New-Object System.Collections.Generic.List[object]
  $score = 0
  $lower = if ($null -eq $Text) { "" } else { $Text.ToLowerInvariant() }

  foreach ($prop in $KeywordWeights.PSObject.Properties) {
    $keyword = [string]$prop.Name
    $weight = [int]$prop.Value
    if ($lower -match [regex]::Escape($keyword.ToLowerInvariant())) {
      $score += $weight
      [void]$foundMatches.Add([pscustomobject]@{
        keyword = $keyword
        weight = $weight
      })
    }
  }

  return [pscustomobject]@{
    score = $score
    matches = @($foundMatches.ToArray())
  }
}

function Get-AssetCategory {
  param([string]$Text)
  $lower = if ($null -eq $Text) { "" } else { $Text.ToLowerInvariant() }
  if ($lower -match "kiln") { return "kiln" }
  if ($lower -match "wheel|shimpo|brent") { return "wheel" }
  if ($lower -match "pugmill|clay mixer|mixer") { return "clay_processing" }
  if ($lower -match "slab roller|extruder") { return "forming_tools" }
  if ($lower -match "shelf|furniture|vent|spray booth|compressor") { return "support_equipment" }
  return "general_studio_asset"
}

function Get-Classification {
  param([int]$Score)
  if ($Score -ge 70) { return "high_priority" }
  if ($Score -ge 45) { return "medium_priority" }
  return "watch"
}

function Get-SourceTypeWeight {
  param(
    [string]$SourceType,
    [pscustomobject]$Weights
  )

  if ([string]::IsNullOrWhiteSpace($SourceType) -or $null -eq $Weights) { return 0 }
  $prop = $Weights.PSObject.Properties[[string]$SourceType]
  if ($null -eq $prop) { return 0 }
  try {
    return [int]$prop.Value
  } catch {
    return 0
  }
}

function Get-SourceKeyWeight {
  param(
    [string]$SourceKey,
    [pscustomobject]$Weights
  )

  if ([string]::IsNullOrWhiteSpace($SourceKey) -or $null -eq $Weights) { return 0 }
  $prop = $Weights.PSObject.Properties[[string]$SourceKey]
  if ($null -eq $prop) { return 0 }
  try {
    return [int]$prop.Value
  } catch {
    return 0
  }
}

function Get-DateAgeDays {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return 9999 }
  try {
    $dt = ([datetime]$Value).ToUniversalTime()
    return [math]::Max(0, [int][math]::Floor(((Get-Date).ToUniversalTime() - $dt).TotalDays))
  } catch {
    return 9999
  }
}

function Add-CarryForwardFlags {
  param(
    [object[]]$Rows,
    [string]$FromRunId
  )

  $flagged = @()
  foreach ($row in $Rows) {
    $clone = $row | Select-Object *
    $clone | Add-Member -NotePropertyName isCarryForward -NotePropertyValue $true -Force
    $clone | Add-Member -NotePropertyName carriedForwardFromRunId -NotePropertyValue $FromRunId -Force
    $flagged += $clone
  }
  return $flagged
}

function Get-ConsumableSignals {
  param([object[]]$Consumables)

  $signals = @()
  foreach ($item in $Consumables) {
    $onHand = 0.0
    $targetMin = 0.0
    $reorder = 0.0
    $weekly = 0.0
    try { $onHand = [double]$item.currentOnHand } catch { $onHand = 0.0 }
    try { $targetMin = [double]$item.targetMin } catch { $targetMin = 0.0 }
    try { $reorder = [double]$item.reorderPoint } catch { $reorder = 0.0 }
    try { $weekly = [double]$item.weeklyUsage } catch { $weekly = 0.0 }

    $weeksRemaining = $null
    if ($weekly -gt 0) {
      $weeksRemaining = [math]::Round($onHand / $weekly, 2)
    }

    $status = "healthy"
    if ($onHand -le $reorder) {
      $status = "reorder_now"
    } elseif ($onHand -le $targetMin) {
      $status = "watch"
    }

    $signals += [pscustomobject]@{
      id = [string]$item.id
      label = [string]$item.label
      unit = [string]$item.unit
      currentOnHand = $onHand
      targetMin = $targetMin
      reorderPoint = $reorder
      weeklyUsage = $weekly
      weeksRemaining = $weeksRemaining
      status = $status
    }
  }
  return $signals
}

function Build-Markdown {
  param([pscustomobject]$Result)

  $lines = @()
  $lines += "# Studio Asset Intelligence Run"
  $lines += ""
  $lines += "- generatedAtUtc: $($Result.generatedAtUtc)"
  $lines += "- marketArea: $($Result.summary.marketArea)"
  $lines += "- totalQueries: $($Result.summary.totalQueries)"
  $lines += "- queryRows: $($Result.summary.queryRows)"
  $lines += "- stagedRows: $($Result.summary.stagedRows)"
  $lines += "- manualRows: $($Result.summary.manualRows)"
  $lines += "- opportunitiesAboveMinScore: $($Result.summary.opportunitiesAboveMinScore)"
  $lines += "- channelMix: $($Result.summary.channelMix)"
  $lines += "- neededWantedBoostedAssets: $($Result.summary.neededWantedBoostedAssets)"
  $lines += "- carryForwardUsed: $($Result.summary.carryForwardUsed)"
  if ($Result.summary.carryForwardUsed) {
    $lines += "- carryForwardFromRunId: $($Result.summary.carryForwardFromRunId)"
    $lines += "- carryForwardAgeDays: $($Result.summary.carryForwardAgeDays)"
  }
  $lines += ""
  $lines += "## Top Asset Opportunities"
  $lines += ""
  $lines += "| Score | Class | Category | City | Source | Channel | Title | URL |"
  $lines += "| ---: | --- | --- | --- | --- | --- | --- | --- |"
  foreach ($asset in $Result.topAssets) {
    $lines += "| $($asset.assetScore) | $($asset.classification) | $($asset.assetCategory) | $($asset.cityHint) | $($asset.sourceName) | $($asset.ingestChannel) | $($asset.title) | $($asset.url) |"
  }
  $lines += ""
  $lines += "## Consumables Status"
  $lines += ""
  if (@($Result.neededWantedContext.consumables).Count -eq 0) {
    $lines += "- none"
  } else {
    foreach ($item in $Result.neededWantedContext.consumables) {
      $lines += "- $($item.label): onHand=$($item.currentOnHand) $($item.unit), weeklyUsage=$($item.weeklyUsage), weeksRemaining=$($item.weeksRemaining), status=$($item.status)"
    }
  }
  $lines += ""
  $lines += "## Suggested Actions"
  $lines += ""
  foreach ($action in $Result.watchlist.nextActions) {
    $lines += "- $action"
  }
  return ($lines -join "`n") + "`n"
}

if (-not (Test-Path $ConfigPath)) {
  throw "Asset intelligence config not found: $ConfigPath"
}

$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$priorityDoc = $null
if (Test-Path $PriorityListPath) {
  $priorityDoc = Get-Content -Raw $PriorityListPath | ConvertFrom-Json
}
$sources = @($config.sources)
$cities = @($config.cities)
if ($sources.Count -eq 0) {
  throw "No sources configured in $ConfigPath"
}

$querySpecs = New-Object System.Collections.Generic.List[object]
foreach ($source in $sources) {
  foreach ($pattern in @($source.cityQueryPatterns)) {
    foreach ($city in $cities) {
      [void]$querySpecs.Add([pscustomobject]@{
        query = ([string]$pattern).Replace("{CITY}", $city)
        sourceKey = [string]$source.key
        sourceName = [string]$source.name
        sourceType = [string]$source.sourceType
        sourceDomains = @($source.domains)
      })
    }
  }
  foreach ($pattern in @($source.regionQueryPatterns)) {
    [void]$querySpecs.Add([pscustomobject]@{
      query = ([string]$pattern).Replace("{AREA}", [string]$config.marketArea)
      sourceKey = [string]$source.key
      sourceName = [string]$source.name
      sourceType = [string]$source.sourceType
      sourceDomains = @($source.domains)
    })
  }
}

$queryDedup = @{}
foreach ($spec in @($querySpecs.ToArray())) {
  $key = ("{0}|{1}" -f [string]$spec.sourceKey, [string]$spec.query).ToLowerInvariant()
  if (-not $queryDedup.ContainsKey($key)) {
    $queryDedup[$key] = $spec
  }
}
$querySpecs = [System.Collections.Generic.List[object]]::new()
foreach ($spec in ($queryDedup.Values | Sort-Object sourceKey, query)) {
  [void]$querySpecs.Add($spec)
}

$rawItems = @()
$queryRows = 0
foreach ($spec in @($querySpecs.ToArray())) {
  $rows = Invoke-BingRssSearch -Query $spec.query -MaxItems $MaxResultsPerQuery -SourceKey $spec.sourceKey -SourceName $spec.sourceName -SourceType $spec.sourceType -SourceDomains $spec.sourceDomains
  $queryRows += $rows.Count
  $rawItems += $rows
}

New-Item -ItemType Directory -Path $AutoFeedDir -Force | Out-Null
New-Item -ItemType Directory -Path $ManualDropDir -Force | Out-Null

$stagedRows = 0
$manualRows = 0
foreach ($source in $sources) {
  $stagedPath = Join-Path $AutoFeedDir ("{0}.csv" -f [string]$source.key)
  $manualPath = Join-Path $ManualDropDir ("{0}.csv" -f [string]$source.key)
  $stagedSourceRows = Import-LocalAssetCsv -Path $stagedPath -Source $source -Channel "direct_feed_stage"
  $manualSourceRows = Import-LocalAssetCsv -Path $manualPath -Source $source -Channel "manual_drop"
  $rawItems += $stagedSourceRows
  $rawItems += $manualSourceRows
  $stagedRows += $stagedSourceRows.Count
  $manualRows += $manualSourceRows.Count
}

$manualAllPath = Join-Path $ManualDropDir "_all-sources.csv"
if (Test-Path $manualAllPath) {
  $manualAllRows = Import-LocalAssetCsv -Path $manualAllPath -Source ([pscustomobject]@{ key = "manual_all"; name = "Manual All Sources"; sourceType = "community_marketplace"; domains = @() }) -Channel "manual_drop_all"
  $manualRows += $manualAllRows.Count
  $rawItems += $manualAllRows
}

$dedup = @{}
foreach ($item in $rawItems) {
  $key = if (-not [string]::IsNullOrWhiteSpace([string]$item.url)) {
    ([string]$item.url).Trim().ToLowerInvariant()
  } else {
    ("{0}|{1}|{2}" -f [string]$item.title, [string]$item.sourceQuery, [string]$item.sourceKey).ToLowerInvariant()
  }
  if (-not $dedup.ContainsKey($key)) {
    $dedup[$key] = $item
  }
}

$scored = @()
$priorityBoostedAssets = 0
$priorityItems = @()
if ($null -ne $priorityDoc -and $null -ne $priorityDoc.assetPriorities) {
  $priorityItems = @($priorityDoc.assetPriorities)
}
foreach ($key in $dedup.Keys) {
  $item = $dedup[$key]
  $content = @([string]$item.title, [string]$item.summary, [string]$item.sourceQuery, [string]$item.notes) -join " "
  $domain = Get-UrlHost -Url ([string]$item.url)

  $equipmentMatch = Get-MatchedKeywords -Text $content -KeywordWeights $config.equipmentKeywordWeights
  $dealMatch = Get-MatchedKeywords -Text $content -KeywordWeights $config.dealSignalWeights
  $riskMatch = Get-MatchedKeywords -Text $content -KeywordWeights $config.riskSignalWeights

  $cityHint = [string]$item.city
  if ([string]::IsNullOrWhiteSpace($cityHint)) {
    foreach ($city in $cities) {
      if ($content.ToLowerInvariant() -match [regex]::Escape(([string]$city).ToLowerInvariant())) {
        $cityHint = [string]$city
        break
      }
    }
  }

  $localityScore = if ([string]::IsNullOrWhiteSpace($cityHint)) { 0 } else { 14 }
  $sourceDomainScore = if (Test-DomainMatch -DomainHost $domain -Candidates @($item.sourceDomains)) { 8 } else { 3 }
  $sourceTypeScore = Get-SourceTypeWeight -SourceType ([string]$item.sourceType) -Weights $config.sourceTypeWeights
  $sourceKeyScore = Get-SourceKeyWeight -SourceKey ([string]$item.sourceKey) -Weights $config.sourceKeyWeights
  $shippingPenalty = if ($content.ToLowerInvariant() -match "shipping only|will ship|nationwide shipping|out of state" -and [string]::IsNullOrWhiteSpace($cityHint)) { -14 } else { 0 }
  $priorityBoost = 0
  $priorityMatches = New-Object System.Collections.Generic.List[object]
  foreach ($priorityItem in $priorityItems) {
    $matched = $false
    foreach ($kw in @($priorityItem.keywords)) {
      if ([string]::IsNullOrWhiteSpace([string]$kw)) { continue }
      if ($content.ToLowerInvariant() -match [regex]::Escape(([string]$kw).ToLowerInvariant())) {
        $matched = $true
        break
      }
    }
    if ($matched) {
      $boost = 0
      try { $boost = [int]$priorityItem.scoreBoost } catch { $boost = 0 }
      $priorityBoost += $boost
      [void]$priorityMatches.Add([pscustomobject]@{
        id = [string]$priorityItem.id
        label = [string]$priorityItem.label
        priority = [string]$priorityItem.priority
        status = [string]$priorityItem.status
        scoreBoost = $boost
      })
    }
  }

  $rawScore = $equipmentMatch.score + $dealMatch.score + $riskMatch.score + $localityScore + $sourceDomainScore + $sourceTypeScore + $sourceKeyScore + $priorityBoost + $shippingPenalty
  $assetScore = [int][math]::Max(0, [math]::Min(100, $rawScore))
  if ($assetScore -lt $MinScore) { continue }
  if ($priorityMatches.Count -gt 0) { $priorityBoostedAssets += 1 }

  $classification = Get-Classification -Score $assetScore
  $category = Get-AssetCategory -Text $content

  $scored += [pscustomobject]@{
    assetId = ("asset:{0}" -f ([math]::Abs($key.GetHashCode())))
    title = [string]$item.title
    url = [string]$item.url
    summary = [string]$item.summary
    publishedAt = [string]$item.publishedAt
    sourceQuery = [string]$item.sourceQuery
    sourceKey = [string]$item.sourceKey
    sourceName = [string]$item.sourceName
    sourceType = [string]$item.sourceType
    domain = $domain
    cityHint = $cityHint
    ingestChannel = [string]$item.ingestChannel
    assetCategory = $category
    assetScore = $assetScore
    classification = $classification
    scoreBreakdown = [pscustomobject]@{
      equipmentScore = $equipmentMatch.score
      dealScore = $dealMatch.score
      riskScore = $riskMatch.score
      localityScore = $localityScore
      sourceDomainScore = $sourceDomainScore
      sourceTypeScore = $sourceTypeScore
      sourceKeyScore = $sourceKeyScore
      priorityBoost = $priorityBoost
      shippingPenalty = $shippingPenalty
      total = $assetScore
    }
    evidence = [pscustomobject]@{
      equipmentMatches = $equipmentMatch.matches
      dealMatches = $dealMatch.matches
      riskMatches = $riskMatch.matches
      neededWantedMatches = @($priorityMatches.ToArray())
    }
    isCarryForward = $false
    carriedForwardFromRunId = ""
  }
}

$rankedLive = @(
  $scored |
    Sort-Object @{ Expression = { $_.assetScore }; Descending = $true }, @{ Expression = { $_.publishedAt }; Descending = $true } |
    Select-Object -First $Top
)

$carryForwardUsed = $false
$carryForwardFromRunId = ""
$carryForwardAgeDays = 0
$ranked = $rankedLive

if ($EnableCarryForward -and $rankedLive.Count -eq 0) {
  $previousPath = Join-Path $OutputDir "studio-asset-intelligence-latest.json"
  if (Test-Path $previousPath) {
    try {
      $previous = Get-Content -Raw $previousPath | ConvertFrom-Json
      $prevTop = @($previous.topAssets)
      if ($prevTop.Count -gt 0) {
        $carryForwardAgeDays = Get-DateAgeDays -Value ([string]$previous.generatedAtUtc)
        if ($carryForwardAgeDays -le $CarryForwardMaxAgeDays) {
          $carryForwardUsed = $true
          $carryForwardFromRunId = [string]$previous.runId
          $ranked = Add-CarryForwardFlags -Rows (@($prevTop | Select-Object -First $Top)) -FromRunId $carryForwardFromRunId
          if ($scored.Count -eq 0) {
            $scored = Add-CarryForwardFlags -Rows (@($previous.allAssets)) -FromRunId $carryForwardFromRunId
          }
        }
      }
    } catch {
      $carryForwardUsed = $false
    }
  }
}

$channelCounts = @{}
$channelSource = if ($scored.Count -gt 0) { $scored } else { $ranked }
foreach ($asset in $channelSource) {
  $key = if ([string]::IsNullOrWhiteSpace([string]$asset.sourceType)) { "unknown" } else { [string]$asset.sourceType }
  if (-not $channelCounts.ContainsKey($key)) {
    $channelCounts[$key] = 0
  }
  $channelCounts[$key] += 1
}
$channelMix = @()
foreach ($k in ($channelCounts.Keys | Sort-Object)) {
  $channelMix += ("{0}:{1}" -f $k, $channelCounts[$k])
}

$taskQueue = @()
$taskIdx = 0
foreach ($asset in $ranked) {
  $taskIdx += 1
  $priority = if ([string]$asset.classification -eq "high_priority") { "high" } elseif ([string]$asset.classification -eq "medium_priority") { "medium" } else { "low" }
  $taskQueue += [pscustomobject]@{
    taskId = ("asset-task-{0:D4}" -f $taskIdx)
    assetId = [string]$asset.assetId
    priority = $priority
    agentRole = "asset_scout_agent"
    objective = "Verify availability, condition, and local pickup feasibility for studio use."
    requiredChecks = @(
      "confirm_current_availability",
      "request_working_demo_or_test_video",
      "confirm_power_or_fuel_requirements",
      "confirm_pickup_location_and_loading_constraints"
    )
    dueWithinDays = if ($priority -eq "high") { 2 } elseif ($priority -eq "medium") { 4 } else { 7 }
  }
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$consumablesSignals = @()
if ($null -ne $priorityDoc -and $null -ne $priorityDoc.consumables) {
  $consumablesSignals = Get-ConsumableSignals -Consumables @($priorityDoc.consumables)
}
$result = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  summary = [pscustomobject]@{
    marketArea = [string]$config.marketArea
    totalQueries = $querySpecs.Count
    queryRows = $queryRows
    stagedRows = $stagedRows
    manualRows = $manualRows
    rawItems = $rawItems.Count
    uniqueItems = $dedup.Count
    opportunitiesAboveMinScore = $scored.Count
    topReturned = $ranked.Count
    channelMix = ($channelMix -join ", ")
    neededWantedBoostedAssets = $priorityBoostedAssets
    carryForwardUsed = $carryForwardUsed
    carryForwardFromRunId = $carryForwardFromRunId
    carryForwardAgeDays = $carryForwardAgeDays
  }
  inputs = [pscustomobject]@{
    configPath = (Resolve-Path $ConfigPath).Path
    priorityListPath = if (Test-Path $PriorityListPath) { (Resolve-Path $PriorityListPath).Path } else { $PriorityListPath }
    autoFeedDir = if (Test-Path $AutoFeedDir) { (Resolve-Path $AutoFeedDir).Path } else { $AutoFeedDir }
    manualDropDir = if (Test-Path $ManualDropDir) { (Resolve-Path $ManualDropDir).Path } else { $ManualDropDir }
    minScore = $MinScore
    top = $Top
    maxResultsPerQuery = $MaxResultsPerQuery
    enableCarryForward = $EnableCarryForward
    carryForwardMaxAgeDays = $CarryForwardMaxAgeDays
  }
  topAssets = $ranked
  allAssets = $scored
  neededWantedContext = [pscustomobject]@{
    priorities = $priorityItems
    consumables = $consumablesSignals
  }
  watchlist = [pscustomobject]@{
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    runId = $runId
    assetCount = $ranked.Count
    taskQueue = $taskQueue
    nextActions = @(
      "Prioritize high-score local kiln and wheel opportunities for same-week outreach.",
      "Prioritize assets matching needed/wanted list boosts before lower-priority gear.",
      "Request condition proof (video under power/load) before scheduling pickup.",
      "Validate utility and fuel requirements against studio-needs profile before committing.",
      "Batch nearby pickups to reduce hauling cost and downtime.",
      "Review consumables status and align procurement with equipment opportunities (bulk/local pickup)."
    )
  }
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$jsonPath = Join-Path $OutputDir "studio-asset-intelligence-$runId.json"
$mdPath = Join-Path $OutputDir "studio-asset-intelligence-$runId.md"
$latestJsonPath = Join-Path $OutputDir "studio-asset-intelligence-latest.json"
$latestMdPath = Join-Path $OutputDir "studio-asset-intelligence-latest.md"
$watchlistPath = Join-Path $OutputDir "studio-asset-watchlist-$runId.json"
$watchlistLatestPath = Join-Path $OutputDir "studio-asset-watchlist-latest.json"

$result | ConvertTo-Json -Depth 12 | Set-Content -Path $jsonPath -Encoding UTF8
$result | ConvertTo-Json -Depth 12 | Set-Content -Path $latestJsonPath -Encoding UTF8
$markdown = Build-Markdown -Result $result
$markdown | Set-Content -Path $mdPath -Encoding UTF8
$markdown | Set-Content -Path $latestMdPath -Encoding UTF8
$result.watchlist | ConvertTo-Json -Depth 10 | Set-Content -Path $watchlistPath -Encoding UTF8
$result.watchlist | ConvertTo-Json -Depth 10 | Set-Content -Path $watchlistLatestPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $mdPath"
Write-Host "Wrote $latestJsonPath"
Write-Host "Wrote $latestMdPath"
Write-Host "Wrote $watchlistPath"
Write-Host "Wrote $watchlistLatestPath"
