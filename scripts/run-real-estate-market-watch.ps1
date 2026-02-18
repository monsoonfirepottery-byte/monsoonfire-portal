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

$COMMON_REQUIRED_FIELDS = @(
  "snapshotDate"
  "source"
  "listingId"
  "title"
  "city"
  "propertyType"
  "sqft"
  "url"
)

function Resolve-AdapterField {
  param(
    [pscustomobject]$Row,
    [hashtable]$Adapter,
    [string]$Field
  )

  $candidates = New-Object System.Collections.Generic.List[string]
  $candidates.Add($Field)
  if ($Adapter.ContainsKey("fieldAliases") -and $Adapter.fieldAliases.ContainsKey($Field)) {
    [void]$candidates.AddRange(@($Adapter.fieldAliases[$Field]))
  }

  foreach ($candidate in $candidates) {
    $value = if ($Row.PSObject.Properties[$candidate]) { [string]$Row.$candidate } else { "" }
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
  }
  return ""
}

function Normalize-ListingRate {
  param(
    [double]$Monthly,
    [double]$MonthlyPsf,
    [double]$Annual,
    [double]$AnnualPsf,
    [string]$RateBasisInput
  )

  $normalizedBasis = if ([string]::IsNullOrWhiteSpace($RateBasisInput)) { $null } else { $RateBasisInput.ToLowerInvariant().Trim() }

  if ($normalizedBasis -and $normalizedBasis -notin @("monthly", "annual")) {
    return @{ ok = $false; reason = "askingRentRateBasis must be monthly or annual when present." }
  }

  if ($normalizedBasis -eq "monthly") {
    if (($null -ne $Annual -or $null -ne $AnnualPsf) -and ($null -eq $Monthly -and $null -eq $MonthlyPsf)) {
      return @{ ok = $false; reason = "askingRentRateBasis is monthly but only annual rent fields were provided." }
    }
    if (($null -ne $Monthly -or $null -ne $MonthlyPsf)) {
      return @{
        ok = $true
        askingRentMonthly = $Monthly
        askingRentPsfNnn = $MonthlyPsf
        askingRentRateBasis = "monthly"
        convertedFromAnnual = $false
      }
    }
    return @{ ok = $false; reason = "askingRentRateBasis is monthly but no monthly rent fields were provided." }
  }

  if ($normalizedBasis -eq "annual") {
    if ($null -eq $Annual -and $null -eq $AnnualPsf) {
      return @{ ok = $false; reason = "askingRentRateBasis is annual but no annual rent fields were provided." }
    }
    $monthlyConverted = if ($null -ne $Annual) { $Annual / 12 } else { $null }
    $psfConverted = if ($null -ne $AnnualPsf) { $AnnualPsf / 12 } else { $null }
    return @{
      ok = $true
      askingRentMonthly = $monthlyConverted
      askingRentPsfNnn = $psfConverted
      askingRentRateBasis = "annual"
      convertedFromAnnual = $true
    }
  }

  if ($null -ne $Monthly -or $null -ne $MonthlyPsf) {
    return @{
      ok = $true
      askingRentMonthly = $Monthly
      askingRentPsfNnn = $MonthlyPsf
      askingRentRateBasis = "monthly"
      convertedFromAnnual = $false
    }
  }

  if ($null -ne $Annual -or $null -ne $AnnualPsf) {
    $monthlyConverted = if ($null -ne $Annual) { $Annual / 12 } else { $null }
    $psfConverted = if ($null -ne $AnnualPsf) { $AnnualPsf / 12 } else { $null }
    return @{
      ok = $true
      askingRentMonthly = $monthlyConverted
      askingRentPsfNnn = $psfConverted
      askingRentRateBasis = "annual"
      convertedFromAnnual = $true
    }
  }

  return @{ ok = $false; reason = "Listing rent missing. Provide askingRentMonthly/askingRentPsfNnn or askingRentAnnual/askingRentAnnualPsfNnn." }
}

$SOURCE_ADAPTERS = @{
  default = @{
    requiredFields = @($COMMON_REQUIRED_FIELDS)
    fieldAliases = @{}
  }
  crexi = @{
    requiredFields = @($COMMON_REQUIRED_FIELDS)
    fieldAliases = @{
      askingRentMonthly = @("askingRentMonthly", "askingRent")
      askingRentPsfNnn = @("askingRentPsfNnn", "askingRentPsf", "askingRentPsf", "askingRentPerSF", "askingRentPerSqFt")
      askingRentAnnual = @("askingRentAnnual", "annualRent")
      askingRentAnnualPsfNnn = @("askingRentAnnualPsfNnn", "askingRentAnnualPsf", "askingRentPsfNnnAnnual")
      askingRentRateBasis = @("askingRentRateBasis", "rentBasis", "rateBasis", "askingRentBasis")
      url = @("url", "link", "listingUrl", "sourceUrl")
      notes = @("notes", "description", "summary")
      sqft = @("sqft", "squareFeet", "sizeSqFt", "size")
      clearHeightFt = @("clearHeightFt", "clearHeight", "clearHeightFeet")
      powerAmps = @("powerAmps", "amps", "electricAmps")
      gradeDoors = @("gradeDoors", "dockDoorsGrade")
      dockDoors = @("dockDoors", "loadingDocks")
      parkingRatio = @("parkingRatio", "parking")
      propertyType = @("propertyType", "type")
    }
  }
  commercialcafe = @{
    requiredFields = @($COMMON_REQUIRED_FIELDS)
    fieldAliases = @{}
  }
  moodyscre = @{
    requiredFields = @($COMMON_REQUIRED_FIELDS)
    fieldAliases = @{
      askingRentMonthly = @("askingRentMonthly", "askingRent")
      askingRentPsfNnn = @("askingRentPsfNnn", "askingRentPsf")
      askingRentAnnual = @("askingRentAnnual", "annualRent")
      askingRentAnnualPsfNnn = @("askingRentAnnualPsfNnn", "askingRentAnnualPsf")
      askingRentRateBasis = @("askingRentRateBasis", "rentBasis", "rateBasis")
      clearHeightFt = @("clearHeightFt", "clearHeight")
      powerAmps = @("powerAmps", "amps")
      gradeDoors = @("gradeDoors", "gradeDoorCount")
      dockDoors = @("dockDoors", "dockDoorCount")
      parkingRatio = @("parkingRatio", "parking")
      url = @("url", "link", "listingUrl")
      notes = @("notes", "comment")
    }
  }
}

function Get-SourceAdapter {
  param([string]$Source)
  $normalized = if ([string]::IsNullOrWhiteSpace($Source)) { "default" } else { $Source.ToLowerInvariant().Trim() }
  if ($SOURCE_ADAPTERS.ContainsKey($normalized)) {
    return $SOURCE_ADAPTERS[$normalized]
  }
  return $SOURCE_ADAPTERS["default"]
}

function Normalize-InputRow {
  param([pscustomobject]$Row, [hashtable]$Adapter)
  return [pscustomobject]@{
    snapshotDate = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "snapshotDate"
    source = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "source"
    listingId = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "listingId"
    title = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "title"
    address = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "address"
    city = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "city"
    submarket = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "submarket"
    propertyType = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "propertyType"
    zoning = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "zoning"
    sqft = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "sqft"
    askingRentMonthly = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "askingRentMonthly"
    askingRentPsfNnn = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "askingRentPsfNnn"
    askingRentAnnual = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "askingRentAnnual"
    askingRentAnnualPsfNnn = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "askingRentAnnualPsfNnn"
    askingRentRateBasis = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "askingRentRateBasis"
    clearHeightFt = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "clearHeightFt"
    powerAmps = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "powerAmps"
    gradeDoors = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "gradeDoors"
    dockDoors = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "dockDoors"
    parkingRatio = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "parkingRatio"
    url = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "url"
    notes = Resolve-AdapterField -Row $Row -Adapter $Adapter -Field "notes"
  }
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
  $lines += "- listingRows: $($Summary.qualityCheck.rawRows)"
  $lines += "- acceptedRows: $($Summary.qualityCheck.acceptedRows)"
  $lines += "- skippedRows: $($Summary.qualityCheck.skippedRows)"
  $lines += "- rentBasisMonthly: $($Summary.qualityCheck.rentRateBasis.monthly)"
  $lines += "- rentBasisAnnual: $($Summary.qualityCheck.rentRateBasis.annual)"
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

$validRows = 0
$scored = @()
$invalidRows = @()
for ($rowIndex = 0; $rowIndex -lt $rows.Count; $rowIndex += 1) {
  $row = $rows[$rowIndex]

  $lineNumber = $rowIndex + 2
  $adapter = Get-SourceAdapter -Source ([string]$row.source)
  $normalizedRow = Normalize-InputRow -Row $row -Adapter $adapter
  $errors = New-Object System.Collections.Generic.List[string]

  foreach ($field in $adapter.requiredFields) {
    $value = [string]($normalizedRow.$field)
    if ([string]::IsNullOrWhiteSpace($value)) {
      $errors.Add("Missing required field: $field")
    }
  }

  $url = [string]$normalizedRow.url
  if ([string]::IsNullOrWhiteSpace($url)) {
    $errors.Add("Missing required field: url")
  } else {
    try {
      $uri = [Uri]$url.Trim()
      if (-not $uri.IsAbsoluteUri -or -not @("http", "https").Contains($uri.Scheme.ToLowerInvariant())) {
        $errors.Add("Invalid URL: must be absolute http(s) URL")
      }
    } catch {
      $errors.Add("Invalid URL format")
    }
  }

  $normalizedRate = Normalize-ListingRate `
    -Monthly (Convert-ToNullableNumber $normalizedRow.askingRentMonthly) `
    -MonthlyPsf (Convert-ToNullableNumber $normalizedRow.askingRentPsfNnn) `
    -Annual (Convert-ToNullableNumber $normalizedRow.askingRentAnnual) `
    -AnnualPsf (Convert-ToNullableNumber $normalizedRow.askingRentAnnualPsfNnn) `
    -RateBasisInput ([string]$normalizedRow.askingRentRateBasis)
  if (-not $normalizedRate.ok) {
    $errors.Add($normalizedRate.reason)
  }

  $normalizedSqFt = Convert-ToNullableNumber $normalizedRow.sqft
  if ($null -eq $normalizedSqFt) {
    $errors.Add("Invalid numeric value for required field: sqft")
  }

  if ($errors.Count -gt 0) {
    $invalidRows += [pscustomobject]@{
      lineNumber = $lineNumber
      listingId = [string]$normalizedRow.listingId
      source = [string]$normalizedRow.source
      errors = $errors
    }
    continue
  }

  $normalizedRow.sqft = [string]$normalizedSqFt
  $normalizedRow.askingRentMonthly = [string]$normalizedRate.askingRentMonthly
  $normalizedRow.askingRentPsfNnn = [string]$normalizedRate.askingRentPsfNnn
  $normalizedRow.askingRentRateBasis = [string]$normalizedRate.askingRentRateBasis

  $fit = Get-FitScore -Row $normalizedRow -MinSqFt $TargetMinSqFt -MaxSqFt $TargetMaxSqFt -MaxMonthlyRent $TargetMaxMonthlyRent -Cities $PreferredCities

  $validRows += 1
  $scored += [pscustomobject]@{
    snapshotDate = [string]$normalizedRow.snapshotDate
    source = [string]$normalizedRow.source
    listingId = [string]$normalizedRow.listingId
    title = [string]$normalizedRow.title
    address = [string]$normalizedRow.address
    city = [string]$normalizedRow.city
    submarket = [string]$normalizedRow.submarket
    propertyType = [string]$normalizedRow.propertyType
    zoning = [string]$normalizedRow.zoning
    clearHeightFt = Convert-ToNullableNumber $normalizedRow.clearHeightFt
    powerAmps = Convert-ToNullableNumber $normalizedRow.powerAmps
    gradeDoors = Convert-ToNullableNumber $normalizedRow.gradeDoors
    dockDoors = Convert-ToNullableNumber $normalizedRow.dockDoors
    parkingRatio = Convert-ToNullableNumber $normalizedRow.parkingRatio
    url = [string]$normalizedRow.url
    notes = [string]$normalizedRow.notes
    askingRentRateBasis = [string]$normalizedRate.askingRentRateBasis
    convertedFromAnnual = [bool]$normalizedRate.convertedFromAnnual
    fit = $fit
  }
}

if ($invalidRows.Count -gt 0) {
  Write-Host "Skipped $($invalidRows.Count) listing rows due to quality gates:"
  foreach ($entry in $invalidRows) {
    Write-Host "  Row $($entry.lineNumber) [$($entry.source)] $($entry.listingId): $($entry.errors -join '; ')"
  }
}

if ($validRows -eq 0) {
  throw "No valid listing rows after quality gates."
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

$rentBasisCounts = [ordered]@{
  monthly = (@($scored | Where-Object { $_.askingRentRateBasis -eq "monthly" })).Count
  annual = (@($scored | Where-Object { $_.askingRentRateBasis -eq "annual" })).Count
}

$summary = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  inputCsv = (Resolve-Path $ListingsCsv).Path
  listingCount = $validRows
  qualityCheck = [pscustomobject]@{
    rawRows = $rows.Count
    acceptedRows = $validRows
    skippedRows = $invalidRows.Count
    rentRateBasis = [pscustomobject]$rentBasisCounts
  }
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
