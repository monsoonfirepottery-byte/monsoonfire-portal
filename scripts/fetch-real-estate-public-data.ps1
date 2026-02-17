param(
  [string]$OutDir = "output/real-estate/public-data"
)

$ErrorActionPreference = "Stop"

function Save-Json {
  param(
    [object]$Data,
    [string]$Path
  )
  $Data | ConvertTo-Json -Depth 20 | Set-Content -Path $Path -Encoding UTF8
}

function Resolve-SourceUrl {
  param([pscustomobject]$Source)

  if ($null -eq $Source) { return "" }
  $urlEnv = [string]$Source.urlEnv
  if (-not [string]::IsNullOrWhiteSpace($urlEnv)) {
    $fromEnv = [Environment]::GetEnvironmentVariable($urlEnv)
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
      return [string]$fromEnv
    }
  }
  $key = [string]$Source.key
  if (-not [string]::IsNullOrWhiteSpace($key)) {
    $derivedEnv = "REAL_ESTATE_SRC_{0}_URL" -f (([string]$key).ToUpperInvariant() -replace "[^A-Z0-9]", "_")
    $derivedValue = [Environment]::GetEnvironmentVariable($derivedEnv)
    if (-not [string]::IsNullOrWhiteSpace($derivedValue)) {
      return [string]$derivedValue
    }
  }
  return [string]$Source.url
}

function Resolve-AuthCredentialValues {
  param([pscustomobject]$Source)

  $values = New-Object System.Collections.Generic.List[string]
  $envNames = @()

  if ($null -ne $Source.credentialEnvs) {
    $envNames += @($Source.credentialEnvs | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$Source.credentialEnv)) {
    $envNames += @([string]$Source.credentialEnv)
  }

  foreach ($envName in $envNames) {
    $value = [Environment]::GetEnvironmentVariable($envName)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      [void]$values.Add([string]$value)
    }
  }

  if (-not [string]::IsNullOrWhiteSpace([string]$Source.credentialValuesEnv)) {
    $packed = [Environment]::GetEnvironmentVariable([string]$Source.credentialValuesEnv)
    if (-not [string]::IsNullOrWhiteSpace($packed)) {
      foreach ($part in ($packed -split "[,;]")) {
        $trimmed = [string]$part
        if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
          [void]$values.Add($trimmed.Trim())
        }
      }
    }
  }

  return @($values | Select-Object -Unique)
}

function New-RequestPlan {
  param(
    [string]$Url,
    [hashtable]$Headers,
    [string]$AuthMode,
    [string]$AuthRef
  )
  return [pscustomobject]@{
    url = $Url
    headers = $Headers
    authMode = $AuthMode
    authRef = $AuthRef
  }
}

function Build-RequestPlans {
  param(
    [pscustomobject]$Source,
    [hashtable]$BaseHeaders
  )

  $url = Resolve-SourceUrl -Source $Source
  $plans = New-Object System.Collections.Generic.List[object]

  $authType = ([string]$Source.authType).ToLowerInvariant()
  $authRequired = $false
  if ($null -ne $Source.authRequired) {
    $authRequired = [bool]$Source.authRequired
  }
  $credentials = @(Resolve-AuthCredentialValues -Source $Source)

  if ([string]::IsNullOrWhiteSpace($authType) -or $credentials.Count -eq 0) {
    [void]$plans.Add((New-RequestPlan -Url $url -Headers $BaseHeaders -AuthMode "none" -AuthRef "none"))
    return @($plans.ToArray())
  }

  $index = 0
  foreach ($credential in $credentials) {
    $index += 1
    $headers = @{}
    foreach ($k in $BaseHeaders.Keys) { $headers[$k] = $BaseHeaders[$k] }
    $requestUrl = $url
    $authRef = "candidate_$index"
    switch ($authType) {
      "bearer" {
        $prefix = if (-not [string]::IsNullOrWhiteSpace([string]$Source.authPrefix)) { [string]$Source.authPrefix } else { "Bearer " }
        $headers["Authorization"] = "$prefix$credential"
      }
      "header" {
        $headerName = if (-not [string]::IsNullOrWhiteSpace([string]$Source.authHeader)) { [string]$Source.authHeader } else { "x-api-key" }
        $headers[$headerName] = [string]$credential
      }
      "cookie" {
        $headers["Cookie"] = [string]$credential
      }
      "query" {
        $param = if (-not [string]::IsNullOrWhiteSpace([string]$Source.authQueryParam)) { [string]$Source.authQueryParam } else { "api_key" }
        $sep = if ($requestUrl -match "\?") { "&" } else { "?" }
        $requestUrl = "$requestUrl$sep$param=$([uri]::EscapeDataString([string]$credential))"
      }
      default {
        $headers["Authorization"] = "Bearer $credential"
      }
    }
    [void]$plans.Add((New-RequestPlan -Url $requestUrl -Headers $headers -AuthMode $authType -AuthRef $authRef))
  }

  if (-not $authRequired) {
    [void]$plans.Add((New-RequestPlan -Url $url -Headers $BaseHeaders -AuthMode "none" -AuthRef "fallback_no_auth"))
  }

  return @($plans.ToArray())
}

function Invoke-SourceFetch {
  param(
    [pscustomobject]$Source,
    [string]$DestinationPath
  )

  try {
    $baseHeaders = @{
      "User-Agent" = "Mozilla/5.0 (compatible; MonsoonFireDataCollector/1.0)"
      "Accept" = "*/*"
    }
    $plans = @(Build-RequestPlans -Source $Source -BaseHeaders $baseHeaders)
    $errors = New-Object System.Collections.Generic.List[string]
    $lastPlan = $null

    foreach ($plan in $plans) {
      $lastPlan = $plan
      try {
        if ([string]$Source.mode -eq "json") {
          $data = Invoke-RestMethod -Method Get -Uri ([string]$plan.url) -TimeoutSec 60 -Headers $plan.headers
          Save-Json -Data $data -Path $DestinationPath
        } elseif ([string]$Source.mode -eq "text") {
          $resp = Invoke-WebRequest -Method Get -Uri ([string]$plan.url) -TimeoutSec 60 -Headers $plan.headers
          [string]$resp.Content | Set-Content -Path $DestinationPath -Encoding UTF8
        } else {
          throw "Unsupported mode: $($Source.mode)"
        }

        $file = Get-Item $DestinationPath
        return [pscustomobject]@{
          key = [string]$Source.key
          name = [string]$Source.name
          url = [string]$plan.url
          mode = [string]$Source.mode
          status = "ok"
          outputFile = $file.FullName
          bytes = $file.Length
          authMode = [string]$plan.authMode
          authRef = [string]$plan.authRef
          attempts = $plans.Count
          error = ""
        }
      } catch {
        [void]$errors.Add(("{0}:{1}" -f [string]$plan.authRef, [string]$_.Exception.Message))
      }
    }

    throw ("All auth attempts failed ({0}): {1}" -f $plans.Count, ($errors -join " | "))
  } catch {
    return [pscustomobject]@{
      key = [string]$Source.key
      name = [string]$Source.name
      url = Resolve-SourceUrl -Source $Source
      mode = [string]$Source.mode
      status = "error"
      outputFile = ""
      bytes = 0
      authMode = ""
      authRef = ""
      attempts = 0
      error = [string]$_.Exception.Message
    }
  }
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$runDir = Join-Path $OutDir $runId
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$sources = @(
  [pscustomobject]@{
    key = "reddit_local_commercial_signals"
    name = "Reddit Local Commercial Signals"
    url = "https://www.reddit.com/search.json?q=(phoenix+warehouse)+(commercial+space)+(sublease)+OR+(business+closing)&sort=new&limit=100"
    mode = "json"
    file = "reddit-local-commercial-signals.json"
  },
  [pscustomobject]@{
    key = "meta_marketplace_community_signals"
    name = "Meta Marketplace Community Signals"
    url = "https://www.facebook.com/marketplace/phoenix/search?query=warehouse%20space"
    authType = "cookie"
    credentialEnvs = @("REAL_ESTATE_SRC_META_MARKETPLACE_COOKIE_PRIMARY", "REAL_ESTATE_SRC_META_MARKETPLACE_COOKIE_SECONDARY")
    credentialValuesEnv = "REAL_ESTATE_SRC_META_MARKETPLACE_COOKIE_ROTATION"
    authRequired = $false
    mode = "text"
    file = "meta-marketplace-community-signals.html"
  },
  [pscustomobject]@{
    key = "grants_gov_opportunities"
    name = "Grants.gov Opportunities"
    url = "https://www.grants.gov/search-grants"
    mode = "text"
    file = "grants-gov-opportunities.html"
  },
  [pscustomobject]@{
    key = "az_commerce_grants_incentives"
    name = "Arizona Commerce Grants and Incentives"
    url = "https://www.azcommerce.com/small-business/financing/"
    mode = "text"
    file = "az-commerce-grants-incentives.html"
  },
  [pscustomobject]@{
    key = "city_phoenix_business_grants_programs"
    name = "City of Phoenix Business Programs"
    url = "https://www.phoenix.gov/eed"
    mode = "text"
    file = "phoenix-business-programs.html"
  },
  [pscustomobject]@{
    key = "sba_grants_and_funding_programs"
    name = "SBA Grants and Funding Programs"
    url = "https://www.sba.gov/funding-programs/grants"
    mode = "text"
    file = "sba-grants-and-funding-programs.html"
  },
  [pscustomobject]@{
    key = "sba_loan_programs"
    name = "SBA Loan Programs"
    url = "https://www.sba.gov/funding-programs/loans"
    mode = "text"
    file = "sba-loan-programs.html"
  },
  [pscustomobject]@{
    key = "sam_gov_contract_opportunities"
    name = "SAM.gov Contract Opportunities"
    url = "https://sam.gov/content/opportunities"
    mode = "text"
    file = "sam-gov-contract-opportunities.html"
  },
  [pscustomobject]@{
    key = "usaspending_assistance_award_explorer"
    name = "USASpending Assistance Award Explorer"
    url = "https://www.usaspending.gov/search/?f=%7B%22award_type_codes%22%3A%5B%2202%22%2C%2203%22%2C%2204%22%2C%2205%22%5D%7D"
    urlEnv = "REAL_ESTATE_SRC_USASPENDING_ASSISTANCE_URL"
    mode = "text"
    file = "usaspending-assistance-award-explorer.html"
  },
  [pscustomobject]@{
    key = "data_gov_business_assistance_catalog"
    name = "Data.gov Business Assistance Catalog Search"
    url = "https://catalog.data.gov/api/3/action/package_search?q=arizona+small+business+grant+procurement&rows=100"
    urlEnv = "REAL_ESTATE_SRC_DATA_GOV_BUSINESS_ASSISTANCE_URL"
    mode = "json"
    file = "data-gov-business-assistance-catalog.json"
  },
  [pscustomobject]@{
    key = "hud_grants_and_funding"
    name = "HUD Grants and Funding Resources"
    url = "https://www.hud.gov/program_offices/spm/gmomgmt/grantsinfo"
    urlEnv = "REAL_ESTATE_SRC_HUD_GRANTS_URL"
    mode = "text"
    file = "hud-grants-and-funding.html"
  },
  [pscustomobject]@{
    key = "eda_grants_and_competitions"
    name = "EDA Grants and Competitions"
    url = "https://www.eda.gov/funding"
    urlEnv = "REAL_ESTATE_SRC_EDA_GRANTS_URL"
    mode = "text"
    file = "eda-grants-and-competitions.html"
  },
  [pscustomobject]@{
    key = "doe_funding_opportunities"
    name = "DOE Funding Opportunities"
    url = "https://www.energy.gov/eere/funding/eere-funding-opportunities"
    urlEnv = "REAL_ESTATE_SRC_DOE_FUNDING_URL"
    mode = "text"
    file = "doe-funding-opportunities.html"
  },
  [pscustomobject]@{
    key = "az_state_procurement_portal"
    name = "Arizona State Procurement Portal"
    url = "https://procure.az.gov/"
    mode = "text"
    file = "az-state-procurement-portal.html"
  },
  [pscustomobject]@{
    key = "city_phoenix_procurement_bids"
    name = "City of Phoenix Procurement and Bids"
    url = "https://www.phoenix.gov/finance/procurement"
    mode = "text"
    file = "phoenix-procurement-bids.html"
  },
  [pscustomobject]@{
    key = "maricopa_county_procurement"
    name = "Maricopa County Procurement Opportunities"
    url = "https://www.maricopa.gov/5561/Current-Bids"
    mode = "text"
    file = "maricopa-county-procurement-bids.html"
  },
  [pscustomobject]@{
    key = "craigslist_pottery_assistance_signals"
    name = "Craigslist Pottery Assistance Signals"
    url = "https://phoenix.craigslist.org/search/jjj?query=pottery+studio+assistant"
    mode = "text"
    file = "craigslist-pottery-assistance-signals.html"
  },
  [pscustomobject]@{
    key = "reddit_pottery_assistance_signals"
    name = "Reddit Pottery Assistance Signals"
    url = "https://www.reddit.com/search.json?q=(phoenix+pottery+assistant)+OR+(ceramic+studio+help)+OR+(kiln+assistant)&sort=new&limit=100"
    mode = "json"
    file = "reddit-pottery-assistance-signals.json"
  },
  [pscustomobject]@{
    key = "az_state_surplus_property_auctions"
    name = "Arizona State Surplus Property"
    url = "https://doa.az.gov/surplus-property"
    mode = "text"
    file = "az-state-surplus-property.html"
  },
  [pscustomobject]@{
    key = "maricopa_local_surplus_property_auctions"
    name = "Maricopa Local Surplus Property"
    url = "https://www.maricopa.gov/5268/Surplus-Properties"
    mode = "text"
    file = "maricopa-local-surplus-properties.html"
  },
  [pscustomobject]@{
    key = "federal_real_property_disposals"
    name = "Federal Real Property Disposals"
    url = "https://realestatesales.gov/"
    mode = "text"
    file = "federal-real-estate-sales.html"
  },
  [pscustomobject]@{
    key = "gsa_auctions_property"
    name = "GSA Auctions Property"
    url = "https://gsaauctions.gov/auctions/home"
    mode = "text"
    file = "gsa-auctions-home.html"
  },
  [pscustomobject]@{
    key = "maricopa_assessor_services"
    name = "Maricopa Assessor ArcGIS Services Directory"
    url = "https://gis.mcassessor.maricopa.gov/arcgis/rest/services?f=pjson"
    mode = "json"
    file = "maricopa-assessor-services.json"
  },
  [pscustomobject]@{
    key = "maricopa_parcels_layer_meta"
    name = "Maricopa Parcels Layer Metadata"
    url = "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0?f=pjson"
    mode = "json"
    file = "maricopa-parcels-layer-meta.json"
  },
  [pscustomobject]@{
    key = "maricopa_parcels_sample"
    name = "Maricopa Parcels Sample Query"
    url = "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0/query?where=1%3D1&outFields=*&resultRecordCount=500&f=pjson"
    mode = "json"
    file = "maricopa-parcels-sample.json"
  },
  [pscustomobject]@{
    key = "maricopa_dynamic_query_service_meta"
    name = "Maricopa Dynamic Query Service Metadata"
    url = "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/MaricopaDynamicQueryService/MapServer?f=pjson"
    mode = "json"
    file = "maricopa-dynamic-query-service-meta.json"
  },
  [pscustomobject]@{
    key = "maricopa_open_data_search"
    name = "Maricopa Open Data Dataset Search"
    url = "https://data-maricopa.opendata.arcgis.com/api/search/v1/collections/dataset/items?limit=500"
    mode = "json"
    file = "maricopa-open-data-search.json"
  },
  [pscustomobject]@{
    key = "maricopa_treasurer_tax_lien_info"
    name = "Maricopa Treasurer Tax Lien Information"
    url = "https://treasurer.maricopa.gov/TaxLienInformation/"
    mode = "text"
    file = "maricopa-treasurer-tax-lien-information.html"
  },
  [pscustomobject]@{
    key = "maricopa_treasurer_reports_page"
    name = "Maricopa Treasurer Reports"
    url = "https://treasurer.maricopa.gov/Reports"
    mode = "text"
    file = "maricopa-treasurer-reports.html"
  },
  [pscustomobject]@{
    key = "maricopa_arizona_tax_sale_portal"
    name = "Maricopa Arizona Tax Sale Portal"
    url = "https://maricopa.arizonataxsale.com/"
    authType = "cookie"
    credentialEnvs = @("REAL_ESTATE_SRC_MARICOPA_TAXSALE_COOKIE_PRIMARY", "REAL_ESTATE_SRC_MARICOPA_TAXSALE_COOKIE_SECONDARY")
    credentialValuesEnv = "REAL_ESTATE_SRC_MARICOPA_TAXSALE_COOKIE_ROTATION"
    authRequired = $false
    mode = "text"
    file = "maricopa-arizona-tax-sale-portal.html"
  },
  [pscustomobject]@{
    key = "maricopa_treasurer_tax_lien_portal"
    name = "Maricopa Treasurer Tax Lien Portal"
    url = "https://treasurer.maricopa.gov/TaxLienWeb/"
    mode = "text"
    file = "maricopa-treasurer-tax-lien-portal.html"
  },
  [pscustomobject]@{
    key = "maricopa_tax_deeded_sales_portal"
    name = "Maricopa Tax Deeded Land Sales Portal"
    url = "https://mcid.maricopa.gov/780/Tax-Deeded-Land-Sales"
    mode = "text"
    file = "maricopa-tax-deeded-land-sales.html"
  },
  [pscustomobject]@{
    key = "maricopa_recorder_document_search"
    name = "Maricopa Recorder Document Search"
    url = "https://recorder.maricopa.gov/recording/document-search.html"
    mode = "text"
    file = "maricopa-recorder-document-search.html"
  },
  [pscustomobject]@{
    key = "mcso_tax_unit"
    name = "MCSO Tax Unit"
    url = "https://www.mcso.org/about-us/judicial-enforcement/tax-unit"
    mode = "text"
    file = "mcso-tax-unit.html"
  },
  [pscustomobject]@{
    key = "arizona_public_access"
    name = "Arizona Courts Public Access"
    url = "https://apps.azcourts.gov/publicaccess/"
    mode = "text"
    file = "arizona-courts-public-access.html"
  },
  [pscustomobject]@{
    key = "phoenix_open_data"
    name = "Phoenix Open Data Portal"
    url = "https://www.phoenixopendata.com/"
    mode = "text"
    file = "phoenix-open-data.html"
  },
  [pscustomobject]@{
    key = "census_acs_maricopa"
    name = "Census ACS Maricopa Snapshot"
    url = "https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E,B25064_001E,B25077_001E&for=county:013&in=state:04"
    mode = "json"
    file = "census-acs-maricopa.json"
  },
  [pscustomobject]@{
    key = "fred_commercial_real_estate_price_index"
    name = "FRED Commercial Real Estate Price Index"
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=COMREPUSQ159N"
    mode = "text"
    file = "fred-comrepusq159n.csv"
  },
  [pscustomobject]@{
    key = "fred_fed_funds_rate"
    name = "FRED Effective Federal Funds Rate"
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS"
    mode = "text"
    file = "fred-fedfunds.csv"
  },
  [pscustomobject]@{
    key = "epa_echo_facility_search_maricopa"
    name = "EPA ECHO Facility Search Maricopa"
    url = "https://echodata.epa.gov/echo/cwa_rest_services.get_facilities?output=JSON&p_st=AZ&p_cnty=Maricopa&responseset=100"
    mode = "json"
    file = "epa-echo-facility-search-maricopa.json"
  },
  [pscustomobject]@{
    key = "fema_nfhl_service_meta"
    name = "FEMA NFHL Service Metadata"
    url = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer?f=pjson"
    mode = "json"
    file = "fema-nfhl-mapserver-meta.json"
  },
  [pscustomobject]@{
    key = "usgs_tnm_products_maricopa_bbox"
    name = "USGS TNM Products (Maricopa BBox)"
    url = "https://tnmaccess.nationalmap.gov/api/v1/products?bbox=-113.0,32.5,-111.0,34.0&max=100"
    mode = "json"
    file = "usgs-tnm-products-maricopa.json"
  }
)

$results = @()
foreach ($source in $sources) {
  $dest = Join-Path $runDir ([string]$source.file)
  $results += Invoke-SourceFetch -Source $source -DestinationPath $dest
}

$manifest = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  outputDir = (Resolve-Path $runDir).Path
  summary = [pscustomobject]@{
    totalSources = $results.Count
    ok = (@($results | Where-Object { $_.status -eq "ok" })).Count
    errors = (@($results | Where-Object { $_.status -eq "error" })).Count
  }
  results = $results
}

$manifestPath = Join-Path $runDir "manifest.json"
$latestPath = Join-Path $OutDir "latest-manifest.json"
Save-Json -Data $manifest -Path $manifestPath
Save-Json -Data $manifest -Path $latestPath

Write-Host "Wrote $manifestPath"
Write-Host "Wrote $latestPath"
