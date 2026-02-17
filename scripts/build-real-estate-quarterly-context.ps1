param(
  [string]$InputDir = "output/real-estate",
  [string]$OutputDir = "output/real-estate",
  [string]$HistoryCsvPath = "output/real-estate/market-watch-history.csv",
  [int]$ContextLookbackRuns = 8,
  [int]$TopCandidates = 10
)

$ErrorActionPreference = "Stop"

function Convert-ToNullableNumber {
  param([object]$Value)

  if ($null -eq $Value) { return $null }
  $raw = [string]$Value
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }

  $number = 0.0
  $ok = [double]::TryParse(
    $raw.Trim(),
    [System.Globalization.NumberStyles]::Float,
    [System.Globalization.CultureInfo]::InvariantCulture,
    [ref]$number
  )
  if (-not $ok) {
    $ok = [double]::TryParse($raw.Trim(), [ref]$number)
  }
  if (-not $ok) { return $null }
  return [double]$number
}

function Get-Median {
  param([object[]]$Values)

  $numbers = @(
    $Values |
      Where-Object { $null -ne $_ } |
      ForEach-Object { [double]$_ } |
      Sort-Object
  )

  if ($numbers.Count -eq 0) { return $null }
  $middle = [math]::Floor($numbers.Count / 2)
  if (($numbers.Count % 2) -eq 1) {
    return [double]$numbers[$middle]
  }
  return [double](($numbers[$middle - 1] + $numbers[$middle]) / 2.0)
}

function Get-QuarterKey {
  param([datetime]$DateValue)
  $quarter = [int][math]::Floor(($DateValue.Month - 1) / 3) + 1
  return "{0}-Q{1}" -f $DateValue.Year, $quarter
}

function Get-PctChange {
  param([object]$PreviousValue, [object]$CurrentValue)
  if ($null -eq $PreviousValue -or $null -eq $CurrentValue) { return $null }
  $prev = [double]$PreviousValue
  $curr = [double]$CurrentValue
  if ($prev -eq 0) { return $null }
  return [math]::Round((($curr - $prev) / $prev) * 100, 2)
}

function Build-QuarterlyMarkdown {
  param(
    [pscustomobject]$Context,
    [pscustomobject]$LatestQuarter,
    [pscustomobject]$PreviousQuarter
  )

  $lines = @()
  $lines += "# Real Estate Quarterly Trend Report"
  $lines += ""
  $lines += "- generatedAtUtc: $($Context.generatedAtUtc)"
  $lines += "- quarter: $($LatestQuarter.quarter)"
  $lines += "- latestSnapshotAtUtc: $($Context.latestSnapshot.generatedAtUtc)"
  $lines += ""
  $lines += "## QoQ Signals"
  $lines += ""
  if ($null -eq $PreviousQuarter) {
    $lines += "- previousQuarter: none"
    $lines += "- note: first quarter in history set; QoQ deltas unavailable"
  } else {
    $lines += "- previousQuarter: $($PreviousQuarter.quarter)"
    $lines += "- medianMonthlyRentPctChange: $($Context.qoqTrend.medianMonthlyRentPctChange)"
    $lines += "- medianRentPsfPctChange: $($Context.qoqTrend.medianRentPsfPctChange)"
    $lines += "- viableCountDelta: $($Context.qoqTrend.viableCountDelta)"
    $lines += "- listingCountDelta: $($Context.qoqTrend.listingCountDelta)"
  }
  $lines += ""
  $lines += "## Quarter Summaries"
  $lines += ""
  $lines += "| Quarter | Runs | Latest Run | Median Rent/mo | Median Rent $/sf | Viable | Listings |"
  $lines += "| --- | ---: | --- | ---: | ---: | ---: | ---: |"
  foreach ($row in $Context.quarterSummaries) {
    $lines += "| $($row.quarter) | $($row.runCount) | $($row.latestRunAtUtc) | $($row.medianAskingRentMonthly) | $($row.medianAskingRentPsfNnn) | $($row.viableCountLatest) | $($row.listingCountLatest) |"
  }
  $lines += ""
  $lines += "## Latest Top Candidates"
  $lines += ""
  $lines += "| Score | Tier | City | SqFt | Rent/mo | Title | URL |"
  $lines += "| ---: | --- | --- | ---: | ---: | --- | --- |"
  foreach ($candidate in $Context.topCandidates) {
    $lines += "| $($candidate.score) | $($candidate.tier) | $($candidate.city) | $($candidate.sqft) | $($candidate.askingRentMonthly) | $($candidate.title) | $($candidate.url) |"
  }
  return ($lines -join "`n") + "`n"
}

if (-not (Test-Path $InputDir)) {
  throw "Input directory not found: $InputDir"
}

$jsonFiles = Get-ChildItem -Path $InputDir -Filter "market-watch-*.json" -File | Sort-Object LastWriteTime
if ($jsonFiles.Count -eq 0) {
  throw "No market-watch JSON files found in $InputDir"
}

$runRows = @()
foreach ($file in $jsonFiles) {
  $doc = Get-Content -Raw $file.FullName | ConvertFrom-Json
  $generatedAt = [datetime]$doc.generatedAtUtc
  $runRows += [pscustomobject]@{
    runId = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    generatedAtUtc = $generatedAt.ToUniversalTime().ToString("o")
    quarter = Get-QuarterKey -DateValue $generatedAt
    listingCount = [int]$doc.listingCount
    medianSqFt = Convert-ToNullableNumber $doc.medians.sqft
    medianAskingRentMonthly = Convert-ToNullableNumber $doc.medians.askingRentMonthly
    medianAskingRentPsfNnn = Convert-ToNullableNumber $doc.medians.askingRentPsfNnn
    strongFitCount = [int]$doc.fitTierCounts.strong_fit
    viableCount = [int]$doc.fitTierCounts.viable
    stretchCount = [int]$doc.fitTierCounts.stretch
    weakCount = [int]$doc.fitTierCounts.weak
    sourceJson = $file.FullName
  }
}

$runRows = $runRows | Sort-Object { [datetime]$_.generatedAtUtc }

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$runRows | Export-Csv -Path $HistoryCsvPath -NoTypeInformation -Encoding UTF8

$quarterSummaries = @()
$grouped = $runRows | Group-Object quarter | Sort-Object Name
foreach ($group in $grouped) {
  $quarterRows = $group.Group | Sort-Object { [datetime]$_.generatedAtUtc }
  $latest = $quarterRows[-1]
  $quarterSummaries += [pscustomobject]@{
    quarter = $group.Name
    runCount = $quarterRows.Count
    latestRunAtUtc = $latest.generatedAtUtc
    medianAskingRentMonthly = Get-Median -Values ($quarterRows | ForEach-Object { $_.medianAskingRentMonthly })
    medianAskingRentPsfNnn = Get-Median -Values ($quarterRows | ForEach-Object { $_.medianAskingRentPsfNnn })
    medianSqFt = Get-Median -Values ($quarterRows | ForEach-Object { $_.medianSqFt })
    viableCountLatest = [int]$latest.viableCount
    listingCountLatest = [int]$latest.listingCount
  }
}

$latestQuarter = $quarterSummaries[-1]
$previousQuarter = $null
if ($quarterSummaries.Count -gt 1) {
  $previousQuarter = $quarterSummaries[-2]
}

$latestRunRow = $runRows[-1]
$latestRunDoc = Get-Content -Raw $latestRunRow.sourceJson | ConvertFrom-Json
$topCandidatesRows = @(
  $latestRunDoc.topCandidates |
    Select-Object -First $TopCandidates |
    ForEach-Object {
      [pscustomobject]@{
        title = $_.title
        city = $_.city
        score = Convert-ToNullableNumber $_.fit.score
        tier = $_.fit.tier
        sqft = Convert-ToNullableNumber $_.fit.sqft
        askingRentMonthly = Convert-ToNullableNumber $_.fit.askingRentMonthly
        url = $_.url
        reasons = $_.fit.reasons
      }
    }
)

$qoqTrend = [pscustomobject]@{
  medianMonthlyRentPctChange = if ($null -eq $previousQuarter) { $null } else { Get-PctChange -PreviousValue $previousQuarter.medianAskingRentMonthly -CurrentValue $latestQuarter.medianAskingRentMonthly }
  medianRentPsfPctChange = if ($null -eq $previousQuarter) { $null } else { Get-PctChange -PreviousValue $previousQuarter.medianAskingRentPsfNnn -CurrentValue $latestQuarter.medianAskingRentPsfNnn }
  viableCountDelta = if ($null -eq $previousQuarter) { $null } else { [int]$latestQuarter.viableCountLatest - [int]$previousQuarter.viableCountLatest }
  listingCountDelta = if ($null -eq $previousQuarter) { $null } else { [int]$latestQuarter.listingCountLatest - [int]$previousQuarter.listingCountLatest }
}

$context = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  latestQuarter = $latestQuarter.quarter
  latestSnapshot = [pscustomobject]@{
    generatedAtUtc = $latestRunRow.generatedAtUtc
    sourceJson = $latestRunRow.sourceJson
    listingCount = [int]$latestRunDoc.listingCount
    medians = $latestRunDoc.medians
  }
  quarterSummaries = $quarterSummaries
  qoqTrend = $qoqTrend
  historyTail = @($runRows | Select-Object -Last $ContextLookbackRuns)
  topCandidates = $topCandidatesRows
  baselineNotes = @(
    "Home studio remains the default cost-effective baseline.",
    "Use this context for expansion scouting and broker/agent swarm prompts."
  )
}

$quarterSlug = $latestQuarter.quarter
$contextPath = Join-Path $OutputDir "agent-swarm-context-$quarterSlug.json"
$reportPath = Join-Path $OutputDir "real-estate-quarterly-report-$quarterSlug.md"

$context | ConvertTo-Json -Depth 10 | Set-Content -Path $contextPath -Encoding UTF8
$report = Build-QuarterlyMarkdown -Context $context -LatestQuarter $latestQuarter -PreviousQuarter $previousQuarter
$report | Set-Content -Path $reportPath -Encoding UTF8

Write-Host "Wrote $HistoryCsvPath"
Write-Host "Wrote $contextPath"
Write-Host "Wrote $reportPath"
