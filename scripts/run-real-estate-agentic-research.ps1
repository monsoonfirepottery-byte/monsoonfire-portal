param(
  [string]$OutputDir = "output/real-estate",
  [string[]]$Cities = @("Goodyear", "Avondale", "Tolleson", "Glendale", "Phoenix"),
  [int]$MaxResultsPerQuery = 25,
  [int]$Top = 30,
  [int]$MinLeadScore = 30
)

$ErrorActionPreference = "Stop"

function Convert-RssFieldToString {
  param([object]$Value)

  if ($null -eq $Value) { return "" }
  if ($Value -is [string]) { return $Value.Trim() }
  if ($Value -is [System.Xml.XmlNode]) { return ([string]$Value.InnerText).Trim() }

  $props = $Value.PSObject.Properties
  foreach ($name in @("#text", "InnerText", "href", "Value")) {
    $prop = $props[$name]
    if ($null -ne $prop -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
      return ([string]$prop.Value).Trim()
    }
  }

  return ([string]$Value).Trim()
}

function Invoke-BingRssSearch {
  param(
    [Parameter(Mandatory = $true)][string]$Query,
    [int]$MaxItems = 25
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

  $items = @($rss.channel.item | Select-Object -First $MaxItems)
  $rows = @()
  foreach ($item in $items) {
    $title = Convert-RssFieldToString $item.title
    $url = Convert-RssFieldToString $item.link
    $summary = Convert-RssFieldToString $item.description
    $published = Convert-RssFieldToString $item.pubDate
    if ([string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($url)) {
      continue
    }
    $rows += [pscustomobject]@{
      title = $title
      url = $url
      summary = $summary
      publishedAt = $published
      sourceQuery = $Query
    }
  }
  return $rows
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

function Get-FallbackLeadsFromMarketWatch {
  param([string]$Directory)

  $fallback = @()
  $files = Get-ChildItem -Path $Directory -Filter "market-watch-*.json" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
  if ($files.Count -eq 0) {
    return @()
  }

  $latest = Get-Content -Raw $files[0].FullName | ConvertFrom-Json
  if ($null -eq $latest -or $null -eq $latest.topCandidates) {
    return @()
  }

  foreach ($candidate in $latest.topCandidates) {
    $seedScore = 0
    try {
      $seedScore = [int]$candidate.fit.score
    } catch {
      $seedScore = 0
    }
    $fallback += [pscustomobject]@{
      title = [string]$candidate.title
      url = [string]$candidate.url
      summary = [string]$candidate.notes
      publishedAt = [string]$latest.generatedAtUtc
      sourceQuery = "fallback:market-watch"
      cityHintSeed = [string]$candidate.city
      baseLeadScore = $seedScore
    }
  }

  return $fallback
}

function Get-MatchedKeywords {
  param(
    [string]$Text,
    [hashtable]$KeywordWeights
  )

  $found = New-Object System.Collections.Generic.List[object]
  $score = 0
  $lower = if ($null -eq $Text) { "" } else { $Text.ToLowerInvariant() }

  foreach ($keyword in $KeywordWeights.Keys) {
    if ($lower -match [regex]::Escape($keyword.ToLowerInvariant())) {
      $weight = [int]$KeywordWeights[$keyword]
      $score += $weight
      [void]$found.Add([pscustomobject]@{
        keyword = $keyword
        weight = $weight
      })
    }
  }

  return [pscustomobject]@{
    score = $score
    matches = @($found.ToArray())
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
    $cand = $candidate.ToLowerInvariant()
    if ($hostLower -eq $cand -or $hostLower.EndsWith("." + $cand)) {
      return $true
    }
  }
  return $false
}

function Get-LeadClassification {
  param(
    [int]$LeadScore,
    [int]$DistressScore,
    [int]$GovernmentDistressScore
  )
  if (($DistressScore -ge 20 -or $GovernmentDistressScore -ge 14) -and $LeadScore -ge 55) { return "distress_opportunity" }
  if ($LeadScore -ge 70) { return "high_priority" }
  if ($LeadScore -ge 50) { return "medium_priority" }
  return "low_priority"
}

function Build-Markdown {
  param([pscustomobject]$Result)

  $lines = @()
  $lines += "# Agentic Real Estate Research Run"
  $lines += ""
  $lines += "- generatedAtUtc: $($Result.generatedAtUtc)"
  $lines += "- totalQueries: $($Result.summary.totalQueries)"
  $lines += "- rawItems: $($Result.summary.rawItems)"
  $lines += "- uniqueLeads: $($Result.summary.uniqueLeads)"
  $lines += "- leadsAboveThreshold: $($Result.summary.leadsAboveThreshold)"
  $lines += "- distressOpportunities: $($Result.summary.distressOpportunities)"
  $lines += "- governmentDistressSignals: $($Result.summary.governmentDistressSignals)"
  $lines += "- fallbackUsed: $($Result.summary.fallbackUsed)"
  $lines += ""
  $lines += "## Top Leads"
  $lines += ""
  $lines += "| Score | Distress | Govt | Class | City | Title | Domain | URL |"
  $lines += "| ---: | ---: | ---: | --- | --- | --- | --- | --- |"
  foreach ($lead in $Result.topLeads) {
    $lines += "| $($lead.leadScore) | $($lead.distressScore) | $($lead.governmentDistressScore) | $($lead.classification) | $($lead.cityHint) | $($lead.title) | $($lead.domain) | $($lead.url) |"
  }
  $lines += ""
  $lines += "## Suggested Swarm Actions"
  $lines += ""
  foreach ($action in $Result.swarmContext.nextActions) {
    $lines += "- $action"
  }
  return ($lines -join "`n") + "`n"
}

$fitWeights = @{
  "industrial" = 10
  "warehouse" = 10
  "light industrial" = 10
  "flex space" = 6
  "manufacturing" = 6
  "distribution" = 6
  "for lease" = 5
  "for sale" = 5
}

$distressWeights = @{
  "price reduced" = 14
  "reduced" = 6
  "distressed" = 15
  "foreclosure" = 20
  "auction" = 18
  "bank owned" = 20
  "motivated seller" = 14
  "urgent" = 10
  "vacant" = 8
  "sublease" = 9
  "below market" = 12
  "must sell" = 16
  "fire sale" = 20
  "tax lien" = 20
  "tax liens" = 20
  "delinquent tax" = 18
  "delinquent taxes" = 18
  "unpaid taxes" = 18
  "tax delinquent" = 18
  "tax deed" = 16
  "tax sale" = 16
  "sheriff sale" = 18
  "notice of trustee sale" = 16
  "lis pendens" = 14
  "receivership" = 14
  "bankruptcy sale" = 15
  "code violation" = 10
  "nuisance abatement" = 10
}

$preferredDomains = @(
  "loopnet.com",
  "crexi.com",
  "commercialcafe.com",
  "moodyscre.com",
  "costar.com",
  "cbre.com",
  "colliers.com",
  "jll.com",
  "cityfeet.com"
)

$governmentDomains = @(
  "maricopa.gov",
  "phoenix.gov",
  "glendaleaz.com",
  "avondaleaz.gov",
  "goodyearaz.gov",
  "tolleson.az.gov",
  "az.gov"
)

$governmentSignalWeights = @{
  "maricopa county treasurer" = 12
  "maricopa county assessor" = 10
  "tax lien sale" = 16
  "delinquent tax roll" = 14
  "foreclosure auction" = 14
  "sheriff sale" = 14
  "code enforcement" = 8
  "property tax delinquent" = 14
  "trustee sale" = 12
}

$baseQueryPatterns = @(
  "{CITY} AZ industrial warehouse for lease",
  "{CITY} AZ industrial warehouse for sale",
  "{CITY} AZ light industrial flex space available"
)

$distressQueryPatterns = @(
  "{CITY} AZ industrial property price reduced",
  "{CITY} AZ warehouse motivated seller",
  "{CITY} AZ industrial foreclosure auction",
  "{CITY} AZ industrial sublease vacant warehouse"
)

$governmentDistressQueryPatterns = @(
  "{CITY} AZ industrial property tax lien",
  "{CITY} AZ warehouse delinquent taxes",
  "{CITY} AZ industrial sheriff sale",
  "{CITY} AZ trustee sale industrial property"
)

$countyLevelGovernmentQueries = @(
  "Maricopa County industrial property tax liens",
  "Maricopa County delinquent property taxes warehouse",
  "Maricopa County treasurer tax sale industrial",
  "Maricopa County code enforcement vacant industrial property"
)

$queries = New-Object System.Collections.Generic.List[string]
foreach ($city in $Cities) {
  foreach ($pattern in $baseQueryPatterns) {
    $queries.Add($pattern.Replace("{CITY}", $city))
  }
  foreach ($pattern in $distressQueryPatterns) {
    $queries.Add($pattern.Replace("{CITY}", $city))
  }
  foreach ($pattern in $governmentDistressQueryPatterns) {
    $queries.Add($pattern.Replace("{CITY}", $city))
  }
}
foreach ($query in $countyLevelGovernmentQueries) {
  $queries.Add($query)
}
$queries = @($queries.ToArray() | Sort-Object -Unique)

$rawLeads = @()
foreach ($query in $queries) {
  $rawLeads += Invoke-BingRssSearch -Query $query -MaxItems $MaxResultsPerQuery
}

$fallbackUsed = $false
if ($rawLeads.Count -eq 0) {
  $fallbackLeads = Get-FallbackLeadsFromMarketWatch -Directory $OutputDir
  if ($fallbackLeads.Count -gt 0) {
    $rawLeads = $fallbackLeads
    $fallbackUsed = $true
  }
}

$deduped = @{}
foreach ($lead in $rawLeads) {
  $key = if (-not [string]::IsNullOrWhiteSpace($lead.url)) {
    $lead.url.Trim().ToLowerInvariant()
  } else {
    ("{0}|{1}" -f $lead.title, $lead.sourceQuery).ToLowerInvariant()
  }
  if (-not $deduped.ContainsKey($key)) {
    $deduped[$key] = $lead
  }
}

$scored = @()
foreach ($key in $deduped.Keys) {
  $lead = $deduped[$key]
  $domain = Get-UrlHost -Url $lead.url
  $content = @(
    $lead.title,
    $lead.summary,
    $lead.sourceQuery
  ) -join " "

  $fit = Get-MatchedKeywords -Text $content -KeywordWeights $fitWeights
  $distress = Get-MatchedKeywords -Text $content -KeywordWeights $distressWeights
  $governmentSignals = Get-MatchedKeywords -Text $content -KeywordWeights $governmentSignalWeights

  $cityHint = ""
  if (-not [string]::IsNullOrWhiteSpace([string]$lead.cityHintSeed)) {
    $cityHint = [string]$lead.cityHintSeed
  }
  foreach ($city in $Cities) {
    if ($content.ToLowerInvariant() -match [regex]::Escape($city.ToLowerInvariant())) {
      $cityHint = $city
      break
    }
  }

  $domainScore = 0
  if (Test-DomainMatch -DomainHost $domain -Candidates $preferredDomains) {
    $domainScore = 6
  }
  $governmentDomainScore = if (Test-DomainMatch -DomainHost $domain -Candidates $governmentDomains) { 10 } else { 0 }

  $cityScore = if ([string]::IsNullOrWhiteSpace($cityHint)) { 0 } else { 8 }
  $baseLeadScore = 0
  try {
    $baseLeadScore = [int]$lead.baseLeadScore
  } catch {
    $baseLeadScore = 0
  }
  $governmentDistressScore = $governmentSignals.score + $governmentDomainScore
  $leadScore = $baseLeadScore + $fit.score + $distress.score + $domainScore + $cityScore + $governmentDistressScore
  $classification = Get-LeadClassification -LeadScore $leadScore -DistressScore $distress.score -GovernmentDistressScore $governmentDistressScore

  $scored += [pscustomobject]@{
    title = $lead.title
    url = $lead.url
    summary = $lead.summary
    publishedAt = $lead.publishedAt
    sourceQuery = $lead.sourceQuery
    domain = $domain
    cityHint = $cityHint
    fitScore = $fit.score
    distressScore = $distress.score
    governmentDistressScore = $governmentDistressScore
    baseLeadScore = $baseLeadScore
    domainScore = $domainScore
    governmentDomainScore = $governmentDomainScore
    cityScore = $cityScore
    leadScore = $leadScore
    classification = $classification
    fitMatches = $fit.matches
    distressMatches = $distress.matches
    governmentMatches = $governmentSignals.matches
  }
}

$ranked = @(
  $scored |
    Where-Object { $_.leadScore -ge $MinLeadScore } |
    Sort-Object @{ Expression = { $_.leadScore }; Descending = $true }, @{ Expression = { $_.distressScore }; Descending = $true } |
    Select-Object -First $Top
)

$latestQuarterContext = $null
$contextFiles = Get-ChildItem -Path $OutputDir -Filter "agent-swarm-context-*.json" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
if ($contextFiles.Count -gt 0) {
  $latestQuarterContext = [pscustomobject]@{
    file = $contextFiles[0].FullName
    quarter = [System.IO.Path]::GetFileNameWithoutExtension($contextFiles[0].Name).Replace("agent-swarm-context-", "")
  }
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$result = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  summary = [pscustomobject]@{
    totalQueries = $queries.Count
    rawItems = $rawLeads.Count
    uniqueLeads = $deduped.Count
    leadsAboveThreshold = $ranked.Count
    distressOpportunities = (@($ranked | Where-Object { $_.classification -eq "distress_opportunity" })).Count
    governmentDistressSignals = (@($ranked | Where-Object { $_.governmentDistressScore -gt 0 })).Count
    fallbackUsed = $fallbackUsed
  }
  queries = $queries
  topLeads = $ranked
  swarmContext = [pscustomobject]@{
    objective = "Proactively identify local industrial expansion opportunities and distressed-market conditions."
    marketArea = "West Valley and Phoenix, Arizona"
    latestQuarterContext = $latestQuarterContext
    leadSelectionRules = [pscustomobject]@{
      minLeadScore = $MinLeadScore
      top = $Top
      prioritizeDistress = $true
    }
    nextActions = @(
      "Validate listing status and current ask against broker or listing portal.",
      "Prioritize leads with classification=distress_opportunity for immediate outreach.",
      "Cross-check top leads against county tax-lien, delinquent-tax, and trustee-sale sources before outreach.",
      "Pull assessor/treasurer parcel-level history for leads carrying governmentDistressScore > 0.",
      "Request rent roll and concessions where price-reduced or vacancy language appears.",
      "Compare each shortlisted lead against latest quarterly medians before LOI strategy."
    )
    promptSeed = "Use topLeads plus latestQuarterContext to produce a broker outreach plan, negotiation posture, and 30-day opportunity watchlist."
  }
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$jsonPath = Join-Path $OutputDir "agentic-research-$runId.json"
$mdPath = Join-Path $OutputDir "agentic-research-$runId.md"
$swarmPath = Join-Path $OutputDir "agent-swarm-research-context-$runId.json"

$result | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding UTF8
$md = Build-Markdown -Result $result
$md | Set-Content -Path $mdPath -Encoding UTF8
$result.swarmContext | Add-Member -NotePropertyName topLeads -NotePropertyValue $ranked
$result.swarmContext | ConvertTo-Json -Depth 10 | Set-Content -Path $swarmPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $mdPath"
Write-Host "Wrote $swarmPath"
