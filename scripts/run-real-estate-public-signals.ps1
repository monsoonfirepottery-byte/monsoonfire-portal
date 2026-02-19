param(
  [string]$ConfigPath = "docs/real-estate/public-signal-sources.json",
  [string]$OutputDir = "output/real-estate",
  [string]$AutoStagingDir = "output/real-estate/staging/public-signals",
  [string]$ManualDropDir = "output/real-estate/manual-drops",
  [int]$Top = 50,
  [int]$TimeoutSec = 45,
  [int]$PromptInjectionFlagThreshold = 7,
  [int]$PromptInjectionBlockThreshold = 14,
  [int]$CommunityPromptInjectionBlockThreshold = 7
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

function Convert-ToIsoDateString {
  param([object]$Value)

  if ($null -eq $Value) { return "" }
  $raw = [string]$Value
  if ([string]::IsNullOrWhiteSpace($raw)) { return "" }

  [datetime]$dt = [datetime]::MinValue
  if ([datetime]::TryParse($raw, [ref]$dt)) {
    return $dt.ToUniversalTime().ToString("o")
  }
  return ""
}

function Normalize-TextKey {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return "" }
  return ([regex]::Replace($Text.ToLowerInvariant(), "[^a-z0-9]+", "")).Trim()
}

function Normalize-ParcelKey {
  param([string]$ParcelId)
  if ([string]::IsNullOrWhiteSpace($ParcelId)) { return "" }
  return ([regex]::Replace($ParcelId.ToUpperInvariant(), "[^A-Z0-9]+", "")).Trim()
}

function Get-FieldValue {
  param(
    [object]$Row,
    [object]$FieldCandidates
  )

  if ($null -eq $Row -or $null -eq $FieldCandidates) { return "" }

  $candidates = @()
  if ($FieldCandidates -is [string]) {
    $candidates = @([string]$FieldCandidates)
  } else {
    $candidates = @($FieldCandidates | ForEach-Object { [string]$_ })
  }

  foreach ($field in $candidates) {
    if ([string]::IsNullOrWhiteSpace($field)) { continue }

    $current = $Row
    foreach ($segment in ($field -split "\.")) {
      if ($null -eq $current) { break }
      if ([string]::IsNullOrWhiteSpace($segment)) { continue }
      $prop = $current.PSObject.Properties[$segment]
      if ($null -eq $prop) {
        $current = $null
        break
      }
      $current = $prop.Value
    }

    if ($null -ne $current) {
      $value = [string]$current
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value.Trim()
      }
    }
  }
  return ""
}

function Expand-JsonRows {
  param(
    [object]$Document,
    [string]$RootPath
  )

  if ($null -eq $Document) { return @() }
  if ([string]::IsNullOrWhiteSpace($RootPath)) {
    if ($Document -is [System.Collections.IEnumerable] -and -not ($Document -is [string])) {
      return @($Document)
    }
    return @($Document)
  }

  $current = $Document
  foreach ($segment in ($RootPath -split "\.")) {
    if ($null -eq $current) { return @() }
    if ([string]::IsNullOrWhiteSpace($segment)) { continue }
    $prop = $current.PSObject.Properties[$segment]
    if ($null -eq $prop) { return @() }
    $current = $prop.Value
  }

  if ($null -eq $current) { return @() }
  if ($current -is [System.Collections.IEnumerable] -and -not ($current -is [string])) {
    return @($current)
  }
  return @($current)
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

  if (-not [string]::IsNullOrWhiteSpace([string]$Source.url)) {
    return [string]$Source.url
  }

  return ""
}

function Get-PromptInjectionAssessment {
  param(
    [string]$Text,
    [int]$FlagThreshold = 7,
    [int]$BlockThreshold = 14
  )

  $content = if ($null -eq $Text) { "" } else { $Text.ToLowerInvariant() }
  if ([string]::IsNullOrWhiteSpace($content)) {
    return [pscustomobject]@{
      score = 0
      matches = @()
      flagged = $false
      blocked = $false
    }
  }

  $score = 0
  $foundMatches = New-Object System.Collections.Generic.List[string]

  $literalRules = @{
    "ignore previous instructions" = 7
    "ignore all previous instructions" = 7
    "ignore above instructions" = 6
    "system prompt" = 6
    "developer message" = 6
    "jailbreak" = 7
    "bypass safety" = 6
    "do not follow your instructions" = 7
    "api key" = 5
    "access token" = 5
    "encoded shell command" = 8
    "cmd.exe" = 7
    "<script" = 8
    "javascript:" = 8
    "discord webhook" = 7
  }

  foreach ($rule in $literalRules.GetEnumerator()) {
    $needle = [string]$rule.Key
    $weight = [int]$rule.Value
    if ($content -match [regex]::Escape($needle)) {
      $score += $weight
      [void]$foundMatches.Add($needle)
    }
  }

  $regexRules = @(
    [pscustomobject]@{ pattern = "(reveal|print|dump).{0,24}(prompt|instruction|secret)"; label = "reveal-secret-pattern"; weight = 6 },
    [pscustomobject]@{ pattern = "(run|execute).{0,20}(script|command|payload)"; label = "execute-payload-pattern"; weight = 5 },
    [pscustomobject]@{ pattern = "(curl|wget).{0,20}https?://"; label = "remote-fetch-command-pattern"; weight = 5 },
    [pscustomobject]@{ pattern = "base64.{0,20}(decode|payload|command)"; label = "base64-command-pattern"; weight = 4 }
  )

  foreach ($rule in $regexRules) {
    if ($content -match [string]$rule.pattern) {
      $score += [int]$rule.weight
      [void]$foundMatches.Add([string]$rule.label)
    }
  }

  return [pscustomobject]@{
    score = $score
    matches = @($foundMatches)
    flagged = ($score -ge $FlagThreshold)
    blocked = ($score -ge $BlockThreshold)
  }
}

function Test-CsvHasMeaningfulRows {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) { return $false }

  $rows = @()
  try {
    $rows = @(Import-Csv -Path $Path)
  } catch {
    return $false
  }

  if ($rows.Count -eq 0) { return $false }
  foreach ($row in $rows) {
    foreach ($key in @("record_url", "case_number", "parcel", "owner_name", "notes", "url", "title")) {
      $prop = $row.PSObject.Properties[$key]
      if ($null -ne $prop -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
        return $true
      }
    }
  }
  return $false
}

function Resolve-LocalInputPath {
  param(
    [pscustomobject]$Source,
    [string]$AutoStagingDir,
    [string]$ManualDropDir
  )

  $explicit = [string]$Source.localPath
  if (-not [string]::IsNullOrWhiteSpace($explicit) -and (Test-Path $explicit)) {
    return $explicit
  }

  $format = ([string]$Source.format).ToLowerInvariant()
  $ext = if ($format -eq "json") { "json" } else { "csv" }
  $key = [string]$Source.key
  if ([string]::IsNullOrWhiteSpace($key)) { return "" }

  if (-not [string]::IsNullOrWhiteSpace($AutoStagingDir)) {
    $staged = Join-Path $AutoStagingDir "$key.$ext"
    if (Test-Path $staged) {
      if ($ext -eq "csv") {
        if (Test-CsvHasMeaningfulRows -Path $staged) {
          return $staged
        }
      } else {
        return $staged
      }
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($ManualDropDir)) {
    $manual = Join-Path $ManualDropDir "$key.$ext"
    if (Test-Path $manual) {
      return $manual
    }
  }

  return ""
}

function Get-SourceRows {
  param(
    [pscustomobject]$Source,
    [int]$TimeoutSec,
    [string]$AutoStagingDir,
    [string]$ManualDropDir
  )

  $format = ([string]$Source.format).ToLowerInvariant()
  $localPath = Resolve-LocalInputPath -Source $Source -AutoStagingDir $AutoStagingDir -ManualDropDir $ManualDropDir
  $rootPath = [string]$Source.rootPath
  $url = Resolve-SourceUrl -Source $Source

  $rows = @()
  $loadedFrom = ""

  if (-not [string]::IsNullOrWhiteSpace($localPath) -and (Test-Path $localPath)) {
    if ($format -eq "csv") {
      $rows = @(Import-Csv -Path $localPath)
    } elseif ($format -eq "json") {
      $doc = Get-Content -Raw $localPath | ConvertFrom-Json
      $rows = @(Expand-JsonRows -Document $doc -RootPath $rootPath)
    }
    $loadedFrom = "local"
  } elseif (-not [string]::IsNullOrWhiteSpace($url)) {
    if ($format -eq "csv") {
      $resp = Invoke-WebRequest -Method Get -Uri $url -TimeoutSec $TimeoutSec
      $rows = @($resp.Content | ConvertFrom-Csv)
    } elseif ($format -eq "json") {
      $doc = Invoke-RestMethod -Method Get -Uri $url -TimeoutSec $TimeoutSec
      $rows = @(Expand-JsonRows -Document $doc -RootPath $rootPath)
    }
    $loadedFrom = "remote"
  } else {
    return [pscustomobject]@{
      rows = @()
      loadedFrom = "none"
      sourceUrl = $url
      status = "skipped_missing_input"
      error = ""
    }
  }

  return [pscustomobject]@{
    rows = $rows
    loadedFrom = $loadedFrom
    sourceUrl = $url
    status = "ok"
    error = ""
  }
}

function Get-SignalScoreParts {
  param(
    [string]$SignalType,
    [string]$DistressStage,
    [string]$EventDateIso,
    [object]$Amount,
    [string]$ParcelKey,
    [string]$OwnerName,
    [string]$CaseNumber
  )

  $signalTypeWeights = @{
    "tax_delinquent" = 28
    "tax_lien" = 30
    "trustee_sale" = 32
    "sheriff_sale" = 34
    "foreclosure" = 30
    "receivership" = 26
    "bankruptcy" = 26
    "ucc_distress" = 20
    "code_enforcement" = 18
    "utility_constraint" = 16
    "permit_supply" = 14
    "rent_comp_signal" = 10
    "cmbs_delinquency" = 30
    "environmental_constraint" = 20
    "ownership_transfer" = 18
    "government_auction_opportunity" = 30
    "grant_opportunity" = 24
    "procurement_opportunity" = 24
    "financial_assistance_rate" = 16
    "workforce_program" = 14
    "community_signal" = 9
  }

  $stageWeights = @{
    "pre_sale" = 8
    "notice_filed" = 12
    "auction_scheduled" = 18
    "auction_complete" = 14
    "active_case" = 14
    "delinquent" = 10
    "pipeline" = 6
    "monitoring" = 4
    "funding_open" = 10
  }

  $signalKey = if ([string]::IsNullOrWhiteSpace($SignalType)) { "" } else { $SignalType.ToLowerInvariant().Trim() }
  $stageKey = if ([string]::IsNullOrWhiteSpace($DistressStage)) { "" } else { $DistressStage.ToLowerInvariant().Trim() }

  $typeScore = if ($signalTypeWeights.ContainsKey($signalKey)) { [int]$signalTypeWeights[$signalKey] } else { 8 }
  $stageScore = if ($stageWeights.ContainsKey($stageKey)) { [int]$stageWeights[$stageKey] } else { 4 }

  $recencyScore = 0
  if (-not [string]::IsNullOrWhiteSpace($EventDateIso)) {
    try {
      $eventDt = [datetime]$EventDateIso
      $ageDays = [math]::Floor(((Get-Date).ToUniversalTime() - $eventDt.ToUniversalTime()).TotalDays)
      if ($ageDays -le 30) {
        $recencyScore = 12
      } elseif ($ageDays -le 90) {
        $recencyScore = 8
      } elseif ($ageDays -le 180) {
        $recencyScore = 4
      }
    } catch {
      $recencyScore = 0
    }
  }

  $amountScore = 0
  if ($null -ne $Amount) {
    $n = [double]$Amount
    if ($n -gt 0) {
      $amountScore = [int][math]::Min(12, [math]::Floor($n / 5000))
    }
  }

  $identityScore = 0
  if (-not [string]::IsNullOrWhiteSpace($ParcelKey)) { $identityScore += 6 }
  if (-not [string]::IsNullOrWhiteSpace($OwnerName)) { $identityScore += 4 }
  if (-not [string]::IsNullOrWhiteSpace($CaseNumber)) { $identityScore += 3 }

  $total = $typeScore + $stageScore + $recencyScore + $amountScore + $identityScore
  $priority = if ($total -ge 55) {
    "high"
  } elseif ($total -ge 35) {
    "medium"
  } else {
    "low"
  }

  return [pscustomobject]@{
    typeScore = $typeScore
    stageScore = $stageScore
    recencyScore = $recencyScore
    amountScore = $amountScore
    identityScore = $identityScore
    totalScore = $total
    priority = $priority
  }
}

function Build-Markdown {
  param([pscustomobject]$Result)

  $lines = @()
  $lines += "# Real Estate Public Signals Run"
  $lines += ""
  $lines += "- generatedAtUtc: $($Result.generatedAtUtc)"
  $lines += "- configuredSources: $($Result.summary.configuredSources)"
  $lines += "- enabledSources: $($Result.summary.enabledSources)"
  $lines += "- stagingDir: $($Result.summary.stagingDir)"
  $lines += "- manualDropDir: $($Result.summary.manualDropDir)"
  $lines += "- loadedSources: $($Result.summary.loadedSources)"
  $lines += "- failedSources: $($Result.summary.failedSources)"
  $lines += "- totalSignals: $($Result.summary.totalSignals)"
  $lines += "- highPrioritySignals: $($Result.summary.highPrioritySignals)"
  $lines += "- mediumPrioritySignals: $($Result.summary.mediumPrioritySignals)"
  $lines += "- promptInjectionScanned: $($Result.summary.promptInjectionScanned)"
  $lines += "- promptInjectionFlagged: $($Result.summary.promptInjectionFlagged)"
  $lines += "- promptInjectionBlocked: $($Result.summary.promptInjectionBlocked)"
  $lines += ""
  $lines += "## Source Status"
  $lines += ""
  $lines += "| Source | Type | Status | Loaded From | Rows | PI Flagged | PI Blocked |"
  $lines += "| --- | --- | --- | --- | ---: | ---: | ---: |"
  foreach ($status in $Result.sourceStatus) {
    $lines += "| $($status.name) | $($status.sourceType) | $($status.status) | $($status.loadedFrom) | $($status.rowsRead) | $($status.flaggedRows) | $($status.blockedRows) |"
  }
  $lines += ""
  $lines += "## Top Signals"
  $lines += ""
  $lines += "| Score | Priority | Signal Type | Stage | City | Parcel | Owner | Source |"
  $lines += "| ---: | --- | --- | --- | --- | --- | --- | --- |"
  foreach ($signal in $Result.topSignals) {
    $lines += "| $($signal.signalScore) | $($signal.priority) | $($signal.signalType) | $($signal.distressStage) | $($signal.city) | $($signal.parcelId) | $($signal.ownerName) | $($signal.sourceName) |"
  }
  return ($lines -join "`n") + "`n"
}

if (-not (Test-Path $ConfigPath)) {
  throw "Public signal config not found: $ConfigPath"
}

$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$sources = @($config.sources)
if ($sources.Count -eq 0) {
  throw "No sources configured in $ConfigPath"
}

$allSignals = @()
$sourceStatus = @()
$promptInjectionScannedTotal = 0
$promptInjectionFlaggedTotal = 0
$promptInjectionBlockedTotal = 0
$sourceInjectionStats = @{}

foreach ($source in $sources) {
  $sourceKey = [string]$source.key
  $sourceInjectionStats[$sourceKey] = [pscustomobject]@{
    scannedRows = 0
    flaggedRows = 0
    blockedRows = 0
  }

  $enabled = $true
  if ($null -ne $source.enabled) {
    $enabled = [bool]$source.enabled
  }
  if (-not $enabled) {
    $sourceStatus += [pscustomobject]@{
      key = $sourceKey
      name = [string]$source.name
      sourceType = [string]$source.sourceType
      status = "disabled"
      loadedFrom = "none"
      rowsRead = 0
      scannedRows = 0
      flaggedRows = 0
      blockedRows = 0
      error = ""
    }
    continue
  }

  try {
    $loaded = Get-SourceRows -Source $source -TimeoutSec $TimeoutSec -AutoStagingDir $AutoStagingDir -ManualDropDir $ManualDropDir
    $rows = @($loaded.rows)
    $idx = 0

    foreach ($row in $rows) {
      $idx += 1
      $fieldMap = $source.fieldMap
      $parcelId = Get-FieldValue -Row $row -FieldCandidates $fieldMap.parcelId
      $ownerName = Get-FieldValue -Row $row -FieldCandidates $fieldMap.ownerName
      $address = Get-FieldValue -Row $row -FieldCandidates $fieldMap.address
      $city = Get-FieldValue -Row $row -FieldCandidates $fieldMap.city
      $state = Get-FieldValue -Row $row -FieldCandidates $fieldMap.state
      $postalCode = Get-FieldValue -Row $row -FieldCandidates $fieldMap.postalCode
      $signalType = Get-FieldValue -Row $row -FieldCandidates $fieldMap.signalType
      $distressStage = Get-FieldValue -Row $row -FieldCandidates $fieldMap.distressStage
      $amount = Convert-ToNullableNumber (Get-FieldValue -Row $row -FieldCandidates $fieldMap.amount)
      $eventDateIso = Convert-ToIsoDateString (Get-FieldValue -Row $row -FieldCandidates $fieldMap.eventDate)
      $caseNumber = Get-FieldValue -Row $row -FieldCandidates $fieldMap.caseNumber
      $recordUrl = Get-FieldValue -Row $row -FieldCandidates $fieldMap.recordUrl
      $notes = Get-FieldValue -Row $row -FieldCandidates $fieldMap.notes

      if ([string]::IsNullOrWhiteSpace($signalType) -and -not [string]::IsNullOrWhiteSpace([string]$source.defaultSignalType)) {
        $signalType = [string]$source.defaultSignalType
      }
      if ([string]::IsNullOrWhiteSpace($distressStage) -and -not [string]::IsNullOrWhiteSpace([string]$source.defaultDistressStage)) {
        $distressStage = [string]$source.defaultDistressStage
      }

      $injectionText = @(
        $notes,
        $recordUrl,
        $ownerName,
        $address,
        $caseNumber
      ) -join " "
      $injectionAssessment = Get-PromptInjectionAssessment -Text $injectionText -FlagThreshold $PromptInjectionFlagThreshold -BlockThreshold $PromptInjectionBlockThreshold
      $sourceInjectionStats[$sourceKey].scannedRows += 1
      $promptInjectionScannedTotal += 1
      if ([bool]$injectionAssessment.flagged) {
        $sourceInjectionStats[$sourceKey].flaggedRows += 1
        $promptInjectionFlaggedTotal += 1
      }

      $signalTypeLower = ([string]$signalType).ToLowerInvariant()
      $communityInjectionBlocked = $false
      if ($signalTypeLower -eq "community_signal") {
        if ([int]$injectionAssessment.score -ge $CommunityPromptInjectionBlockThreshold) {
          $communityInjectionBlocked = $true
        }
      }
      if ($communityInjectionBlocked) {
        $sourceInjectionStats[$sourceKey].blockedRows += 1
        $promptInjectionBlockedTotal += 1
        continue
      }

      $parcelKey = Normalize-ParcelKey $parcelId
      $ownerKey = Normalize-TextKey $ownerName
      $scoreParts = Get-SignalScoreParts -SignalType $signalType -DistressStage $distressStage -EventDateIso $eventDateIso -Amount $amount -ParcelKey $parcelKey -OwnerName $ownerName -CaseNumber $caseNumber

      $allSignals += [pscustomobject]@{
        signalId = ("{0}:{1}" -f $sourceKey, $idx)
        sourceKey = $sourceKey
        sourceName = [string]$source.name
        sourceType = [string]$source.sourceType
        sourceCadence = [string]$source.cadence
        signalType = [string]$signalType
        distressStage = [string]$distressStage
        signalScore = [int]$scoreParts.totalScore
        priority = [string]$scoreParts.priority
        scoreBreakdown = $scoreParts
        parcelId = [string]$parcelId
        parcelKey = [string]$parcelKey
        ownerName = [string]$ownerName
        ownerKey = [string]$ownerKey
        address = [string]$address
        city = [string]$city
        state = [string]$state
        postalCode = [string]$postalCode
        amount = $amount
        eventDate = [string]$eventDateIso
        caseNumber = [string]$caseNumber
        recordUrl = [string]$recordUrl
        notes = [string]$notes
        promptInjectionScore = [int]$injectionAssessment.score
        promptInjectionFlags = @($injectionAssessment.matches)
        isSuspectedPromptInjection = [bool]$injectionAssessment.flagged
      }
    }

    $sourceStatus += [pscustomobject]@{
      key = $sourceKey
      name = [string]$source.name
      sourceType = [string]$source.sourceType
      status = [string]$loaded.status
      loadedFrom = [string]$loaded.loadedFrom
      rowsRead = $rows.Count
      scannedRows = [int]$sourceInjectionStats[$sourceKey].scannedRows
      flaggedRows = [int]$sourceInjectionStats[$sourceKey].flaggedRows
      blockedRows = [int]$sourceInjectionStats[$sourceKey].blockedRows
      error = [string]$loaded.error
    }
  } catch {
    $sourceStatus += [pscustomobject]@{
      key = $sourceKey
      name = [string]$source.name
      sourceType = [string]$source.sourceType
      status = "error"
      loadedFrom = "none"
      rowsRead = 0
      scannedRows = [int]$sourceInjectionStats[$sourceKey].scannedRows
      flaggedRows = [int]$sourceInjectionStats[$sourceKey].flaggedRows
      blockedRows = [int]$sourceInjectionStats[$sourceKey].blockedRows
      error = [string]$_.Exception.Message
    }
  }
}

$rankedSignals = @(
  $allSignals |
    Sort-Object @{ Expression = { $_.signalScore }; Descending = $true }, @{ Expression = { $_.eventDate }; Descending = $true }
)

$topSignals = @($rankedSignals | Select-Object -First $Top)

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$result = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  configPath = (Resolve-Path $ConfigPath).Path
  summary = [pscustomobject]@{
    configuredSources = $sources.Count
    enabledSources = (@($sources | Where-Object { [bool]$_.enabled -ne $false })).Count
    stagingDir = if (Test-Path $AutoStagingDir) { (Resolve-Path $AutoStagingDir).Path } else { $AutoStagingDir }
    manualDropDir = if (Test-Path $ManualDropDir) { (Resolve-Path $ManualDropDir).Path } else { $ManualDropDir }
    loadedSources = (@($sourceStatus | Where-Object { $_.status -eq "ok" -and $_.rowsRead -gt 0 })).Count
    failedSources = (@($sourceStatus | Where-Object { $_.status -eq "error" })).Count
    totalSignals = $allSignals.Count
    highPrioritySignals = (@($allSignals | Where-Object { $_.priority -eq "high" })).Count
    mediumPrioritySignals = (@($allSignals | Where-Object { $_.priority -eq "medium" })).Count
    lowPrioritySignals = (@($allSignals | Where-Object { $_.priority -eq "low" })).Count
    promptInjectionScanned = $promptInjectionScannedTotal
    promptInjectionFlagged = $promptInjectionFlaggedTotal
    promptInjectionBlocked = $promptInjectionBlockedTotal
  }
  sourceStatus = $sourceStatus
  topSignals = $topSignals
  signals = $rankedSignals
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$jsonPath = Join-Path $OutputDir "public-signals-$runId.json"
$mdPath = Join-Path $OutputDir "public-signals-$runId.md"
$latestJsonPath = Join-Path $OutputDir "public-signals-latest.json"
$latestMdPath = Join-Path $OutputDir "public-signals-latest.md"

$result | ConvertTo-Json -Depth 12 | Set-Content -Path $jsonPath -Encoding UTF8
$result | ConvertTo-Json -Depth 12 | Set-Content -Path $latestJsonPath -Encoding UTF8
$markdown = Build-Markdown -Result $result
$markdown | Set-Content -Path $mdPath -Encoding UTF8
$markdown | Set-Content -Path $latestMdPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $mdPath"
Write-Host "Wrote $latestJsonPath"
Write-Host "Wrote $latestMdPath"
