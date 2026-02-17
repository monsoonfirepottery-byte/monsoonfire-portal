param(
  [Parameter(Mandatory = $true)]
  [string]$ListingsCsv,
  [string]$OutDir = "output/real-estate",
  [int]$Top = 10,
  [int]$TargetMinSqFt = 1200,
  [int]$TargetMaxSqFt = 6000,
  [int]$TargetMaxMonthlyRent = 6500,
  [string[]]$PreferredCities = @("Goodyear", "Avondale", "Tolleson", "Glendale", "Phoenix")
)

$ErrorActionPreference = "Stop"

function Convert-ToNullableNumber {
  param([object]$Value)

  if ($null -eq $Value) { return $null }
  $raw = [string]$Value
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }

  $clean = $raw.Trim().Replace(",", "").Replace("$", "")
  $number = 0.0
  $ok = [double]::TryParse(
    $clean,
    [System.Globalization.NumberStyles]::Float,
    [System.Globalization.CultureInfo]::InvariantCulture,
    [ref]$number
  )
  if (-not $ok) {
    $ok = [double]::TryParse($clean, [ref]$number)
  }
  if (-not $ok) { return $null }
  return [double]$number
}

function Get-Median {
  param([double[]]$Values)

  if ($null -eq $Values -or $Values.Count -eq 0) { return $null }
  $sorted = $Values | Sort-Object
  $count = $sorted.Count
  $middle = [math]::Floor($count / 2)

  if (($count % 2) -eq 1) {
    return [double]$sorted[$middle]
  }

  return [double](($sorted[$middle - 1] + $sorted[$middle]) / 2.0)
}

function Get-FitScore {
  param(
    [pscustomobject]$Row,
    [int]$MinSqFt,
    [int]$MaxSqFt,
    [int]$MaxMonthlyRent,
    [string[]]$Cities
  )

  $score = 0
  $reasons = New-Object System.Collections.Generic.List[string]

  $city = ([string]$Row.city).Trim()
  $cityMatch = $false
  foreach ($candidate in $Cities) {
    if ($city.Equals($candidate, [System.StringComparison]::OrdinalIgnoreCase)) {
      $cityMatch = $true
      break
    }
  }
  if ($cityMatch) {
    $score += 5
    $reasons.Add("Preferred city")
  }

  $propertyType = ([string]$Row.propertyType).ToLowerInvariant()
  if ($propertyType -match "warehouse|industrial|light industrial") {
    $score += 20
    $reasons.Add("Property type fit")
  } elseif ($propertyType -match "flex") {
    $score += 8
    $reasons.Add("Partial property type fit")
  }

  $sqft = Convert-ToNullableNumber $Row.sqft
  if ($null -ne $sqft) {
    if ($sqft -ge $MinSqFt -and $sqft -le $MaxSqFt) {
      $score += 15
      $reasons.Add("SqFt in target range")
    } elseif ($sqft -ge ($MinSqFt * 0.8) -and $sqft -le ($MaxSqFt * 1.25)) {
      $score += 7
      $reasons.Add("SqFt near target range")
    }
  }

  $askingRentMonthly = Convert-ToNullableNumber $Row.askingRentMonthly
  if ($null -ne $askingRentMonthly) {
    if ($askingRentMonthly -le $MaxMonthlyRent) {
      $score += 25
      $reasons.Add("Monthly rent in target range")
    } elseif ($askingRentMonthly -le ($MaxMonthlyRent * 1.2)) {
      $score += 10
      $reasons.Add("Monthly rent near target cap")
    }
  }

  $zoning = ([string]$Row.zoning).ToLowerInvariant()
  if ($zoning -match "industrial|i-1|i-2|m-1") {
    $score += 10
    $reasons.Add("Zoning likely compatible")
  }

  $powerAmps = Convert-ToNullableNumber $Row.powerAmps
  if ($null -ne $powerAmps -and $powerAmps -ge 200) {
    $score += 10
    $reasons.Add("Power capacity >= 200A")
  }

  $clearHeightFt = Convert-ToNullableNumber $Row.clearHeightFt
  if ($null -ne $clearHeightFt -and $clearHeightFt -ge 14) {
    $score += 10
    $reasons.Add("Clear height >= 14ft")
  }

  $gradeDoors = Convert-ToNullableNumber $Row.gradeDoors
  if ($null -ne $gradeDoors -and $gradeDoors -ge 1) {
    $score += 5
    $reasons.Add("Grade-door access")
  }

  $tier = if ($score -ge 80) {
    "strong_fit"
  } elseif ($score -ge 60) {
    "viable"
  } elseif ($score -ge 40) {
    "stretch"
  } else {
    "weak"
  }

  return [pscustomobject]@{
    score = $score
    tier = $tier
    sqft = $sqft
    askingRentMonthly = $askingRentMonthly
    askingRentPsfNnn = Convert-ToNullableNumber $Row.askingRentPsfNnn
    reasons = @($reasons.ToArray())
  }
}

function Build-Markdown {
  param(
    [pscustomobject]$Summary,
    [object[]]$TopRows
  )

  $lines = @()
  $lines += "# Real Estate Market Watch Summary"
  $lines += ""
  $lines += "- generatedAtUtc: $($Summary.generatedAtUtc)"
  $lines += "- inputCsv: $($Summary.inputCsv)"
  $lines += "- listingCount: $($Summary.listingCount)"
  $lines += "- strongFitCount: $($Summary.fitTierCounts.strong_fit)"
  $lines += "- viableCount: $($Summary.fitTierCounts.viable)"
  $lines += "- stretchCount: $($Summary.fitTierCounts.stretch)"
  $lines += "- weakCount: $($Summary.fitTierCounts.weak)"
  $lines += ""
  $lines += "## Market Medians"
  $lines += ""
  $lines += "- medianSqFt: $($Summary.medians.sqft)"
  $lines += "- medianAskingRentMonthly: $($Summary.medians.askingRentMonthly)"
  $lines += "- medianAskingRentPsfNnn: $($Summary.medians.askingRentPsfNnn)"
  $lines += ""
  $lines += "## Top Candidates"
  $lines += ""
  $lines += "| Score | Tier | City | SqFt | Rent/mo | Title | URL |"
  $lines += "| ---: | --- | --- | ---: | ---: | --- | --- |"

  foreach ($row in $TopRows) {
    $url = if ([string]::IsNullOrWhiteSpace([string]$row.url)) { "" } else { [string]$row.url }
    $lines += "| $($row.fit.score) | $($row.fit.tier) | $($row.city) | $($row.fit.sqft) | $($row.fit.askingRentMonthly) | $($row.title) | $url |"
  }

  return ($lines -join "`n") + "`n"
}

if (-not (Test-Path $ListingsCsv)) {
  throw "Listings CSV not found: $ListingsCsv"
}

$rows = Import-Csv -Path $ListingsCsv
if ($rows.Count -eq 0) {
  throw "Listings CSV has no rows: $ListingsCsv"
}

$scored = @()
foreach ($row in $rows) {
  $fit = Get-FitScore -Row $row -MinSqFt $TargetMinSqFt -MaxSqFt $TargetMaxSqFt -MaxMonthlyRent $TargetMaxMonthlyRent -Cities $PreferredCities
  $scored += [pscustomobject]@{
    snapshotDate = [string]$row.snapshotDate
    source = [string]$row.source
    listingId = [string]$row.listingId
    title = [string]$row.title
    address = [string]$row.address
    city = [string]$row.city
    submarket = [string]$row.submarket
    propertyType = [string]$row.propertyType
    zoning = [string]$row.zoning
    clearHeightFt = Convert-ToNullableNumber $row.clearHeightFt
    powerAmps = Convert-ToNullableNumber $row.powerAmps
    gradeDoors = Convert-ToNullableNumber $row.gradeDoors
    dockDoors = Convert-ToNullableNumber $row.dockDoors
    parkingRatio = Convert-ToNullableNumber $row.parkingRatio
    url = [string]$row.url
    notes = [string]$row.notes
    fit = $fit
  }
}

$sorted = $scored | Sort-Object @{ Expression = { $_.fit.score }; Descending = $true }, @{ Expression = { $_.fit.askingRentMonthly }; Ascending = $true }
$topRows = $sorted | Select-Object -First $Top

$sqftValues = @($scored | ForEach-Object { if ($null -ne $_.fit.sqft) { [double]$_.fit.sqft } })
$rentMonthlyValues = @($scored | ForEach-Object { if ($null -ne $_.fit.askingRentMonthly) { [double]$_.fit.askingRentMonthly } })
$rentPsfValues = @($scored | ForEach-Object { if ($null -ne $_.fit.askingRentPsfNnn) { [double]$_.fit.askingRentPsfNnn } })

$fitTierCounts = [ordered]@{
  strong_fit = (@($scored | Where-Object { $_.fit.tier -eq "strong_fit" })).Count
  viable = (@($scored | Where-Object { $_.fit.tier -eq "viable" })).Count
  stretch = (@($scored | Where-Object { $_.fit.tier -eq "stretch" })).Count
  weak = (@($scored | Where-Object { $_.fit.tier -eq "weak" })).Count
}

$summary = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  inputCsv = (Resolve-Path $ListingsCsv).Path
  listingCount = $scored.Count
  targets = [pscustomobject]@{
    minSqFt = $TargetMinSqFt
    maxSqFt = $TargetMaxSqFt
    maxMonthlyRent = $TargetMaxMonthlyRent
    preferredCities = $PreferredCities
  }
  medians = [pscustomobject]@{
    sqft = Get-Median -Values $sqftValues
    askingRentMonthly = Get-Median -Values $rentMonthlyValues
    askingRentPsfNnn = Get-Median -Values $rentPsfValues
  }
  fitTierCounts = [pscustomobject]$fitTierCounts
  topCandidates = $topRows
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$jsonPath = Join-Path $OutDir "market-watch-$runId.json"
$mdPath = Join-Path $OutDir "market-watch-$runId.md"

$summary | ConvertTo-Json -Depth 8 | Set-Content -Path $jsonPath -Encoding utf8
$markdown = Build-Markdown -Summary $summary -TopRows $topRows
$markdown | Set-Content -Path $mdPath -Encoding utf8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $mdPath"
