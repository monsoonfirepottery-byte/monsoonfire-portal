param(
  [string]$PublicDataManifestPath = "output/real-estate/public-data/latest-manifest.json",
  [string]$OutputDir = "output/real-estate"
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

function Convert-ToDoubleOrNull {
  param([object]$Value)
  if ($null -eq $Value) { return $null }
  $raw = [string]$Value
  if ([string]::IsNullOrWhiteSpace($raw) -or $raw -eq ".") { return $null }
  $n = 0.0
  if ([double]::TryParse($raw, [ref]$n)) {
    return [double]$n
  }
  return $null
}

function Get-PctChange {
  param([object]$Previous, [object]$Current)
  if ($null -eq $Previous -or $null -eq $Current) { return $null }
  $p = [double]$Previous
  $c = [double]$Current
  if ($p -eq 0) { return $null }
  return [math]::Round((($c - $p) / $p) * 100, 2)
}

function Get-Mean {
  param([object[]]$Values)
  $nums = @($Values | Where-Object { $null -ne $_ } | ForEach-Object { [double]$_ })
  if ($nums.Count -eq 0) { return $null }
  return [math]::Round((($nums | Measure-Object -Sum).Sum / $nums.Count), 4)
}

function Build-Markdown {
  param([pscustomobject]$Context)

  $lines = @()
  $lines += "# Real Estate Macro Context"
  $lines += ""
  $lines += "- generatedAtUtc: $($Context.generatedAtUtc)"
  $lines += "- creIndexLatest: $($Context.crePriceIndex.latest.value) (asOf $($Context.crePriceIndex.latest.date))"
  $lines += "- creIndexQoQPct: $($Context.crePriceIndex.qoqPct)"
  $lines += "- creIndexYoYPct: $($Context.crePriceIndex.yoyPct)"
  $lines += "- fedFundsLatest: $($Context.fedFunds.latest.value) (asOf $($Context.fedFunds.latest.date))"
  $lines += "- fedFunds3mAvg: $($Context.fedFunds.avg3m)"
  $lines += "- fedFunds12mAvg: $($Context.fedFunds.avg12m)"
  $lines += ""
  $lines += "## Maricopa ACS Snapshot"
  $lines += ""
  $lines += "- population: $($Context.maricopaAcs.population)"
  $lines += "- medianGrossRent: $($Context.maricopaAcs.medianGrossRent)"
  $lines += "- medianHomeValue: $($Context.maricopaAcs.medianHomeValue)"
  $lines += ""
  $lines += "## Implications"
  $lines += ""
  foreach ($line in $Context.swarmImplications) {
    $lines += "- $line"
  }
  return ($lines -join "`n") + "`n"
}

if (-not (Test-Path $PublicDataManifestPath)) {
  throw "Public data manifest not found: $PublicDataManifestPath"
}

$manifest = Get-Content -Raw $PublicDataManifestPath | ConvertFrom-Json

$creLatest = $null
$creQoq = $null
$creYoy = $null
$creDate = ""

$creSource = Get-SourceResult -Manifest $manifest -Key "fred_commercial_real_estate_price_index"
if ($null -ne $creSource -and $creSource.status -eq "ok" -and (Test-Path $creSource.outputFile)) {
  $rows = Import-Csv -Path $creSource.outputFile | Where-Object { $_.DATE -and $_.COMREPUSQ159N -and $_.COMREPUSQ159N -ne "." }
  if ($rows.Count -gt 0) {
    $latest = $rows[-1]
    $creDate = [string]$latest.DATE
    $creLatest = Convert-ToDoubleOrNull $latest.COMREPUSQ159N
    if ($rows.Count -ge 2) {
      $prev = Convert-ToDoubleOrNull $rows[-2].COMREPUSQ159N
      $creQoq = Get-PctChange -Previous $prev -Current $creLatest
    }
    if ($rows.Count -ge 5) {
      $yearAgo = Convert-ToDoubleOrNull $rows[-5].COMREPUSQ159N
      $creYoy = Get-PctChange -Previous $yearAgo -Current $creLatest
    }
  }
}

$fedLatest = $null
$fedDate = ""
$fed3mAvg = $null
$fed12mAvg = $null

$fedSource = Get-SourceResult -Manifest $manifest -Key "fred_fed_funds_rate"
if ($null -ne $fedSource -and $fedSource.status -eq "ok" -and (Test-Path $fedSource.outputFile)) {
  $rows = Import-Csv -Path $fedSource.outputFile | Where-Object { $_.DATE -and $_.FEDFUNDS -and $_.FEDFUNDS -ne "." }
  if ($rows.Count -gt 0) {
    $latest = $rows[-1]
    $fedDate = [string]$latest.DATE
    $fedLatest = Convert-ToDoubleOrNull $latest.FEDFUNDS
    $tail3 = @($rows | Select-Object -Last ([math]::Min(3, $rows.Count)) | ForEach-Object { Convert-ToDoubleOrNull $_.FEDFUNDS })
    $tail12 = @($rows | Select-Object -Last ([math]::Min(12, $rows.Count)) | ForEach-Object { Convert-ToDoubleOrNull $_.FEDFUNDS })
    $fed3mAvg = Get-Mean -Values $tail3
    $fed12mAvg = Get-Mean -Values $tail12
  }
}

$acsPopulation = $null
$acsMedianRent = $null
$acsMedianHomeValue = $null

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
    $acsPopulation = $lookup["B01003_001E"]
    $acsMedianRent = $lookup["B25064_001E"]
    $acsMedianHomeValue = $lookup["B25077_001E"]
  }
}

$swarmImplications = @(
  "If fed funds remain elevated vs 12-month average, prioritize distressed/off-market negotiation postures over competitive bids.",
  "If CRE index YoY declines, increase watch cadence for tax/legal distress signals and lender-driven dispositions.",
  "Use ACS rent and value baselines to sanity-check local asking rents against household affordability pressure.",
  "Prioritize parcels where macro pressure and parcel-level distress signals co-occur."
)

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$context = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  inputManifestPath = (Resolve-Path $PublicDataManifestPath).Path
  crePriceIndex = [pscustomobject]@{
    series = "COMREPUSQ159N"
    latest = [pscustomobject]@{
      date = $creDate
      value = $creLatest
    }
    qoqPct = $creQoq
    yoyPct = $creYoy
  }
  fedFunds = [pscustomobject]@{
    series = "FEDFUNDS"
    latest = [pscustomobject]@{
      date = $fedDate
      value = $fedLatest
    }
    avg3m = $fed3mAvg
    avg12m = $fed12mAvg
  }
  maricopaAcs = [pscustomobject]@{
    population = $acsPopulation
    medianGrossRent = $acsMedianRent
    medianHomeValue = $acsMedianHomeValue
  }
  swarmImplications = $swarmImplications
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$jsonPath = Join-Path $OutputDir "macro-context-$runId.json"
$mdPath = Join-Path $OutputDir "macro-context-$runId.md"
$latestJsonPath = Join-Path $OutputDir "macro-context-latest.json"
$latestMdPath = Join-Path $OutputDir "macro-context-latest.md"

$context | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding UTF8
$context | ConvertTo-Json -Depth 10 | Set-Content -Path $latestJsonPath -Encoding UTF8
$md = Build-Markdown -Context $context
$md | Set-Content -Path $mdPath -Encoding UTF8
$md | Set-Content -Path $latestMdPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $mdPath"
Write-Host "Wrote $latestJsonPath"
Write-Host "Wrote $latestMdPath"
