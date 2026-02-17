<#
.SYNOPSIS
Builds a time-aware studio needs context from versioned requirements and current signals.

.DESCRIPTION
Reads the versioned profile at docs/real-estate/studio-needs-profile.json and resolves:
- active profile
- next profile
- demand-pressure triggers from operational thresholds
- escalation recommendation for when growth profile should be treated as current

This layer is deterministic and model-free.

.OUTPUTS
output/real-estate/needs-context-<timestamp>.json
output/real-estate/needs-context-<timestamp>.md
output/real-estate/needs-context-latest.json
output/real-estate/needs-context-latest.md
#>
param(
  [string]$NeedsProfilePath = "docs/real-estate/studio-needs-profile.json",
  [string]$OutputDir = "output/real-estate",
  [string]$AgenticResearchPath = "output/real-estate/agentic-research-latest.json",
  [string]$PublicSignalsPath = "output/real-estate/public-signals-latest.json"
)

$ErrorActionPreference = "Stop"

function Resolve-LatestJsonPath {
  param(
    [string]$PreferredPath,
    [string]$SearchDirectory,
    [string]$Filter
  )

  if (-not [string]::IsNullOrWhiteSpace($PreferredPath) -and (Test-Path $PreferredPath)) {
    return (Resolve-Path $PreferredPath).Path
  }
  if ([string]::IsNullOrWhiteSpace($SearchDirectory) -or [string]::IsNullOrWhiteSpace($Filter)) {
    return $PreferredPath
  }
  if (-not (Test-Path $SearchDirectory)) {
    return $PreferredPath
  }

  $candidate = Get-ChildItem -Path $SearchDirectory -Filter $Filter -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($null -eq $candidate) {
    return $PreferredPath
  }
  return $candidate.FullName
}

function Get-JsonDoc {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) { return $null }
  try {
    return Get-Content -Raw $Path | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-DateOrMin {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return [datetime]::MinValue }
  try {
    return ([datetime]$Value).ToUniversalTime()
  } catch {
    return [datetime]::MinValue
  }
}

function Get-DateOrMax {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return [datetime]::MaxValue }
  try {
    return ([datetime]$Value).ToUniversalTime()
  } catch {
    return [datetime]::MaxValue
  }
}

function Resolve-ActiveProfile {
  param(
    [object[]]$Profiles,
    [datetime]$NowUtc
  )

  $active = $Profiles | Where-Object {
    $start = Get-DateOrMin ([string]$_.effectiveFrom)
    $end = Get-DateOrMax ([string]$_.effectiveTo)
    $NowUtc -ge $start -and $NowUtc -le $end
  } | Select-Object -First 1
  if ($null -ne $active) { return $active }

  $latestPast = $Profiles | Where-Object {
    $start = Get-DateOrMin ([string]$_.effectiveFrom)
    $start -le $NowUtc
  } | Sort-Object { Get-DateOrMin ([string]$_.effectiveFrom) } -Descending | Select-Object -First 1
  if ($null -ne $latestPast) { return $latestPast }

  return $Profiles | Sort-Object { Get-DateOrMin ([string]$_.effectiveFrom) } | Select-Object -First 1
}

function Resolve-NextProfile {
  param(
    [object[]]$Profiles,
    [datetime]$NowUtc
  )

  return $Profiles | Where-Object {
    (Get-DateOrMin ([string]$_.effectiveFrom)) -gt $NowUtc
  } | Sort-Object { Get-DateOrMin ([string]$_.effectiveFrom) } | Select-Object -First 1
}

function Add-Trigger {
  param(
    [System.Collections.Generic.List[object]]$Triggers,
    [string]$Signal,
    [object]$Current,
    [object]$Threshold,
    [int]$Weight
  )
  [void]$Triggers.Add([pscustomobject]@{
    signal = $Signal
    current = $Current
    threshold = $Threshold
    weight = $Weight
  })
}

function Build-Markdown {
  param([pscustomobject]$Result)

  $lines = @()
  $lines += "# Real Estate Needs Context"
  $lines += ""
  $lines += "- generatedAtUtc: $($Result.generatedAtUtc)"
  $lines += "- activeProfileId: $($Result.summary.activeProfileId)"
  $lines += "- recommendedProfileId: $($Result.summary.recommendedProfileId)"
  $lines += "- demandPressureScore: $($Result.summary.demandPressureScore)"
  $lines += "- marketOpportunityScore: $($Result.summary.marketOpportunityScore)"
  $lines += "- escalationRecommended: $($Result.summary.escalationRecommended)"
  $lines += ""
  $lines += "## Demand Triggers"
  $lines += ""
  if (@($Result.demandTriggers).Count -eq 0) {
    $lines += "- none"
  } else {
    foreach ($trigger in $Result.demandTriggers) {
      $lines += "- $($trigger.signal): current=$($trigger.current), threshold=$($trigger.threshold), weight=$($trigger.weight)"
    }
  }
  $lines += ""
  $lines += "## Active Profile Hard Requirements"
  $lines += ""
  foreach ($prop in $Result.activeProfile.hardRequirements.PSObject.Properties) {
    $value = $prop.Value
    if ($value -is [System.Collections.IEnumerable] -and -not ($value -is [string])) {
      $value = (@($value) -join ", ")
    }
    $lines += "- $($prop.Name): $value"
  }
  if ($null -ne $Result.nextProfile) {
    $lines += ""
    $lines += "## Next Profile Delta"
    $lines += ""
    if (@($Result.nextProfileDelta).Count -eq 0) {
      $lines += "- none"
    } else {
      foreach ($delta in $Result.nextProfileDelta) {
        $lines += "- $($delta.field): $($delta.current) -> $($delta.next)"
      }
    }
  }
  return ($lines -join "`n") + "`n"
}

if (-not (Test-Path $NeedsProfilePath)) {
  throw "Needs profile not found: $NeedsProfilePath"
}

$needsDoc = Get-Content -Raw $NeedsProfilePath | ConvertFrom-Json
$profiles = @($needsDoc.profiles)
if ($profiles.Count -eq 0) {
  throw "No profiles found in $NeedsProfilePath"
}

$resolvedAgenticPath = Resolve-LatestJsonPath -PreferredPath $AgenticResearchPath -SearchDirectory $OutputDir -Filter "agentic-research-*.json"
$resolvedPublicSignalsPath = Resolve-LatestJsonPath -PreferredPath $PublicSignalsPath -SearchDirectory $OutputDir -Filter "public-signals-*.json"

$agenticDoc = Get-JsonDoc -Path $resolvedAgenticPath
$publicDoc = Get-JsonDoc -Path $resolvedPublicSignalsPath

$nowUtc = (Get-Date).ToUniversalTime()
$activeProfile = Resolve-ActiveProfile -Profiles $profiles -NowUtc $nowUtc
$nextProfile = Resolve-NextProfile -Profiles $profiles -NowUtc $nowUtc

$ops = $needsDoc.operationalSignals
$policy = $needsDoc.policyThresholds

$triggers = New-Object System.Collections.Generic.List[object]
$demandPressureScore = 0

if ($null -ne $ops -and $null -ne $policy) {
  if ([int]$ops.waitlistDays -ge [int]$policy.waitlistDaysHigh) {
    Add-Trigger -Triggers $triggers -Signal "waitlistDays" -Current $ops.waitlistDays -Threshold $policy.waitlistDaysHigh -Weight 2
    $demandPressureScore += 2
  }
  if ([int]$ops.weeklyKilnLoads -ge [int]$policy.weeklyKilnLoadsHigh) {
    Add-Trigger -Triggers $triggers -Signal "weeklyKilnLoads" -Current $ops.weeklyKilnLoads -Threshold $policy.weeklyKilnLoadsHigh -Weight 2
    $demandPressureScore += 2
  }
  if ([int]$ops.membershipDemandUtilizationPct -ge [int]$policy.utilizationPctHigh) {
    Add-Trigger -Triggers $triggers -Signal "membershipDemandUtilizationPct" -Current $ops.membershipDemandUtilizationPct -Threshold $policy.utilizationPctHigh -Weight 2
    $demandPressureScore += 2
  }
  if ([double]$ops.outsourceSpendMonthlyUsd -ge [double]$policy.outsourceSpendHighUsd) {
    Add-Trigger -Triggers $triggers -Signal "outsourceSpendMonthlyUsd" -Current $ops.outsourceSpendMonthlyUsd -Threshold $policy.outsourceSpendHighUsd -Weight 1
    $demandPressureScore += 1
  }
  if ([int]$ops.powerConstraintIncidentsMonthly -ge [int]$policy.powerConstraintIncidentsHigh) {
    Add-Trigger -Triggers $triggers -Signal "powerConstraintIncidentsMonthly" -Current $ops.powerConstraintIncidentsMonthly -Threshold $policy.powerConstraintIncidentsHigh -Weight 2
    $demandPressureScore += 2
  }
}

$marketOpportunityScore = 0
if ($null -ne $agenticDoc -and $null -ne $agenticDoc.summary) {
  if ([int]$agenticDoc.summary.leadsAboveThreshold -ge 25) { $marketOpportunityScore += 2 }
  if ([int]$agenticDoc.summary.sourcesWithHits -ge 8) { $marketOpportunityScore += 1 }
}
if ($null -ne $publicDoc -and $null -ne $publicDoc.summary) {
  if ([int]$publicDoc.summary.highPrioritySignals -ge 20) { $marketOpportunityScore += 2 }
}

$escalationRecommended = ($demandPressureScore -ge 4) -and ($null -ne $nextProfile)
$recommendedProfile = if ($escalationRecommended) { $nextProfile } else { $activeProfile }

$nextProfileDelta = @()
if ($null -ne $nextProfile -and $null -ne $activeProfile -and $null -ne $activeProfile.hardRequirements -and $null -ne $nextProfile.hardRequirements) {
  foreach ($prop in $activeProfile.hardRequirements.PSObject.Properties) {
    $nextProp = $nextProfile.hardRequirements.PSObject.Properties[$prop.Name]
    if ($null -eq $nextProp) { continue }
    $curr = $prop.Value
    $next = $nextProp.Value
    $currNorm = if ($curr -is [System.Collections.IEnumerable] -and -not ($curr -is [string])) { (@($curr) -join ",") } else { [string]$curr }
    $nextNorm = if ($next -is [System.Collections.IEnumerable] -and -not ($next -is [string])) { (@($next) -join ",") } else { [string]$next }
    if ($currNorm -ne $nextNorm) {
      $nextProfileDelta += [pscustomobject]@{
        field = [string]$prop.Name
        current = $currNorm
        next = $nextNorm
      }
    }
  }
}

$runId = $nowUtc.ToString("yyyyMMddTHHmmssZ")
$result = [pscustomobject]@{
  generatedAtUtc = $nowUtc.ToString("o")
  runId = $runId
  summary = [pscustomobject]@{
    activeProfileId = [string]$activeProfile.id
    recommendedProfileId = [string]$recommendedProfile.id
    nextProfileId = if ($null -ne $nextProfile) { [string]$nextProfile.id } else { "" }
    demandPressureScore = $demandPressureScore
    marketOpportunityScore = $marketOpportunityScore
    escalationRecommended = $escalationRecommended
  }
  needsProfilePath = (Resolve-Path $NeedsProfilePath).Path
  sourceInputs = [pscustomobject]@{
    agenticResearchPath = $resolvedAgenticPath
    publicSignalsPath = $resolvedPublicSignalsPath
  }
  operationalSignals = $ops
  policyThresholds = $policy
  demandTriggers = @($triggers.ToArray())
  activeProfile = $activeProfile
  recommendedProfile = $recommendedProfile
  nextProfile = $nextProfile
  nextProfileDelta = $nextProfileDelta
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$jsonPath = Join-Path $OutputDir "needs-context-$runId.json"
$mdPath = Join-Path $OutputDir "needs-context-$runId.md"
$latestJsonPath = Join-Path $OutputDir "needs-context-latest.json"
$latestMdPath = Join-Path $OutputDir "needs-context-latest.md"

$result | ConvertTo-Json -Depth 12 | Set-Content -Path $jsonPath -Encoding UTF8
$result | ConvertTo-Json -Depth 12 | Set-Content -Path $latestJsonPath -Encoding UTF8
$markdown = Build-Markdown -Result $result
$markdown | Set-Content -Path $mdPath -Encoding UTF8
$markdown | Set-Content -Path $latestMdPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $mdPath"
Write-Host "Wrote $latestJsonPath"
Write-Host "Wrote $latestMdPath"
