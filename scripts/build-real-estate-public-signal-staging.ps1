param(
  [string]$PublicDataManifestPath = "output/real-estate/public-data/latest-manifest.json",
  [string]$StagingDir = "output/real-estate/staging/public-signals",
  [string]$ManualDropDir = "output/real-estate/manual-drops"
)

$ErrorActionPreference = "Stop"

function Get-SourceResult {
  param(
    [pscustomobject]$Manifest,
    [string]$Key
  )
  if ($null -eq $Manifest -or $null -eq $Manifest.results) { return $null }
  $found = @($Manifest.results | Where-Object { $_.key -eq $Key } | Select-Object -First 1)
  if ($found.Count -eq 0) { return $null }
  return $found[0]
}

function Convert-FromEpochMsToIsoDate {
  param([object]$Value)

  if ($null -eq $Value) { return "" }
  $raw = [string]$Value
  if ([string]::IsNullOrWhiteSpace($raw)) { return "" }

  $epoch = 0.0
  if ([double]::TryParse($raw, [ref]$epoch)) {
    try {
      return ([datetimeoffset]::FromUnixTimeMilliseconds([int64]$epoch)).UtcDateTime.ToString("o")
    } catch {
      return ""
    }
  }

  [datetime]$dt = [datetime]::MinValue
  if ([datetime]::TryParse($raw, [ref]$dt)) {
    return $dt.ToUniversalTime().ToString("o")
  }
  return ""
}

function Parse-LikelyCityFromText {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
  $t = $Text.ToLowerInvariant()
  foreach ($city in @("phoenix", "goodyear", "avondale", "tolleson", "glendale", "peoria", "surprise", "buckeye", "tempe", "mesa", "scottsdale", "chandler")) {
    if ($t -match [regex]::Escape($city)) {
      return (Get-Culture).TextInfo.ToTitleCase($city)
    }
  }
  return ""
}

function Save-Csv {
  param(
    [object[]]$Rows,
    [string]$Path
  )
  if ($null -eq $Rows -or $Rows.Count -eq 0) {
    @() | Export-Csv -Path $Path -NoTypeInformation -Encoding UTF8
    return
  }
  $Rows | Export-Csv -Path $Path -NoTypeInformation -Encoding UTF8
}

function Extract-HttpLinks {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
  return @([regex]::Matches($Text, "https?://[^""'\s>]+") | ForEach-Object { [string]$_.Value })
}

function Get-UrlsFromSourceResult {
  param([pscustomobject]$SourceResult)

  if ($null -eq $SourceResult) { return @() }
  if ($SourceResult.status -ne "ok") { return @() }
  if ([string]::IsNullOrWhiteSpace([string]$SourceResult.outputFile) -or -not (Test-Path $SourceResult.outputFile)) { return @() }

  $mode = ([string]$SourceResult.mode).ToLowerInvariant()
  if ($mode -eq "json") {
    $raw = Get-Content -Raw $SourceResult.outputFile
    return @(
      Extract-HttpLinks -Text $raw |
        Sort-Object -Unique
    )
  }

  $html = Get-Content -Raw $SourceResult.outputFile
  return @(
    Extract-HttpLinks -Text $html |
      Sort-Object -Unique
  )
}

function Should-IncludeOpportunityUrl {
  param(
    [string]$Url,
    [string]$Kind
  )

  if ([string]::IsNullOrWhiteSpace($Url)) { return $false }
  $u = $Url.ToLowerInvariant()

  foreach ($blocked in @(
    "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com",
    "fonts.googleapis.com", "fonts.gstatic.com", "googletagmanager.com",
    "google-analytics.com", "doubleclick.net", "cdn.jsdelivr.net",
    "newrelic.com", "audioeye.com"
  )) {
    if ($u -like "*$blocked*") { return $false }
  }

  if ($Kind -eq "auction") {
    if ($u -notmatch "(auction|surplus|real.?estate|property|disposal|sale|bid|govdeals|gsa|taxsale)") {
      return $false
    }
  }

  if ($Kind -eq "grant") {
    if ($u -notmatch "(grant|funding|incentive|program|opportunit|awards|capital|loan)") {
      return $false
    }
  }

  return $true
}

function Ensure-ManualDropTemplate {
  param(
    [string]$Path,
    [string]$SignalType,
    [string]$DistressStage
  )

  if (Test-Path $Path) { return }

  $templateRow = [pscustomobject]@{
    parcel = ""
    owner_name = ""
    property_address = ""
    city = ""
    state = "AZ"
    postal_code = ""
    signal_type = $SignalType
    distress_stage = $DistressStage
    amount = ""
    event_date = ""
    case_number = ""
    record_url = ""
    notes = ""
  }
  @($templateRow) | Export-Csv -Path $Path -NoTypeInformation -Encoding UTF8
}

if (-not (Test-Path $PublicDataManifestPath)) {
  throw "Public data manifest not found: $PublicDataManifestPath"
}

$manifest = Get-Content -Raw $PublicDataManifestPath | ConvertFrom-Json
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
New-Item -ItemType Directory -Path $ManualDropDir -Force | Out-Null

$summary = New-Object System.Collections.Generic.List[object]

# 1) Assessor ownership history staging from parcel sample JSON
$parcelSource = Get-SourceResult -Manifest $manifest -Key "maricopa_parcels_sample"
if ($null -ne $parcelSource -and $parcelSource.status -eq "ok" -and (Test-Path $parcelSource.outputFile)) {
  $parcelDoc = Get-Content -Raw $parcelSource.outputFile | ConvertFrom-Json
  $rows = @()
  foreach ($feature in @($parcelDoc.features)) {
    $a = $feature.attributes
    $parcel = if (-not [string]::IsNullOrWhiteSpace([string]$a.APN_DASH)) { [string]$a.APN_DASH } else { [string]$a.APN }
    $saleDateIso = Convert-FromEpochMsToIsoDate $a.SALE_DATE
    if ([string]::IsNullOrWhiteSpace($parcel)) { continue }

    $rows += [pscustomobject]@{
      parcel = $parcel
      owner_name = [string]$a.OWNER_NAME
      property_address = [string]$a.PHYSICAL_ADDRESS
      city = [string]$a.PHYSICAL_CITY
      state = "AZ"
      postal_code = [string]$a.PHYSICAL_ZIP
      signal_type = "ownership_transfer"
      distress_stage = "monitoring"
      amount = [string]$a.SALE_PRICE
      event_date = $saleDateIso
      case_number = [string]$a.DEED_NUMBER
      record_url = ""
      notes = "assessor parcel sample"
    }
  }

  $path = Join-Path $StagingDir "maricopa_assessor_ownership_history.csv"
  Save-Csv -Rows $rows -Path $path
  $summary.Add([pscustomobject]@{
    sourceKey = "maricopa_assessor_ownership_history"
    mode = "staged"
    rowCount = $rows.Count
    outputPath = $path
    notes = "Derived from assessor parcel sample JSON."
  }) | Out-Null
}

# 2) Open data dataset discovery mapped to permitting/code/environment signals
$openDataSource = Get-SourceResult -Manifest $manifest -Key "maricopa_open_data_search"
if ($null -ne $openDataSource -and $openDataSource.status -eq "ok" -and (Test-Path $openDataSource.outputFile)) {
  $openDoc = Get-Content -Raw $openDataSource.outputFile | ConvertFrom-Json
  $features = @()
  if ($null -ne $openDoc.features) {
    $features = @($openDoc.features)
  }

  $permRows = @()
  $codeRows = @()
  $envRows = @()

  foreach ($feature in $features) {
    $p = $feature.properties
    if ($null -eq $p) { continue }

    $title = [string]$p.title
    $desc = [string]$p.description
    $snippet = [string]$p.snippet
    $text = @($title, $desc, $snippet) -join " "
    $lower = $text.ToLowerInvariant()
    $city = Parse-LikelyCityFromText -Text $text
    $url = [string]$p.url
    if ([string]::IsNullOrWhiteSpace($url)) {
      $url = "https://data-maricopa.opendata.arcgis.com/datasets/$([string]$p.id)"
    }
    $eventDateIso = Convert-FromEpochMsToIsoDate $p.modified

    if ($lower -match "permit|planning|zoning|development|site plan|rezon") {
      $permRows += [pscustomobject]@{
        parcel = ""
        owner_name = [string]$p.owner
        property_address = ""
        city = $city
        state = "AZ"
        postal_code = ""
        signal_type = "permit_supply"
        distress_stage = "pipeline"
        amount = ""
        event_date = $eventDateIso
        case_number = [string]$p.id
        record_url = $url
        notes = $title
      }
    }

    if ($lower -match "code enforcement|violation|nuisance|abatement|unsafe building") {
      $codeRows += [pscustomobject]@{
        parcel = ""
        owner_name = [string]$p.owner
        property_address = ""
        city = $city
        state = "AZ"
        postal_code = ""
        signal_type = "code_enforcement"
        distress_stage = "active_case"
        amount = ""
        event_date = $eventDateIso
        case_number = [string]$p.id
        record_url = $url
        notes = $title
      }
    }

    if ($lower -match "flood|hazard|environment|contaminat|superfund|air quality|water quality|land use") {
      $envRows += [pscustomobject]@{
        parcel = ""
        owner_name = [string]$p.owner
        property_address = ""
        city = $city
        state = "AZ"
        postal_code = ""
        signal_type = "environmental_constraint"
        distress_stage = "monitoring"
        amount = ""
        event_date = $eventDateIso
        case_number = [string]$p.id
        record_url = $url
        notes = $title
      }
    }
  }

  $permPath = Join-Path $StagingDir "phoenix_west_valley_permitting_pipeline.csv"
  $codePath = Join-Path $StagingDir "west_valley_code_enforcement.csv"
  $envPath = Join-Path $StagingDir "environmental_land_use_constraints.csv"
  Save-Csv -Rows $permRows -Path $permPath
  Save-Csv -Rows $codeRows -Path $codePath
  Save-Csv -Rows $envRows -Path $envPath

  $summary.Add([pscustomobject]@{
    sourceKey = "phoenix_west_valley_permitting_pipeline"
    mode = "staged"
    rowCount = $permRows.Count
    outputPath = $permPath
    notes = "Derived from Maricopa Open Data dataset catalog."
  }) | Out-Null
  $summary.Add([pscustomobject]@{
    sourceKey = "west_valley_code_enforcement"
    mode = "staged"
    rowCount = $codeRows.Count
    outputPath = $codePath
    notes = "Derived from Maricopa Open Data dataset catalog."
  }) | Out-Null
  $summary.Add([pscustomobject]@{
    sourceKey = "environmental_land_use_constraints"
    mode = "staged"
    rowCount = $envRows.Count
    outputPath = $envPath
    notes = "Derived from Maricopa Open Data dataset catalog."
  }) | Out-Null
}

# 3) Treasurer + tax deed portal links mapped to tax delinquency watch rows
$treasurerSource = Get-SourceResult -Manifest $manifest -Key "maricopa_treasurer_tax_lien_portal"
$taxDeedSource = Get-SourceResult -Manifest $manifest -Key "maricopa_tax_deeded_sales_portal"
$reportSource = Get-SourceResult -Manifest $manifest -Key "maricopa_treasurer_reports_page"
$taxSaleSource = Get-SourceResult -Manifest $manifest -Key "maricopa_arizona_tax_sale_portal"

$watchLinks = New-Object System.Collections.Generic.HashSet[string]
foreach ($candidate in @($treasurerSource, $taxDeedSource, $reportSource, $taxSaleSource)) {
  if ($null -eq $candidate) { continue }
  if ($candidate.status -ne "ok") { continue }
  if (-not (Test-Path $candidate.outputFile)) { continue }

  $html = Get-Content -Raw $candidate.outputFile
  $matches = [regex]::Matches($html, "https?://[^""'\s>]+")
  foreach ($m in $matches) {
    $url = [string]$m.Value
    if ($url -match "(?i)(tax|lien|delinquent|deed|auction|sale|parcel|report|treasurer|recorder)") {
      [void]$watchLinks.Add($url)
    }
  }
}

$taxRows = @()
$idx = 0
foreach ($link in @($watchLinks | Sort-Object)) {
  $idx += 1
  $taxRows += [pscustomobject]@{
    parcel = ""
    owner_name = ""
    property_address = ""
    city = "Maricopa County"
    state = "AZ"
    postal_code = ""
    signal_type = "tax_delinquent"
    distress_stage = "monitoring"
    amount = ""
    event_date = (Get-Date).ToUniversalTime().ToString("o")
    case_number = "watch-link-$idx"
    record_url = $link
    notes = "treasurer/tax-deed watch source link"
  }
}

$taxPath = Join-Path $StagingDir "maricopa_treasurer_delinquent_roll.csv"
Save-Csv -Rows $taxRows -Path $taxPath
$summary.Add([pscustomobject]@{
  sourceKey = "maricopa_treasurer_delinquent_roll"
  mode = "staged"
  rowCount = $taxRows.Count
  outputPath = $taxPath
  notes = "Derived from treasurer/tax-deed/tax-sale portal links."
}) | Out-Null

# 4) Community signal staging (Reddit + Meta Marketplace)
$redditSource = Get-SourceResult -Manifest $manifest -Key "reddit_local_commercial_signals"
if ($null -ne $redditSource -and $redditSource.status -eq "ok" -and (Test-Path $redditSource.outputFile)) {
  $redditDoc = Get-Content -Raw $redditSource.outputFile | ConvertFrom-Json
  $children = @()
  if ($null -ne $redditDoc.data -and $null -ne $redditDoc.data.children) {
    $children = @($redditDoc.data.children)
  }

  $redditRows = @()
  foreach ($child in $children) {
    $post = $child.data
    if ($null -eq $post) { continue }
    $title = [string]$post.title
    $selfText = [string]$post.selftext
    $subreddit = [string]$post.subreddit
    $fullText = @($title, $selfText, $subreddit) -join " "
    $lower = $fullText.ToLowerInvariant()
    if ($lower -notmatch "(warehouse|commercial|industrial|sublease|lease|rent|eviction|closing|distress|foreclosure|auction|landlord)") {
      continue
    }

    $city = Parse-LikelyCityFromText -Text $fullText
    $eventDateIso = ""
    if ($null -ne $post.created_utc -and [string]$post.created_utc -ne "") {
      $createdSeconds = 0.0
      if ([double]::TryParse([string]$post.created_utc, [ref]$createdSeconds)) {
        $eventDateIso = Convert-FromEpochMsToIsoDate ([int64]([math]::Round($createdSeconds * 1000)))
      }
    }

    $permalink = [string]$post.permalink
    $url = if ([string]::IsNullOrWhiteSpace($permalink)) { [string]$post.url } else { "https://www.reddit.com$permalink" }

    $redditRows += [pscustomobject]@{
      parcel = ""
      owner_name = [string]$post.author
      property_address = ""
      city = $city
      state = "AZ"
      postal_code = ""
      signal_type = "community_signal"
      distress_stage = "monitoring"
      amount = ""
      event_date = $eventDateIso
      case_number = [string]$post.id
      record_url = $url
      notes = $title
    }
  }

  $redditRows = @(
    $redditRows |
      Group-Object record_url |
      ForEach-Object { $_.Group[0] } |
      Select-Object -First 80
  )

  $redditPath = Join-Path $StagingDir "reddit_local_commercial_signals.csv"
  Save-Csv -Rows $redditRows -Path $redditPath
  $summary.Add([pscustomobject]@{
    sourceKey = "reddit_local_commercial_signals"
    mode = "staged"
    rowCount = $redditRows.Count
    outputPath = $redditPath
    notes = "Derived from Reddit search JSON feed."
  }) | Out-Null
}

$metaSource = Get-SourceResult -Manifest $manifest -Key "meta_marketplace_community_signals"
if ($null -ne $metaSource -and $metaSource.status -eq "ok" -and (Test-Path $metaSource.outputFile)) {
  $html = Get-Content -Raw $metaSource.outputFile
  $metaRows = @()

  $pathMatches = [regex]::Matches($html, "/marketplace/item/\d+")
  $itemLinks = @($pathMatches | ForEach-Object { "https://www.facebook.com$($_.Value)" } | Sort-Object -Unique)
  if ($itemLinks.Count -eq 0) {
    $itemLinks = @(
      Extract-HttpLinks -Text $html |
        Where-Object { $_ -match "(?i)facebook\.com/.+marketplace.+(warehouse|industrial|commercial|space|sublease|studio)" } |
        Sort-Object -Unique
    )
  }

  foreach ($link in $itemLinks | Select-Object -First 80) {
    $metaRows += [pscustomobject]@{
      parcel = ""
      owner_name = ""
      property_address = ""
      city = "Phoenix"
      state = "AZ"
      postal_code = ""
      signal_type = "community_signal"
      distress_stage = "monitoring"
      amount = ""
      event_date = (Get-Date).ToUniversalTime().ToString("o")
      case_number = ""
      record_url = [string]$link
      notes = "meta marketplace community listing signal"
    }
  }

  $metaRows = @(
    $metaRows |
      Group-Object record_url |
      ForEach-Object { $_.Group[0] } |
      Select-Object -First 80
  )

  $metaPath = Join-Path $StagingDir "meta_marketplace_community_signals.csv"
  Save-Csv -Rows $metaRows -Path $metaPath
  $summary.Add([pscustomobject]@{
    sourceKey = "meta_marketplace_community_signals"
    mode = "staged"
    rowCount = $metaRows.Count
    outputPath = $metaPath
    notes = "Derived from Meta Marketplace page links when accessible."
  }) | Out-Null
}

# 5) Macro signals from free public datasets
$macroRows = @()
$fredCreSource = Get-SourceResult -Manifest $manifest -Key "fred_commercial_real_estate_price_index"
if ($null -ne $fredCreSource -and $fredCreSource.status -eq "ok" -and (Test-Path $fredCreSource.outputFile)) {
  $rows = Import-Csv -Path $fredCreSource.outputFile | Where-Object { $_.DATE -and $_.COMREPUSQ159N -and $_.COMREPUSQ159N -ne "." }
  if ($rows.Count -gt 0) {
    $latest = $rows[-1]
    $macroRows += [pscustomobject]@{
      source = "fred_comrepusq159n"
      metric = "commercial_real_estate_price_index"
      asOfDate = [string]$latest.DATE
      value = [string]$latest.COMREPUSQ159N
      notes = "FRED national CRE price index (quarterly)."
    }
  }
}
$fredFundsSource = Get-SourceResult -Manifest $manifest -Key "fred_fed_funds_rate"
if ($null -ne $fredFundsSource -and $fredFundsSource.status -eq "ok" -and (Test-Path $fredFundsSource.outputFile)) {
  $rows = Import-Csv -Path $fredFundsSource.outputFile | Where-Object { $_.DATE -and $_.FEDFUNDS -and $_.FEDFUNDS -ne "." }
  if ($rows.Count -gt 0) {
    $latest = $rows[-1]
    $macroRows += [pscustomobject]@{
      source = "fred_fedfunds"
      metric = "effective_fed_funds_rate"
      asOfDate = [string]$latest.DATE
      value = [string]$latest.FEDFUNDS
      notes = "FRED effective federal funds rate (monthly)."
    }
  }
}
$acsSource = Get-SourceResult -Manifest $manifest -Key "census_acs_maricopa"
if ($null -ne $acsSource -and $acsSource.status -eq "ok" -and (Test-Path $acsSource.outputFile)) {
  $acs = Get-Content -Raw $acsSource.outputFile | ConvertFrom-Json
  if ($acs.Count -ge 2) {
    $header = @($acs[0])
    $row = @($acs[1])
    $lookup = @{}
    for ($i = 0; $i -lt $header.Count; $i++) {
      $lookup[[string]$header[$i]] = [string]$row[$i]
    }

    $macroRows += [pscustomobject]@{
      source = "census_acs"
      metric = "maricopa_population"
      asOfDate = "2023"
      value = [string]$lookup["B01003_001E"]
      notes = [string]$lookup["NAME"]
    }
    $macroRows += [pscustomobject]@{
      source = "census_acs"
      metric = "maricopa_median_gross_rent"
      asOfDate = "2023"
      value = [string]$lookup["B25064_001E"]
      notes = [string]$lookup["NAME"]
    }
    $macroRows += [pscustomobject]@{
      source = "census_acs"
      metric = "maricopa_median_home_value"
      asOfDate = "2023"
      value = [string]$lookup["B25077_001E"]
      notes = [string]$lookup["NAME"]
    }
  }
}

$macroPath = Join-Path $StagingDir "macro-context.csv"
Save-Csv -Rows $macroRows -Path $macroPath
$summary.Add([pscustomobject]@{
  sourceKey = "macro_context"
  mode = "staged"
  rowCount = $macroRows.Count
  outputPath = $macroPath
  notes = "Derived from FRED + Census free public data."
}) | Out-Null

# 6) Government auctions staging (state/local/federal)
$auctionSourceKeys = @(
  "az_state_surplus_property_auctions",
  "maricopa_local_surplus_property_auctions",
  "federal_real_property_disposals",
  "gsa_auctions_property"
)
$auctionLinks = New-Object System.Collections.Generic.List[object]
foreach ($key in $auctionSourceKeys) {
  $src = Get-SourceResult -Manifest $manifest -Key $key
  if ($null -eq $src) { continue }
  foreach ($url in (Get-UrlsFromSourceResult -SourceResult $src)) {
    if ((Should-IncludeOpportunityUrl -Url $url -Kind "auction") -and ($url -match "(?i)(auction|surplus|real.?estate|property|disposal|sale|bid|govdeals|gsa)")) {
      $auctionLinks.Add([pscustomobject]@{
        sourceKey = $key
        url = $url
      }) | Out-Null
    }
  }
}

$auctionRowsBySource = @{
  "az_state_surplus_property_auctions" = @()
  "maricopa_local_surplus_property_auctions" = @()
  "federal_real_property_disposals" = @()
}
foreach ($item in $auctionLinks) {
  $mappedSource = [string]$item.sourceKey
  if ($mappedSource -eq "gsa_auctions_property") {
    $mappedSource = "federal_real_property_disposals"
  }
  if (-not $auctionRowsBySource.ContainsKey($mappedSource)) {
    continue
  }
  $city = if ($mappedSource -eq "federal_real_property_disposals") { "" } elseif ($mappedSource -eq "maricopa_local_surplus_property_auctions") { "Maricopa County" } else { "Arizona" }
  $auctionRowsBySource[$mappedSource] += [pscustomobject]@{
    parcel = ""
    owner_name = ""
    property_address = ""
    city = $city
    state = "AZ"
    postal_code = ""
    signal_type = "government_auction_opportunity"
    distress_stage = "auction_scheduled"
    amount = ""
    event_date = (Get-Date).ToUniversalTime().ToString("o")
    case_number = ""
    record_url = [string]$item.url
    notes = "government auction watch link"
  }
}

$auctionSourceKeysSnapshot = @($auctionRowsBySource.Keys)
foreach ($sourceKey in $auctionSourceKeysSnapshot) {
  $auctionRowsBySource[$sourceKey] = @(
    $auctionRowsBySource[$sourceKey] |
      Group-Object record_url |
      ForEach-Object { $_.Group[0] } |
      Select-Object -First 40
  )
  $path = Join-Path $StagingDir "$sourceKey.csv"
  Save-Csv -Rows $auctionRowsBySource[$sourceKey] -Path $path
  $summary.Add([pscustomobject]@{
    sourceKey = $sourceKey
    mode = "staged"
    rowCount = $auctionRowsBySource[$sourceKey].Count
    outputPath = $path
    notes = "Derived from free/public government auction pages."
  }) | Out-Null
}

# 7) Grants staging (federal/state/local/business programs)
$grantSourceKeys = @(
  "grants_gov_opportunities",
  "az_commerce_grants_incentives",
  "city_phoenix_business_grants_programs",
  "sba_grants_and_funding_programs",
  "sba_loan_programs",
  "hud_grants_and_funding",
  "eda_grants_and_competitions",
  "doe_funding_opportunities",
  "data_gov_business_assistance_catalog",
  "usaspending_assistance_award_explorer"
)
$grantRowsBySource = @{}
foreach ($sourceKey in $grantSourceKeys) {
  $grantRowsBySource[$sourceKey] = @()
  $src = Get-SourceResult -Manifest $manifest -Key $sourceKey
  if ($null -eq $src) {
    continue
  }
  $urls = Get-UrlsFromSourceResult -SourceResult $src
  foreach ($url in $urls) {
    if ((Should-IncludeOpportunityUrl -Url $url -Kind "grant") -and ($url -match "(?i)(grant|funding|incentive|program|opportunit|awards|capital|loan)")) {
      $grantRowsBySource[$sourceKey] += [pscustomobject]@{
        parcel = ""
        owner_name = ""
        property_address = ""
        city = if ($sourceKey -eq "city_phoenix_business_grants_programs") { "Phoenix" } else { "" }
        state = "AZ"
        postal_code = ""
        signal_type = "grant_opportunity"
        distress_stage = "funding_open"
        amount = ""
        event_date = (Get-Date).ToUniversalTime().ToString("o")
        case_number = ""
        record_url = $url
        notes = "grant/funding opportunity watch link"
      }
    }
  }
}

$grantSourceKeysSnapshot = @($grantRowsBySource.Keys)
foreach ($sourceKey in $grantSourceKeysSnapshot) {
  $grantRowsBySource[$sourceKey] = @(
    $grantRowsBySource[$sourceKey] |
      Group-Object record_url |
      ForEach-Object { $_.Group[0] } |
      Select-Object -First 40
  )
  $path = Join-Path $StagingDir "$sourceKey.csv"
  Save-Csv -Rows $grantRowsBySource[$sourceKey] -Path $path
  $summary.Add([pscustomobject]@{
    sourceKey = $sourceKey
    mode = "staged"
    rowCount = $grantRowsBySource[$sourceKey].Count
    outputPath = $path
    notes = "Derived from free/public grants and funding pages."
  }) | Out-Null
}

# 8) Procurement/buildout opportunity staging
$procurementSourceKeys = @(
  "sam_gov_contract_opportunities",
  "az_state_procurement_portal",
  "city_phoenix_procurement_bids",
  "maricopa_county_procurement"
)
$procRowsBySource = @{}
foreach ($sourceKey in $procurementSourceKeys) {
  $procRowsBySource[$sourceKey] = @()
  $src = Get-SourceResult -Manifest $manifest -Key $sourceKey
  if ($null -eq $src) {
    continue
  }
  foreach ($url in (Get-UrlsFromSourceResult -SourceResult $src)) {
    if ($url -match "(?i)(bid|bids|procure|procurement|rfp|rfi|solicitation|opportunit|contract|tender|vendor)") {
      $procRowsBySource[$sourceKey] += [pscustomobject]@{
        parcel = ""
        owner_name = ""
        property_address = ""
        city = if ($sourceKey -eq "city_phoenix_procurement_bids") { "Phoenix" } elseif ($sourceKey -eq "maricopa_county_procurement") { "Maricopa County" } else { "" }
        state = "AZ"
        postal_code = ""
        signal_type = "procurement_opportunity"
        distress_stage = "funding_open"
        amount = ""
        event_date = (Get-Date).ToUniversalTime().ToString("o")
        case_number = ""
        record_url = $url
        notes = "government procurement/buildout opportunity watch link"
      }
    }
  }
}

$procurementSourceSnapshot = @($procRowsBySource.Keys)
foreach ($sourceKey in $procurementSourceSnapshot) {
  $procRowsBySource[$sourceKey] = @(
    $procRowsBySource[$sourceKey] |
      Group-Object record_url |
      ForEach-Object { $_.Group[0] } |
      Select-Object -First 40
  )
  $path = Join-Path $StagingDir "$sourceKey.csv"
  Save-Csv -Rows $procRowsBySource[$sourceKey] -Path $path
  $summary.Add([pscustomobject]@{
    sourceKey = $sourceKey
    mode = "staged"
    rowCount = $procRowsBySource[$sourceKey].Count
    outputPath = $path
    notes = "Derived from free/public procurement and bid portals."
  }) | Out-Null
}

# 9) Community assistance opportunity staging
$craigslistAssistanceRows = @()
$redditAssistanceRows = @()
$clSource = Get-SourceResult -Manifest $manifest -Key "craigslist_pottery_assistance_signals"
if ($null -ne $clSource) {
  foreach ($url in (Get-UrlsFromSourceResult -SourceResult $clSource)) {
    if ($url -match "(?i)craigslist\.org" -and $url -match "(?i)(potter|pottery|ceramic|kiln|studio|assist|helper|job|gig)") {
      $craigslistAssistanceRows += [pscustomobject]@{
        parcel = ""
        owner_name = "craigslist"
        property_address = ""
        city = "Phoenix"
        state = "AZ"
        postal_code = ""
        signal_type = "community_signal"
        distress_stage = "monitoring"
        amount = ""
        event_date = (Get-Date).ToUniversalTime().ToString("o")
        case_number = ""
        record_url = $url
        notes = "community assistance signal from craigslist"
      }
    }
  }
}

$redditAssistSource = Get-SourceResult -Manifest $manifest -Key "reddit_pottery_assistance_signals"
if ($null -ne $redditAssistSource -and $redditAssistSource.status -eq "ok" -and (Test-Path $redditAssistSource.outputFile)) {
  $redditDoc = Get-Content -Raw $redditAssistSource.outputFile | ConvertFrom-Json
  $children = @()
  if ($null -ne $redditDoc.data -and $null -ne $redditDoc.data.children) {
    $children = @($redditDoc.data.children)
  }
  foreach ($child in $children) {
    $post = $child.data
    if ($null -eq $post) { continue }
    $title = [string]$post.title
    $selfText = [string]$post.selftext
    $fullText = @($title, $selfText, [string]$post.subreddit) -join " "
    if ($fullText.ToLowerInvariant() -notmatch "(assist|assistant|help|potter|pottery|ceramic|kiln|studio)") {
      continue
    }
    $eventDateIso = ""
    if ($null -ne $post.created_utc -and [string]$post.created_utc -ne "") {
      $createdSeconds = 0.0
      if ([double]::TryParse([string]$post.created_utc, [ref]$createdSeconds)) {
        $eventDateIso = Convert-FromEpochMsToIsoDate ([int64]([math]::Round($createdSeconds * 1000)))
      }
    }
    $permalink = [string]$post.permalink
    $url = if ([string]::IsNullOrWhiteSpace($permalink)) { [string]$post.url } else { "https://www.reddit.com$permalink" }

    $redditAssistanceRows += [pscustomobject]@{
      parcel = ""
      owner_name = [string]$post.author
      property_address = ""
      city = Parse-LikelyCityFromText -Text $fullText
      state = "AZ"
      postal_code = ""
      signal_type = "community_signal"
      distress_stage = "monitoring"
      amount = ""
      event_date = $eventDateIso
      case_number = [string]$post.id
      record_url = $url
      notes = $title
    }
  }
}

$craigslistAssistanceRows = @(
  $craigslistAssistanceRows |
    Group-Object record_url |
    ForEach-Object { $_.Group[0] } |
    Select-Object -First 80
)
$redditAssistanceRows = @(
  $redditAssistanceRows |
    Group-Object record_url |
    ForEach-Object { $_.Group[0] } |
    Select-Object -First 80
)

$craigslistAssistancePath = Join-Path $StagingDir "craigslist_pottery_assistance_signals.csv"
Save-Csv -Rows $craigslistAssistanceRows -Path $craigslistAssistancePath
$summary.Add([pscustomobject]@{
  sourceKey = "craigslist_pottery_assistance_signals"
  mode = "staged"
  rowCount = $craigslistAssistanceRows.Count
  outputPath = $craigslistAssistancePath
  notes = "Derived from Craigslist assistance signal feed."
}) | Out-Null

$redditAssistancePath = Join-Path $StagingDir "reddit_pottery_assistance_signals.csv"
Save-Csv -Rows $redditAssistanceRows -Path $redditAssistancePath
$summary.Add([pscustomobject]@{
  sourceKey = "reddit_pottery_assistance_signals"
  mode = "staged"
  rowCount = $redditAssistanceRows.Count
  outputPath = $redditAssistancePath
  notes = "Derived from Reddit assistance signal feed."
}) | Out-Null

# 10) Manual drop templates for blocked/private-ish sources
$templateDefs = @(
  @{ file = "reddit_local_commercial_signals.csv"; signalType = "community_signal"; distressStage = "monitoring" },
  @{ file = "meta_marketplace_community_signals.csv"; signalType = "community_signal"; distressStage = "monitoring" },
  @{ file = "az_state_surplus_property_auctions.csv"; signalType = "government_auction_opportunity"; distressStage = "auction_scheduled" },
  @{ file = "maricopa_local_surplus_property_auctions.csv"; signalType = "government_auction_opportunity"; distressStage = "auction_scheduled" },
  @{ file = "federal_real_property_disposals.csv"; signalType = "government_auction_opportunity"; distressStage = "auction_scheduled" },
  @{ file = "grants_gov_opportunities.csv"; signalType = "grant_opportunity"; distressStage = "funding_open" },
  @{ file = "az_commerce_grants_incentives.csv"; signalType = "grant_opportunity"; distressStage = "funding_open" },
  @{ file = "city_phoenix_business_grants_programs.csv"; signalType = "grant_opportunity"; distressStage = "funding_open" },
  @{ file = "sba_grants_and_funding_programs.csv"; signalType = "grant_opportunity"; distressStage = "funding_open" },
  @{ file = "sba_loan_programs.csv"; signalType = "financial_assistance_rate"; distressStage = "monitoring" },
  @{ file = "hud_grants_and_funding.csv"; signalType = "grant_opportunity"; distressStage = "funding_open" },
  @{ file = "eda_grants_and_competitions.csv"; signalType = "grant_opportunity"; distressStage = "funding_open" },
  @{ file = "doe_funding_opportunities.csv"; signalType = "grant_opportunity"; distressStage = "funding_open" },
  @{ file = "data_gov_business_assistance_catalog.csv"; signalType = "grant_opportunity"; distressStage = "monitoring" },
  @{ file = "usaspending_assistance_award_explorer.csv"; signalType = "financial_assistance_rate"; distressStage = "monitoring" },
  @{ file = "sam_gov_contract_opportunities.csv"; signalType = "procurement_opportunity"; distressStage = "funding_open" },
  @{ file = "az_state_procurement_portal.csv"; signalType = "procurement_opportunity"; distressStage = "funding_open" },
  @{ file = "city_phoenix_procurement_bids.csv"; signalType = "procurement_opportunity"; distressStage = "funding_open" },
  @{ file = "maricopa_county_procurement.csv"; signalType = "procurement_opportunity"; distressStage = "funding_open" },
  @{ file = "craigslist_pottery_assistance_signals.csv"; signalType = "community_signal"; distressStage = "monitoring" },
  @{ file = "reddit_pottery_assistance_signals.csv"; signalType = "community_signal"; distressStage = "monitoring" },
  @{ file = "maricopa_recorder_document_feed.csv"; signalType = "trustee_sale"; distressStage = "notice_filed" },
  @{ file = "arizona_ucc_filings.csv"; signalType = "ucc_distress"; distressStage = "active_case" },
  @{ file = "arizona_bankruptcy_filings.csv"; signalType = "bankruptcy"; distressStage = "active_case" },
  @{ file = "maricopa_civil_court.csv"; signalType = "foreclosure"; distressStage = "active_case" },
  @{ file = "aps_srp_utility_constraints.csv"; signalType = "utility_constraint"; distressStage = "monitoring" },
  @{ file = "lease_comps_vacancy_feeds.csv"; signalType = "rent_comp_signal"; distressStage = "monitoring" },
  @{ file = "cmbs_distress_signals.csv"; signalType = "cmbs_delinquency"; distressStage = "active_case" }
)

foreach ($tpl in $templateDefs) {
  $path = Join-Path $ManualDropDir ([string]$tpl.file)
  Ensure-ManualDropTemplate -Path $path -SignalType ([string]$tpl.signalType) -DistressStage ([string]$tpl.distressStage)
  $summary.Add([pscustomobject]@{
    sourceKey = [System.IO.Path]::GetFileNameWithoutExtension([string]$tpl.file)
    mode = "template"
    rowCount = 1
    outputPath = $path
    notes = "Manual drop template ensured."
  }) | Out-Null
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$out = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  inputs = [pscustomobject]@{
    publicDataManifestPath = (Resolve-Path $PublicDataManifestPath).Path
  }
  outputs = [pscustomobject]@{
    stagingDir = (Resolve-Path $StagingDir).Path
    manualDropDir = (Resolve-Path $ManualDropDir).Path
  }
  summary = [pscustomobject]@{
    rows = $summary.Count
    stagedSources = (@($summary | Where-Object { $_.mode -eq "staged" })).Count
    templateSources = (@($summary | Where-Object { $_.mode -eq "template" })).Count
  }
  items = $summary
}

$jsonPath = Join-Path $StagingDir "staging-manifest-$runId.json"
$latestPath = Join-Path $StagingDir "staging-manifest-latest.json"
$out | ConvertTo-Json -Depth 12 | Set-Content -Path $jsonPath -Encoding UTF8
$out | ConvertTo-Json -Depth 12 | Set-Content -Path $latestPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $latestPath"
