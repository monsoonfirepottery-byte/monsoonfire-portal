param(
  [string]$ManualDropDir = "output/real-estate/manual-drops"
)

$ErrorActionPreference = "Stop"

function Has-MeaningfulRows {
  param([object[]]$Rows)
  if ($null -eq $Rows -or $Rows.Count -eq 0) { return $false }
  foreach ($row in $Rows) {
    if (-not [string]::IsNullOrWhiteSpace([string]$row.record_url)) { return $true }
    if (-not [string]::IsNullOrWhiteSpace([string]$row.case_number)) { return $true }
    if (-not [string]::IsNullOrWhiteSpace([string]$row.parcel)) { return $true }
    if (-not [string]::IsNullOrWhiteSpace([string]$row.owner_name)) { return $true }
  }
  return $false
}

function Write-SeedFileIfNeeded {
  param(
    [string]$Path,
    [object[]]$Rows
  )

  $shouldSeed = $true
  if (Test-Path $Path) {
    $existing = @()
    try {
      $existing = @(Import-Csv -Path $Path)
    } catch {
      $existing = @()
    }
    if (Has-MeaningfulRows -Rows $existing) {
      $shouldSeed = $false
    }
  }

  if ($shouldSeed) {
    $Rows | Export-Csv -Path $Path -NoTypeInformation -Encoding UTF8
    return "seeded"
  }
  return "skipped_existing"
}

New-Item -ItemType Directory -Path $ManualDropDir -Force | Out-Null
$nowIso = (Get-Date).ToUniversalTime().ToString("o")

$seedSpecs = @(
  @{
    file = "reddit_local_commercial_signals.csv"
    rows = @(
      [pscustomobject]@{
        parcel = ""; owner_name = "reddit"; property_address = ""; city = "Phoenix"; state = "AZ"; postal_code = "";
        signal_type = "community_signal"; distress_stage = "monitoring"; amount = ""; event_date = $nowIso;
        case_number = "REDDIT-001"; record_url = "https://www.reddit.com/r/phoenix/"; notes = "Manual fallback for local Reddit signal tracking."
      }
    )
  },
  @{
    file = "meta_marketplace_community_signals.csv"
    rows = @(
      [pscustomobject]@{
        parcel = ""; owner_name = "meta_marketplace"; property_address = ""; city = "Phoenix"; state = "AZ"; postal_code = "";
        signal_type = "community_signal"; distress_stage = "monitoring"; amount = ""; event_date = $nowIso;
        case_number = "META-001"; record_url = "https://www.facebook.com/marketplace/phoenix/"; notes = "Manual fallback for Meta Marketplace local signals."
      }
    )
  },
  @{
    file = "az_state_surplus_property_auctions.csv"
    rows = @(
      [pscustomobject]@{
        parcel = ""; owner_name = "Arizona Department of Administration"; property_address = ""; city = "Arizona"; state = "AZ"; postal_code = "";
        signal_type = "government_auction_opportunity"; distress_stage = "auction_scheduled"; amount = ""; event_date = $nowIso;
        case_number = "AZ-SURPLUS-001"; record_url = "https://doa.az.gov/surplus-property"; notes = "State surplus property landing page."
      },
      [pscustomobject]@{
        parcel = ""; owner_name = "Arizona Surplus Listings"; property_address = ""; city = "Arizona"; state = "AZ"; postal_code = "";
        signal_type = "government_auction_opportunity"; distress_stage = "auction_scheduled"; amount = ""; event_date = $nowIso;
        case_number = "AZ-SURPLUS-002"; record_url = "https://www.publicsurplus.com/sms/arizona,az/list/current?orgid=226"; notes = "Public surplus listing feed."
      }
    )
  },
  @{
    file = "maricopa_local_surplus_property_auctions.csv"
    rows = @(
      [pscustomobject]@{
        parcel = ""; owner_name = "Maricopa County"; property_address = ""; city = "Maricopa County"; state = "AZ"; postal_code = "";
        signal_type = "government_auction_opportunity"; distress_stage = "auction_scheduled"; amount = ""; event_date = $nowIso;
        case_number = "MCAUCTION-001"; record_url = "https://www.maricopa.gov/5268/Surplus-Properties"; notes = "County surplus property watch page."
      }
    )
  },
  @{
    file = "federal_real_property_disposals.csv"
    rows = @(
      [pscustomobject]@{
        parcel = ""; owner_name = "GSA"; property_address = ""; city = ""; state = "AZ"; postal_code = "";
        signal_type = "government_auction_opportunity"; distress_stage = "auction_scheduled"; amount = ""; event_date = $nowIso;
        case_number = "FED-REALESTATE-001"; record_url = "https://realestatesales.gov/"; notes = "Federal real-estate sales portal."
      },
      [pscustomobject]@{
        parcel = ""; owner_name = "GSA Auctions"; property_address = ""; city = ""; state = "AZ"; postal_code = "";
        signal_type = "government_auction_opportunity"; distress_stage = "auction_scheduled"; amount = ""; event_date = $nowIso;
        case_number = "FED-REALESTATE-002"; record_url = "https://gsaauctions.gov/auctions/home"; notes = "Federal auctions home."
      }
    )
  },
  @{
    file = "grants_gov_opportunities.csv"
    rows = @(
      [pscustomobject]@{
        parcel = ""; owner_name = "Grants.gov"; property_address = ""; city = ""; state = "AZ"; postal_code = "";
        signal_type = "grant_opportunity"; distress_stage = "funding_open"; amount = ""; event_date = $nowIso;
        case_number = "GRANTSGOV-001"; record_url = "https://www.grants.gov/search-grants"; notes = "Federal grant search page."
      }
    )
  },
  @{
    file = "az_commerce_grants_incentives.csv"
    rows = @(
      [pscustomobject]@{
        parcel = ""; owner_name = "Arizona Commerce Authority"; property_address = ""; city = "Phoenix"; state = "AZ"; postal_code = "";
        signal_type = "grant_opportunity"; distress_stage = "funding_open"; amount = ""; event_date = $nowIso;
        case_number = "AZCOMMERCE-001"; record_url = "https://www.azcommerce.com/small-business/financing/"; notes = "Arizona financing and support programs."
      }
    )
  },
  @{
    file = "city_phoenix_business_grants_programs.csv"
    rows = @(
      [pscustomobject]@{
        parcel = ""; owner_name = "City of Phoenix EED"; property_address = ""; city = "Phoenix"; state = "AZ"; postal_code = "";
        signal_type = "grant_opportunity"; distress_stage = "funding_open"; amount = ""; event_date = $nowIso;
        case_number = "PHX-BIZ-001"; record_url = "https://www.phoenix.gov/eed"; notes = "City business and economic development landing page."
      }
    )
  },
  @{
    file = "sba_grants_and_funding_programs.csv"
    rows = @(
      [pscustomobject]@{
        parcel = ""; owner_name = "US SBA"; property_address = ""; city = ""; state = "AZ"; postal_code = "";
        signal_type = "grant_opportunity"; distress_stage = "funding_open"; amount = ""; event_date = $nowIso;
        case_number = "SBA-001"; record_url = "https://www.sba.gov/funding-programs/grants"; notes = "SBA grants/funding page."
      }
    )
  },
  @{
    file = "maricopa_recorder_document_feed.csv"
    rows = @(
      [pscustomobject]@{
        parcel = ""; owner_name = "Maricopa County Recorder"; property_address = ""; city = "Maricopa County"; state = "AZ"; postal_code = "";
        signal_type = "trustee_sale"; distress_stage = "notice_filed"; amount = ""; event_date = $nowIso;
        case_number = "MCR-RECORDER-001"; record_url = "https://recorder.maricopa.gov/recording/document-search.html"; notes = "Recorder document search (manual access)."
      },
      [pscustomobject]@{
        parcel = ""; owner_name = "Maricopa County Recorder"; property_address = ""; city = "Maricopa County"; state = "AZ"; postal_code = "";
        signal_type = "trustee_sale"; distress_stage = "monitoring"; amount = ""; event_date = $nowIso;
        case_number = "MCR-RECORDER-002"; record_url = "https://recorder.maricopa.gov/recording/title-alert.html"; notes = "Title alert monitoring page."
      }
    )
  }
)

$results = @()
foreach ($spec in $seedSpecs) {
  $path = Join-Path $ManualDropDir ([string]$spec.file)
  $status = Write-SeedFileIfNeeded -Path $path -Rows @($spec.rows)
  $results += [pscustomobject]@{
    file = [string]$spec.file
    status = $status
    path = $path
  }
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$summary = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  manualDropDir = (Resolve-Path $ManualDropDir).Path
  seeded = (@($results | Where-Object { $_.status -eq "seeded" })).Count
  skippedExisting = (@($results | Where-Object { $_.status -eq "skipped_existing" })).Count
  files = $results
}

$jsonPath = Join-Path $ManualDropDir "seed-manifest-$runId.json"
$latestPath = Join-Path $ManualDropDir "seed-manifest-latest.json"
$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $jsonPath -Encoding UTF8
$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $latestPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $latestPath"
