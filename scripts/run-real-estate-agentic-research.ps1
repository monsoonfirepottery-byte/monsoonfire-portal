param(
  [string]$OutputDir = "output/real-estate",
  [string[]]$Cities = @("Goodyear", "Avondale", "Tolleson", "Glendale", "Phoenix"),
  [int]$MaxResultsPerQuery = 25,
  [int]$Top = 30,
  [int]$MinLeadScore = 30,
  [int]$MinPublicSignalScore = 40,
  [int]$MaxPublicSignalLeads = 120,
  [string]$MarketAreaLabel = "West Valley and Phoenix, Arizona",
  [string]$PublicSignalsPath = "output/real-estate/public-signals-latest.json",
  [string]$MacroContextPath = "output/real-estate/macro-context-latest.json"
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
    [int]$MaxItems = 25,
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
      sourceKey = $SourceKey
      sourceName = $SourceName
      sourceType = $SourceType
      sourceDomains = @($SourceDomains)
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
      sourceKey = "fallback-market-watch"
      sourceName = "Market Watch Fallback Candidates"
      sourceType = "fallback"
      sourceDomains = @()
      cityHintSeed = [string]$candidate.city
      baseLeadScore = $seedScore
    }
  }

  return $fallback
}

function Get-LeadsFromPublicSignals {
  param(
    [string]$Path,
    [int]$MinSignalScore = 40,
    [int]$MaxLeads = 200,
    [int]$PromptInjectionFlagThreshold = 7,
    [int]$PromptInjectionHardBlockThreshold = 14
  )

  if ([string]::IsNullOrWhiteSpace($Path)) { return @() }
  if (-not (Test-Path $Path)) { return @() }

  $doc = $null
  try {
    $doc = Get-Content -Raw $Path | ConvertFrom-Json
  } catch {
    return @()
  }

  if ($null -eq $doc -or $null -eq $doc.signals) {
    return @()
  }

  $leads = @()
  $allowedSignalTypes = @(
    "tax_delinquent", "tax_lien", "trustee_sale", "sheriff_sale", "foreclosure", "receivership",
    "bankruptcy", "ucc_distress", "code_enforcement", "utility_constraint", "cmbs_delinquency",
    "government_auction_opportunity", "grant_opportunity", "community_signal"
  )

  $communityCorroborationTerms = @(
    "tax lien", "tax delinquent", "foreclosure", "trustee sale", "sheriff sale",
    "bankruptcy", "receivership", "code violation", "auction", "warehouse for lease",
    "commercial lease", "industrial space", "sublease"
  )

  $candidateSignals = @(
    $doc.signals |
      Where-Object {
        $signalType = [string]$_.signalType
        $priority = [string]$_.priority
        $stage = [string]$_.distressStage
        $notes = ([string]$_.notes).ToLowerInvariant()
        $sourceName = ([string]$_.sourceName).ToLowerInvariant()
        $score = 0
        try { $score = [int]$_.signalScore } catch { $score = 0 }
        $promptInjectionScore = 0
        try { $promptInjectionScore = [int]$_.promptInjectionScore } catch { $promptInjectionScore = 0 }
        $isSuspectedPromptInjection = $false
        try { $isSuspectedPromptInjection = [bool]$_.isSuspectedPromptInjection } catch { $isSuspectedPromptInjection = $false }

        if ($score -lt $MinSignalScore) { return $false }
        if ($promptInjectionScore -ge $PromptInjectionHardBlockThreshold) { return $false }

        if ($signalType -eq "community_signal") {
          if ($isSuspectedPromptInjection -or $promptInjectionScore -ge $PromptInjectionFlagThreshold) {
            return $false
          }
          $hasCorroborationTerm = $false
          foreach ($term in $communityCorroborationTerms) {
            if ($notes -match [regex]::Escape($term.ToLowerInvariant()) -or $sourceName -match [regex]::Escape($term.ToLowerInvariant())) {
              $hasCorroborationTerm = $true
              break
            }
          }
          if (-not $hasCorroborationTerm) { return $false }
          if ($score -lt ($MinSignalScore + 8)) { return $false }
          return $true
        }

        if ($allowedSignalTypes -contains $signalType) { return $true }
        if ($priority -eq "high" -and $score -ge ($MinSignalScore + 20) -and $stage -ne "monitoring") { return $true }
        return $false
      } |
      Sort-Object @{ Expression = { [int]$_.signalScore }; Descending = $true }, @{ Expression = { [string]$_.eventDate }; Descending = $true } |
      Select-Object -First $MaxLeads
  )
  foreach ($signal in $candidateSignals) {
    $signalId = [string]$signal.signalId
    $signalType = [string]$signal.signalType
    $distressStage = [string]$signal.distressStage
    $city = [string]$signal.city
    $parcelId = [string]$signal.parcelId
    $ownerName = [string]$signal.ownerName
    $signalScore = 0
    try {
      $signalScore = [int]$signal.signalScore
    } catch {
      $signalScore = 0
    }
    $promptInjectionScore = 0
    try {
      $promptInjectionScore = [int]$signal.promptInjectionScore
    } catch {
      $promptInjectionScore = 0
    }
    $isSuspectedPromptInjection = $false
    try {
      $isSuspectedPromptInjection = [bool]$signal.isSuspectedPromptInjection
    } catch {
      $isSuspectedPromptInjection = $false
    }

    $titleParts = @()
    if (-not [string]::IsNullOrWhiteSpace($signalType)) { $titleParts += $signalType }
    if (-not [string]::IsNullOrWhiteSpace($city)) { $titleParts += $city }
    if (-not [string]::IsNullOrWhiteSpace($parcelId)) { $titleParts += "parcel $parcelId" }
    if ($titleParts.Count -eq 0) { $titleParts = @("public distress signal") }

    $summaryParts = @()
    if (-not [string]::IsNullOrWhiteSpace($distressStage)) { $summaryParts += "stage=$distressStage" }
    if (-not [string]::IsNullOrWhiteSpace($ownerName)) { $summaryParts += "owner=$ownerName" }
    if ($null -ne $signal.amount -and [string]$signal.amount -ne "") { $summaryParts += "amount=$($signal.amount)" }
    if (-not [string]::IsNullOrWhiteSpace([string]$signal.caseNumber)) { $summaryParts += "case=$($signal.caseNumber)" }
    if (-not [string]::IsNullOrWhiteSpace([string]$signal.notes)) { $summaryParts += [string]$signal.notes }

    $url = [string]$signal.recordUrl
    $queryKey = "public-signals:$($signal.sourceKey)"
    if (-not [string]::IsNullOrWhiteSpace($signalId)) {
      $queryKey = "${queryKey}:$signalId"
    }

    $leads += [pscustomobject]@{
      title = ($titleParts -join " | ")
      url = $url
      summary = ($summaryParts -join " ; ")
      publishedAt = [string]$signal.eventDate
      sourceQuery = $queryKey
      sourceKey = [string]$signal.sourceKey
      sourceName = [string]$signal.sourceName
      sourceType = if ($signalType -eq "community_signal") { "community_signal" } else { "public_signal" }
      sourceDomains = @(
        @(if ([string]::IsNullOrWhiteSpace($url)) { @() } else { @(Get-UrlHost -Url $url) }) |
          Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
      )
      cityHintSeed = $city
      baseLeadScore = $signalScore
      parcelId = [string]$signal.parcelId
      ownerName = $ownerName
      signalType = $signalType
      distressStage = $distressStage
      promptInjectionScore = $promptInjectionScore
      isSuspectedPromptInjection = $isSuspectedPromptInjection
      sourceSystem = "public_signals"
    }
  }

  return $leads
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

function Add-QuerySpecsFromSourceProfile {
  param(
    [System.Collections.Generic.List[object]]$QuerySpecs,
    [pscustomobject]$Profile,
    [string[]]$Cities
  )

  if ($null -eq $Profile -or [string]::IsNullOrWhiteSpace([string]$Profile.key)) {
    return
  }

  $cityPatterns = @()
  if ($null -ne $Profile.cityQueryPatterns) {
    $cityPatterns = @($Profile.cityQueryPatterns)
  }
  foreach ($pattern in $cityPatterns) {
    foreach ($city in $Cities) {
      $query = ([string]$pattern).Replace("{CITY}", $city)
      [void]$QuerySpecs.Add([pscustomobject]@{
        query = $query
        sourceKey = [string]$Profile.key
        sourceName = [string]$Profile.name
        sourceType = [string]$Profile.sourceType
        sourceDomains = @($Profile.domains)
      })
    }
  }

  $regionalPatterns = @()
  if ($null -ne $Profile.regionQueryPatterns) {
    $regionalPatterns = @($Profile.regionQueryPatterns)
  }
  foreach ($pattern in $regionalPatterns) {
    $query = ([string]$pattern).Replace("{AREA}", "West Valley Phoenix")
    [void]$QuerySpecs.Add([pscustomobject]@{
      query = $query
      sourceKey = [string]$Profile.key
      sourceName = [string]$Profile.name
      sourceType = [string]$Profile.sourceType
      sourceDomains = @($Profile.domains)
    })
  }
}

function Build-SourceCoverage {
  param(
    [pscustomobject[]]$SourceProfiles,
    [pscustomobject[]]$QuerySpecs,
    [pscustomobject[]]$RawLeads,
    [pscustomobject[]]$ScoredLeads,
    [pscustomobject[]]$RankedLeads
  )

  $sourceIndex = @{}
  foreach ($profile in $SourceProfiles) {
    $sourceIndex[[string]$profile.key] = $profile
  }

  $allSourceKeys = @{}
  foreach ($spec in $QuerySpecs) {
    if (-not [string]::IsNullOrWhiteSpace([string]$spec.sourceKey)) {
      $allSourceKeys[[string]$spec.sourceKey] = $true
    }
  }
  foreach ($lead in $RawLeads) {
    if (-not [string]::IsNullOrWhiteSpace([string]$lead.sourceKey)) {
      $allSourceKeys[[string]$lead.sourceKey] = $true
    }
  }
  foreach ($lead in $ScoredLeads) {
    if (-not [string]::IsNullOrWhiteSpace([string]$lead.sourceKey)) {
      $allSourceKeys[[string]$lead.sourceKey] = $true
    }
  }
  foreach ($lead in $RankedLeads) {
    if (-not [string]::IsNullOrWhiteSpace([string]$lead.sourceKey)) {
      $allSourceKeys[[string]$lead.sourceKey] = $true
    }
  }

  $coverage = @()
  foreach ($sourceKey in ($allSourceKeys.Keys | Sort-Object)) {
    $profile = $null
    if ($sourceIndex.ContainsKey([string]$sourceKey)) {
      $profile = $sourceIndex[[string]$sourceKey]
    }

    $queryCount = (@($QuerySpecs | Where-Object { $_.sourceKey -eq $sourceKey })).Count
    $rawCount = (@($RawLeads | Where-Object { $_.sourceKey -eq $sourceKey })).Count
    $scoredCount = (@($ScoredLeads | Where-Object { $_.sourceKey -eq $sourceKey })).Count
    $rankedCount = (@($RankedLeads | Where-Object { $_.sourceKey -eq $sourceKey })).Count

    $coverage += [pscustomobject]@{
      sourceKey = [string]$sourceKey
      sourceName = if ($null -ne $profile) { [string]$profile.name } else { [string]$sourceKey }
      sourceType = if ($null -ne $profile) { [string]$profile.sourceType } else { "unknown" }
      queryCount = $queryCount
      rawItems = $rawCount
      uniqueLeads = $scoredCount
      rankedLeads = $rankedCount
    }
  }

  return @(
    $coverage |
      Sort-Object @{ Expression = { $_.rawItems }; Descending = $true }, @{ Expression = { $_.rankedLeads }; Descending = $true }, @{ Expression = { $_.queryCount }; Descending = $true }
  )
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
  $lines += "- publicSignalLeads: $($Result.summary.publicSignalLeads)"
  $lines += "- minPublicSignalScore: $($Result.summary.minPublicSignalScore)"
  $lines += "- maxPublicSignalLeads: $($Result.summary.maxPublicSignalLeads)"
  $lines += "- configuredSources: $($Result.summary.configuredSources)"
  $lines += "- sourcesWithHits: $($Result.summary.sourcesWithHits)"
  $lines += "- fallbackUsed: $($Result.summary.fallbackUsed)"
  $lines += ""
  $lines += "## Top Leads"
  $lines += ""
  $lines += "| Score | Distress | Govt | Class | Source | City | Title | Domain | URL |"
  $lines += "| ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |"
  foreach ($lead in $Result.topLeads) {
    $lines += "| $($lead.leadScore) | $($lead.distressScore) | $($lead.governmentDistressScore) | $($lead.classification) | $($lead.sourceName) | $($lead.cityHint) | $($lead.title) | $($lead.domain) | $($lead.url) |"
  }
  $lines += ""
  $lines += "## Source Coverage"
  $lines += ""
  $lines += "| Source | Type | Queries | Raw Items | Unique Leads | Ranked Leads |"
  $lines += "| --- | --- | ---: | ---: | ---: | ---: |"
  foreach ($source in $Result.sourceCoverage) {
    $lines += "| $($source.sourceName) | $($source.sourceType) | $($source.queryCount) | $($source.rawItems) | $($source.uniqueLeads) | $($source.rankedLeads) |"
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
  "receivership sale" = 14
  "tax deeded" = 15
  "tax defaulted" = 16
  "delinquency" = 12
  "short sale" = 10
  "underutilized" = 8
  "liquidation sale" = 14
}

$preferredDomains = @(
  "loopnet.com",
  "crexi.com",
  "auction.com",
  "commercialcafe.com",
  "costargroup.com",
  "moodyscre.com",
  "costar.com",
  "cbre.com",
  "colliers.com",
  "avisonyoung.com",
  "naiop.org",
  "jll.com",
  "cityfeet.com",
  "cushmanwakefield.com"
)

$governmentDomains = @(
  "maricopa.gov",
  "treasurer.maricopa.gov",
  "recorder.maricopa.gov",
  "mcassessor.maricopa.gov",
  "landsales.maricopa.gov",
  "mcso.org",
  "phoenix.gov",
  "phoenix.legistar.com",
  "glendaleaz.com",
  "avondaleaz.gov",
  "goodyearaz.gov",
  "tolleson.az.gov",
  "surpriseaz.gov",
  "peoriaaz.gov",
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
  "tax deed sale" = 14
  "tax deeded property" = 14
  "treasurer sale" = 12
  "public auction" = 10
  "zoning hearing" = 8
  "special use permit" = 8
  "site plan review" = 8
  "planning commission" = 8
  "code compliance" = 8
}

$sourceTrustWeights = @{
  "listing_marketplace" = 8
  "auction_marketplace" = 10
  "government_tax" = 18
  "government_legal" = 16
  "government_auction" = 14
  "government_data" = 12
  "government_planning" = 10
  "broker_research" = 8
  "industry_research" = 7
  "public_signal" = 20
  "community_signal" = 3
  "fallback" = 4
}

$sourceProfiles = @(
  [pscustomobject]@{
    key = "loopnet_listings"
    name = "LoopNet Listings"
    sourceType = "listing_marketplace"
    domains = @("loopnet.com")
    cityQueryPatterns = @(
      "site:loopnet.com {CITY} AZ industrial warehouse for lease",
      "site:loopnet.com {CITY} AZ industrial warehouse for sale",
      "site:loopnet.com {CITY} AZ flex industrial space"
    )
    regionQueryPatterns = @(
      "site:loopnet.com Maricopa County industrial warehouse opportunities"
    )
  },
  [pscustomobject]@{
    key = "crexi_listings"
    name = "CREXi Listings"
    sourceType = "listing_marketplace"
    domains = @("crexi.com")
    cityQueryPatterns = @(
      "site:crexi.com {CITY} AZ industrial property for sale",
      "site:crexi.com {CITY} AZ industrial property for lease",
      "site:crexi.com {CITY} AZ warehouse vacant sublease"
    )
    regionQueryPatterns = @(
      "site:crexi.com Phoenix metro industrial investment sale"
    )
  },
  [pscustomobject]@{
    key = "auctioncom_distress"
    name = "Auction.com Distressed Inventory"
    sourceType = "auction_marketplace"
    domains = @("auction.com")
    cityQueryPatterns = @(
      "site:auction.com {CITY} AZ foreclosure industrial property",
      "site:auction.com {CITY} AZ bank owned commercial property"
    )
    regionQueryPatterns = @(
      "site:auction.com Maricopa County commercial auction property"
    )
  },
  [pscustomobject]@{
    key = "commercialcafe_listings"
    name = "CommercialCafe Listings"
    sourceType = "listing_marketplace"
    domains = @("commercialcafe.com")
    cityQueryPatterns = @(
      "site:commercialcafe.com {CITY} AZ industrial for lease",
      "site:commercialcafe.com {CITY} AZ warehouse for sale"
    )
    regionQueryPatterns = @(
      "site:commercialcafe.com Phoenix industrial market listings"
    )
  },
  [pscustomobject]@{
    key = "maricopa_treasurer_tax_lien"
    name = "Maricopa Treasurer Tax Lien"
    sourceType = "government_tax"
    domains = @("treasurer.maricopa.gov", "maricopa.gov")
    cityQueryPatterns = @()
    regionQueryPatterns = @(
      "site:treasurer.maricopa.gov maricopa county tax lien sale",
      "site:treasurer.maricopa.gov delinquent property tax list",
      "site:maricopa.gov treasurer delinquent taxes industrial"
    )
  },
  [pscustomobject]@{
    key = "maricopa_tax_deeded_land_sales"
    name = "Maricopa Tax Deeded Land Sales"
    sourceType = "government_tax"
    domains = @("landsales.maricopa.gov", "maricopa.gov")
    cityQueryPatterns = @()
    regionQueryPatterns = @(
      "site:landsales.maricopa.gov tax deed sale list maricopa county",
      "site:maricopa.gov tax deeded land sale industrial"
    )
  },
  [pscustomobject]@{
    key = "maricopa_recorder_trustee_sales"
    name = "Maricopa Recorder Trustee Notices"
    sourceType = "government_legal"
    domains = @("recorder.maricopa.gov", "maricopa.gov")
    cityQueryPatterns = @()
    regionQueryPatterns = @(
      "site:recorder.maricopa.gov notice of trustee sale",
      "site:recorder.maricopa.gov lis pendens maricopa county",
      "site:maricopa.gov recorder trustee sale industrial property"
    )
  },
  [pscustomobject]@{
    key = "mcso_tax_and_sheriff_sales"
    name = "MCSO Sheriff Sales"
    sourceType = "government_auction"
    domains = @("mcso.org")
    cityQueryPatterns = @()
    regionQueryPatterns = @(
      "site:mcso.org sheriff sale maricopa county property",
      "site:mcso.org foreclosure auction list"
    )
  },
  [pscustomobject]@{
    key = "maricopa_assessor_parcel_signals"
    name = "Maricopa Assessor Parcel Signals"
    sourceType = "government_data"
    domains = @("mcassessor.maricopa.gov")
    cityQueryPatterns = @(
      "site:mcassessor.maricopa.gov {CITY} parcel search industrial",
      "site:mcassessor.maricopa.gov {CITY} property detail warehouse"
    )
    regionQueryPatterns = @(
      "site:mcassessor.maricopa.gov parcel map maricopa industrial property"
    )
  },
  [pscustomobject]@{
    key = "maricopa_county_auctions_leases"
    name = "Maricopa County Auctions and Leases"
    sourceType = "government_auction"
    domains = @("maricopa.gov")
    cityQueryPatterns = @()
    regionQueryPatterns = @(
      "site:maricopa.gov county auction surplus real property",
      "site:maricopa.gov county lease industrial property",
      "site:maricopa.gov procurement real estate opportunities"
    )
  },
  [pscustomobject]@{
    key = "phoenix_permitting_and_planning"
    name = "City Planning and Permitting Signals"
    sourceType = "government_planning"
    domains = @("phoenix.gov", "phoenix.legistar.com", "glendaleaz.com", "goodyearaz.gov", "avondaleaz.gov", "tolleson.az.gov")
    cityQueryPatterns = @(
      "site:phoenix.gov {CITY} industrial zoning case",
      "site:phoenix.gov {CITY} planning commission industrial",
      "site:phoenix.gov {CITY} code enforcement warehouse",
      "site:glendaleaz.com {CITY} industrial development review",
      "site:goodyearaz.gov {CITY} industrial permit",
      "site:avondaleaz.gov {CITY} industrial permit",
      "site:tolleson.az.gov {CITY} industrial planning"
    )
    regionQueryPatterns = @(
      "site:phoenix.gov industrial rezoning hearing",
      "site:phoenix.legistar.com industrial development case",
      "site:phoenix.gov vacant building code violation industrial"
    )
  },
  [pscustomobject]@{
    key = "cbre_market_reports"
    name = "CBRE Market Reports"
    sourceType = "broker_research"
    domains = @("cbre.com")
    cityQueryPatterns = @()
    regionQueryPatterns = @(
      "site:cbre.com Phoenix industrial market report",
      "site:cbre.com Phoenix west valley industrial vacancy rent"
    )
  },
  [pscustomobject]@{
    key = "colliers_market_reports"
    name = "Colliers Market Reports"
    sourceType = "broker_research"
    domains = @("colliers.com")
    cityQueryPatterns = @()
    regionQueryPatterns = @(
      "site:colliers.com Phoenix industrial market report",
      "site:colliers.com Arizona industrial trends vacancy"
    )
  },
  [pscustomobject]@{
    key = "avison_young_market_reports"
    name = "Avison Young Market Reports"
    sourceType = "broker_research"
    domains = @("avisonyoung.com")
    cityQueryPatterns = @()
    regionQueryPatterns = @(
      "site:avisonyoung.com Phoenix industrial market report",
      "site:avisonyoung.com Arizona industrial warehouse outlook"
    )
  },
  [pscustomobject]@{
    key = "naiop_market_reports"
    name = "NAIOP Market Reports"
    sourceType = "industry_research"
    domains = @("naiop.org")
    cityQueryPatterns = @()
    regionQueryPatterns = @(
      "site:naiop.org Phoenix industrial market",
      "site:naiop.org Arizona commercial real estate outlook"
    )
  }
)

$querySpecs = New-Object System.Collections.Generic.List[object]
foreach ($profile in $sourceProfiles) {
  Add-QuerySpecsFromSourceProfile -QuerySpecs $querySpecs -Profile $profile -Cities $Cities
}

$specDedup = @{}
foreach ($spec in $querySpecs) {
  $key = ("{0}|{1}" -f [string]$spec.sourceKey, [string]$spec.query).ToLowerInvariant()
  if (-not $specDedup.ContainsKey($key)) {
    $specDedup[$key] = $spec
  }
}
$querySpecs = [System.Collections.Generic.List[object]]::new()
foreach ($spec in ($specDedup.Values | Sort-Object sourceKey, query)) {
  [void]$querySpecs.Add($spec)
}

$rawLeads = @()
foreach ($querySpec in $querySpecs) {
  $rawLeads += Invoke-BingRssSearch -Query $querySpec.query -MaxItems $MaxResultsPerQuery -SourceKey $querySpec.sourceKey -SourceName $querySpec.sourceName -SourceType $querySpec.sourceType -SourceDomains $querySpec.sourceDomains
}

$publicSignalLeads = Get-LeadsFromPublicSignals -Path $PublicSignalsPath -MinSignalScore $MinPublicSignalScore -MaxLeads $MaxPublicSignalLeads
if ($publicSignalLeads.Count -gt 0) {
  $rawLeads += $publicSignalLeads
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
  $sourceDomains = @()
  if ($null -ne $lead.sourceDomains) {
    $sourceDomains = @($lead.sourceDomains | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  }
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
  $sourceDomainScore = if (Test-DomainMatch -DomainHost $domain -Candidates $sourceDomains) { 4 } else { 0 }
  $governmentDomainScore = if (Test-DomainMatch -DomainHost $domain -Candidates $governmentDomains) { 10 } else { 0 }
  $sourceTypeScore = 0
  if (-not [string]::IsNullOrWhiteSpace([string]$lead.sourceType) -and $sourceTrustWeights.ContainsKey([string]$lead.sourceType)) {
    $sourceTypeScore = [int]$sourceTrustWeights[[string]$lead.sourceType]
  }

  $cityScore = if ([string]::IsNullOrWhiteSpace($cityHint)) { 0 } else { 8 }
  $baseLeadScore = 0
  try {
    $baseLeadScore = [int]$lead.baseLeadScore
  } catch {
    $baseLeadScore = 0
  }
  $governmentDistressScore = $governmentSignals.score + $governmentDomainScore
  $leadScore = $baseLeadScore + $fit.score + $distress.score + $domainScore + $sourceDomainScore + $sourceTypeScore + $cityScore + $governmentDistressScore
  $classification = Get-LeadClassification -LeadScore $leadScore -DistressScore $distress.score -GovernmentDistressScore $governmentDistressScore

  $scored += [pscustomobject]@{
    title = $lead.title
    url = $lead.url
    summary = $lead.summary
    publishedAt = $lead.publishedAt
    sourceQuery = $lead.sourceQuery
    sourceKey = [string]$lead.sourceKey
    sourceName = [string]$lead.sourceName
    sourceType = [string]$lead.sourceType
    sourceDomains = $sourceDomains
    signalType = [string]$lead.signalType
    distressStage = [string]$lead.distressStage
    parcelId = [string]$lead.parcelId
    ownerName = [string]$lead.ownerName
    domain = $domain
    cityHint = $cityHint
    fitScore = $fit.score
    distressScore = $distress.score
    governmentDistressScore = $governmentDistressScore
    baseLeadScore = $baseLeadScore
    domainScore = $domainScore
    sourceDomainScore = $sourceDomainScore
    sourceTypeScore = $sourceTypeScore
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

$latestMacroContext = $null
if (Test-Path $MacroContextPath) {
  try {
    $macroDoc = Get-Content -Raw $MacroContextPath | ConvertFrom-Json
    if ($null -ne $macroDoc) {
      $latestMacroContext = [pscustomobject]@{
        file = (Resolve-Path $MacroContextPath).Path
        generatedAtUtc = [string]$macroDoc.generatedAtUtc
        creIndexLatest = $macroDoc.crePriceIndex.latest
        creIndexYoYPct = $macroDoc.crePriceIndex.yoyPct
        fedFundsLatest = $macroDoc.fedFunds.latest
      }
    }
  } catch {
    $latestMacroContext = $null
  }
}

$sourceCoverage = Build-SourceCoverage -SourceProfiles $sourceProfiles -QuerySpecs @($querySpecs.ToArray()) -RawLeads $rawLeads -ScoredLeads $scored -RankedLeads $ranked

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$result = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  summary = [pscustomobject]@{
    totalQueries = $querySpecs.Count
    rawItems = $rawLeads.Count
    uniqueLeads = $deduped.Count
    leadsAboveThreshold = $ranked.Count
    distressOpportunities = (@($ranked | Where-Object { $_.classification -eq "distress_opportunity" })).Count
    governmentDistressSignals = (@($ranked | Where-Object { $_.governmentDistressScore -gt 0 })).Count
    publicSignalLeads = $publicSignalLeads.Count
    minPublicSignalScore = $MinPublicSignalScore
    maxPublicSignalLeads = $MaxPublicSignalLeads
    macroContextLoaded = ($null -ne $latestMacroContext)
    configuredSources = $sourceProfiles.Count
    sourcesWithHits = (@($sourceCoverage | Where-Object { $_.rawItems -gt 0 })).Count
    fallbackUsed = $fallbackUsed
  }
  sourceCoverage = $sourceCoverage
  queries = @($querySpecs.ToArray())
  topLeads = $ranked
  swarmContext = [pscustomobject]@{
    objective = "Proactively identify local industrial expansion opportunities and distressed-market conditions."
    marketArea = $MarketAreaLabel
    latestQuarterContext = $latestQuarterContext
    latestMacroContext = $latestMacroContext
    publicSignalsPath = if (Test-Path $PublicSignalsPath) { (Resolve-Path $PublicSignalsPath).Path } else { $PublicSignalsPath }
    sourceCoverage = $sourceCoverage
    leadSelectionRules = [pscustomobject]@{
      minLeadScore = $MinLeadScore
      top = $Top
      prioritizeDistress = $true
    }
    nextActions = @(
      "Validate listing status and current ask against broker or listing portal.",
      "Prioritize leads with classification=distress_opportunity for immediate outreach.",
      "Cross-check top leads against Maricopa Treasurer tax-lien and tax-deed sources before outreach.",
      "Use parcel-centric public signal context (tax, legal, code, utility, permit, CMBS) to prioritize negotiation order.",
      "Pull recorder notice + MCSO auction context for leads carrying foreclosure or trustee-sale signals.",
      "Pull assessor parcel-level history for leads carrying governmentDistressScore > 0.",
      "Review Phoenix and West Valley permitting/planning feeds for zoning or code signals near shortlisted assets.",
      "Request rent roll and concessions where price-reduced or vacancy language appears.",
      "Compare each shortlisted lead against latest quarterly medians before LOI strategy.",
      "Use macro context (rates + CRE index trend) to bias outreach timing and offer aggressiveness.",
      "Refresh broker and NAIOP reports monthly to detect vacancy/rent inflections before they hit listing portals."
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
