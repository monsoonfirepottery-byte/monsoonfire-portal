<#
.SYNOPSIS
Builds deterministic opportunity intelligence and agent task queues.

.DESCRIPTION
Combines latest:
- agentic research leads
- structured public signals
- parcel graph context
- macro context
- needs context and scoring weights

Produces explainable opportunity ranking, confidence/urgency scores, and an
agent-ready task queue without requiring per-run model calls.

.OUTPUTS
output/real-estate/intelligence-analysis-<timestamp>.json
output/real-estate/intelligence-analysis-<timestamp>.md
output/real-estate/intelligence-analysis-latest.json
output/real-estate/intelligence-task-queue-latest.json
output/real-estate/intelligence-entity-state-latest.json
#>
param(
  [string]$OutputDir = "output/real-estate",
  [string]$AgenticResearchPath = "output/real-estate/agentic-research-latest.json",
  [string]$PublicSignalsPath = "output/real-estate/public-signals-latest.json",
  [string]$ParcelGraphPath = "output/real-estate/parcel-graph-latest.json",
  [string]$MacroContextPath = "output/real-estate/macro-context-latest.json",
  [string]$NeedsContextPath = "output/real-estate/needs-context-latest.json",
  [string]$WeightsPath = "docs/real-estate/intelligence-weights.json",
  [int]$Top = 25,
  [int]$MinOpportunityScore = 35
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
  if ($null -eq $candidate) { return $PreferredPath }
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

function Normalize-Key {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  return ([regex]::Replace($Value.ToLowerInvariant(), "[^a-z0-9]+", "-")).Trim("-")
}

function Get-DateAgeDays {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return 9999 }
  try {
    $dt = ([datetime]$Value).ToUniversalTime()
    return [math]::Max(0, [int][math]::Floor(((Get-Date).ToUniversalTime() - $dt).TotalDays))
  } catch {
    return 9999
  }
}

function Get-TextNumberMax {
  param(
    [string]$Text,
    [string]$Pattern
  )
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  $matches = [regex]::Matches($Text.ToLowerInvariant(), $Pattern)
  if ($matches.Count -eq 0) { return $null }
  $max = $null
  foreach ($m in $matches) {
    $raw = [string]$m.Groups["n"].Value
    if ([string]::IsNullOrWhiteSpace($raw)) { continue }
    $val = 0
    if ([int]::TryParse($raw, [ref]$val)) {
      if ($null -eq $max -or $val -gt $max) { $max = $val }
    }
  }
  return $max
}

function Clamp-Score {
  param([double]$Value)
  if ($Value -lt 0) { return 0 }
  if ($Value -gt 100) { return 100 }
  return [int][math]::Round($Value, 0)
}

function Get-MarketRegime {
  param([object]$MacroDoc)
  if ($null -eq $MacroDoc) { return "normal" }
  $fed = 0.0
  $creYoy = 0.0
  try { $fed = [double]$MacroDoc.fedFunds.latest } catch { $fed = 0.0 }
  try { $creYoy = [double]$MacroDoc.crePriceIndex.yoyPct } catch { $creYoy = 0.0 }

  if ($fed -ge 4.0 -and $creYoy -lt 0.0) { return "distress_window" }
  if ($fed -ge 4.0 -and $creYoy -le 2.0) { return "tightening" }
  return "normal"
}

function Get-Classification {
  param(
    [int]$Score,
    [pscustomobject]$Thresholds
  )
  if ($Score -ge [int]$Thresholds.pursue) { return "pursue" }
  if ($Score -ge [int]$Thresholds.investigateNow) { return "investigate_now" }
  if ($Score -ge [int]$Thresholds.watch) { return "watch" }
  return "ignore"
}

function Build-Markdown {
  param([pscustomobject]$Result)

  $lines = @()
  $lines += "# Real Estate Intelligence Analysis Run"
  $lines += ""
  $lines += "- generatedAtUtc: $($Result.generatedAtUtc)"
  $lines += "- marketRegime: $($Result.summary.marketRegime)"
  $lines += "- opportunities: $($Result.summary.totalOpportunities)"
  $lines += "- pursue: $($Result.summary.pursueCount)"
  $lines += "- investigate_now: $($Result.summary.investigateNowCount)"
  $lines += "- watch: $($Result.summary.watchCount)"
  $lines += "- tasks: $($Result.summary.taskCount)"
  $lines += ""
  $lines += "## Top Opportunities"
  $lines += ""
  $lines += "| Score | Confidence | Urgency | Class | Entity | City | Why Now |"
  $lines += "| ---: | ---: | ---: | --- | --- | --- | --- |"
  foreach ($opp in $Result.topOpportunities) {
    $why = @($opp.whyNow | Select-Object -First 2) -join "; "
    $lines += "| $($opp.opportunityScore) | $($opp.confidenceScore) | $($opp.urgencyScore) | $($opp.classification) | $($opp.entityKey) | $($opp.cityHint) | $why |"
  }
  $lines += ""
  $lines += "## Agent Task Queue"
  $lines += ""
  if (@($Result.taskQueue).Count -eq 0) {
    $lines += "- none"
  } else {
    foreach ($task in $Result.taskQueue) {
      $lines += "- [$($task.priority)] $($task.agentRole): $($task.objective) (opportunity=$($task.opportunityId))"
    }
  }
  return ($lines -join "`n") + "`n"
}

$resolvedAgenticPath = Resolve-LatestJsonPath -PreferredPath $AgenticResearchPath -SearchDirectory $OutputDir -Filter "agentic-research-*.json"
$resolvedPublicPath = Resolve-LatestJsonPath -PreferredPath $PublicSignalsPath -SearchDirectory $OutputDir -Filter "public-signals-*.json"
$resolvedParcelPath = Resolve-LatestJsonPath -PreferredPath $ParcelGraphPath -SearchDirectory $OutputDir -Filter "parcel-graph-*.json"
$resolvedNeedsPath = Resolve-LatestJsonPath -PreferredPath $NeedsContextPath -SearchDirectory $OutputDir -Filter "needs-context-*.json"
$resolvedMacroPath = Resolve-LatestJsonPath -PreferredPath $MacroContextPath -SearchDirectory $OutputDir -Filter "macro-context-*.json"

$agenticDoc = Get-JsonDoc -Path $resolvedAgenticPath
$publicDoc = Get-JsonDoc -Path $resolvedPublicPath
$parcelDoc = Get-JsonDoc -Path $resolvedParcelPath
$needsDoc = Get-JsonDoc -Path $resolvedNeedsPath
$macroDoc = Get-JsonDoc -Path $resolvedMacroPath
$weightsDoc = Get-JsonDoc -Path $WeightsPath

if ($null -eq $weightsDoc) {
  $weightsDoc = [pscustomobject]@{
    weights = [pscustomobject]@{ distress = 0.35; mispricing = 0.2; strategicFit = 0.25; liquidity = 0.1; executionRisk = 0.1 }
    confidenceWeights = [pscustomobject]@{ corroboration = 0.4; dataQuality = 0.3; freshness = 0.2; sourceTrust = 0.1 }
    thresholds = [pscustomobject]@{ pursue = 75; investigateNow = 55; watch = 35 }
    taskThresholds = [pscustomobject]@{ highPriorityOpportunity = 70; confidenceForNegotiation = 65 }
  }
}

$marketRegime = Get-MarketRegime -MacroDoc $macroDoc
$needsProfile = $null
if ($null -ne $needsDoc -and $null -ne $needsDoc.recommendedProfile) {
  $needsProfile = $needsDoc.recommendedProfile
} elseif ($null -ne $needsDoc -and $null -ne $needsDoc.activeProfile) {
  $needsProfile = $needsDoc.activeProfile
}

$hardReq = if ($null -ne $needsProfile) { $needsProfile.hardRequirements } else { $null }
$prefReq = if ($null -ne $needsProfile) { $needsProfile.preferences } else { $null }

$entityMap = @{}

$topLeads = @()
if ($null -ne $agenticDoc -and $null -ne $agenticDoc.topLeads) {
  $topLeads = @($agenticDoc.topLeads)
}
$signals = @()
if ($null -ne $publicDoc -and $null -ne $publicDoc.signals) {
  $signals = @($publicDoc.signals)
}

foreach ($lead in $topLeads) {
  $key = ""
  if (-not [string]::IsNullOrWhiteSpace([string]$lead.parcelId)) {
    $key = "parcel:" + (Normalize-Key ([string]$lead.parcelId))
  } elseif (-not [string]::IsNullOrWhiteSpace([string]$lead.url)) {
    $key = "url:" + (Normalize-Key ([string]$lead.url))
  } else {
    $key = "lead:" + (Normalize-Key (([string]$lead.title) + "|" + ([string]$lead.cityHint)))
  }

  if (-not $entityMap.ContainsKey($key)) {
    $entityMap[$key] = [pscustomobject]@{
      entityKey = $key
      leads = @()
      signals = @()
      cityHint = [string]$lead.cityHint
    }
  }
  $entityMap[$key].leads += $lead
}

foreach ($signal in $signals) {
  $key = ""
  if (-not [string]::IsNullOrWhiteSpace([string]$signal.parcelId)) {
    $key = "parcel:" + (Normalize-Key ([string]$signal.parcelId))
  } elseif (-not [string]::IsNullOrWhiteSpace([string]$signal.caseNumber)) {
    $key = "case:" + (Normalize-Key ([string]$signal.caseNumber))
  } else {
    $key = "signal:" + (Normalize-Key (([string]$signal.sourceKey) + "|" + ([string]$signal.ownerName) + "|" + ([string]$signal.city)))
  }

  if (-not $entityMap.ContainsKey($key)) {
    $entityMap[$key] = [pscustomobject]@{
      entityKey = $key
      leads = @()
      signals = @()
      cityHint = [string]$signal.city
    }
  }
  $entityMap[$key].signals += $signal
}

$opportunities = @()
$taskQueue = @()
$entityStates = @()
$taskIndex = 0

foreach ($entry in $entityMap.GetEnumerator()) {
  $entity = $entry.Value
  $leadsForEntity = @($entity.leads)
  $signalsForEntity = @($entity.signals)
  if ($leadsForEntity.Count -eq 0 -and $signalsForEntity.Count -eq 0) { continue }

  $contentParts = @()
  $sourceKeys = New-Object System.Collections.Generic.HashSet[string]
  foreach ($lead in $leadsForEntity) {
    $contentParts += [string]$lead.title
    $contentParts += [string]$lead.summary
    if (-not [string]::IsNullOrWhiteSpace([string]$lead.sourceKey)) { [void]$sourceKeys.Add([string]$lead.sourceKey) }
  }
  foreach ($signal in $signalsForEntity) {
    $contentParts += [string]$signal.notes
    $contentParts += [string]$signal.signalType
    $contentParts += [string]$signal.distressStage
    if (-not [string]::IsNullOrWhiteSpace([string]$signal.sourceKey)) { [void]$sourceKeys.Add([string]$signal.sourceKey) }
  }
  $content = ($contentParts -join " ").ToLowerInvariant()

  $maxLeadDistress = 0
  $maxGovDistress = 0
  $maxLeadScore = 0
  foreach ($lead in $leadsForEntity) {
    try { $maxLeadDistress = [math]::Max($maxLeadDistress, [int]$lead.distressScore) } catch {}
    try { $maxGovDistress = [math]::Max($maxGovDistress, [int]$lead.governmentDistressScore) } catch {}
    try { $maxLeadScore = [math]::Max($maxLeadScore, [int]$lead.leadScore) } catch {}
  }

  $maxSignalScore = 0
  $highPrioritySignalCount = 0
  $grantSignalCount = 0
  foreach ($signal in $signalsForEntity) {
    $score = 0
    try { $score = [int]$signal.signalScore } catch { $score = 0 }
    $maxSignalScore = [math]::Max($maxSignalScore, $score)
    if ([string]$signal.priority -eq "high") { $highPrioritySignalCount += 1 }
    if ([string]$signal.signalType -eq "grant_opportunity") { $grantSignalCount += 1 }
  }

  $distressRaw = ($maxLeadDistress * 2) + ($maxGovDistress * 2) + ([math]::Min(40, [int]($maxSignalScore * 0.7))) + ($highPrioritySignalCount * 4)
  $mispricingRaw = ($maxLeadDistress * 2) + ($highPrioritySignalCount * 6)
  if ($content -match "price reduced|below market|motivated seller|vacant|sublease|must sell|fire sale") {
    $mispricingRaw += 20
  }

  $ampsFound = Get-TextNumberMax -Text $content -Pattern "(?<n>\d{2,4})\s*(amp|amps)\b"
  $sqftFound = Get-TextNumberMax -Text $content -Pattern "(?<n>\d{3,6})\s*(sf|sq\s*ft|square\s*feet)\b"
  $clearHeightFound = Get-TextNumberMax -Text $content -Pattern "(?<n>\d{1,2})\s*(ft|feet)\s*(clear|clearance|height)\b"
  $propaneFound = Get-TextNumberMax -Text $content -Pattern "(?<n>\d{3,5})\s*(gal|gallon)\b"
  $hasThreePhase = ($content -match "three[\s-]?phase|3[\s-]?phase|480v")
  $hasIndustrialType = ($content -match "warehouse|industrial|flex")
  $hasZoningMention = ($content -match "\bi-1\b|\bi-2\b|\bm-1\b|industrial zoning|light industrial")
  $hasNaturalGas = ($content -match "natural gas|gas service")

  $strategicFitRaw = 0
  if ($hasIndustrialType) { $strategicFitRaw += 22 }
  if ($hasZoningMention) { $strategicFitRaw += 10 }

  $missingEvidence = New-Object System.Collections.Generic.List[string]
  $dataFieldsObserved = 0

  if ($null -ne $hardReq) {
    if ($null -ne $hardReq.electricServiceAmpsMin -and [int]$hardReq.electricServiceAmpsMin -gt 0) {
      if ($null -ne $ampsFound) {
        $dataFieldsObserved += 1
        if ([int]$ampsFound -ge [int]$hardReq.electricServiceAmpsMin) {
          $strategicFitRaw += 18
        } else {
          [void]$missingEvidence.Add("electric_service_upgrade_needed")
        }
      } else {
        [void]$missingEvidence.Add("verify_electric_service_amps")
      }
    }
    if ($null -ne $hardReq.threePhaseRequired -and [bool]$hardReq.threePhaseRequired) {
      if ($hasThreePhase) {
        $dataFieldsObserved += 1
        $strategicFitRaw += 12
      } else {
        [void]$missingEvidence.Add("verify_three_phase_power")
      }
    }
    if ($null -ne $hardReq.minSqFt -and [int]$hardReq.minSqFt -gt 0) {
      if ($null -ne $sqftFound) {
        $dataFieldsObserved += 1
        if ([int]$sqftFound -ge [int]$hardReq.minSqFt) { $strategicFitRaw += 10 } else { [void]$missingEvidence.Add("insufficient_sqft_or_verify_floor_area") }
      } else {
        [void]$missingEvidence.Add("verify_sqft")
      }
    }
    if ($null -ne $hardReq.clearHeightFtMin -and [int]$hardReq.clearHeightFtMin -gt 0) {
      if ($null -ne $clearHeightFound) {
        $dataFieldsObserved += 1
        if ([int]$clearHeightFound -ge [int]$hardReq.clearHeightFtMin) { $strategicFitRaw += 8 } else { [void]$missingEvidence.Add("clear_height_below_target_or_verify") }
      } else {
        [void]$missingEvidence.Add("verify_clear_height")
      }
    }
  }
  if ($null -ne $prefReq) {
    if ($null -ne $prefReq.propaneTankGallonsMin -and [int]$prefReq.propaneTankGallonsMin -gt 0) {
      if ($null -ne $propaneFound) {
        $dataFieldsObserved += 1
        if ([int]$propaneFound -ge [int]$prefReq.propaneTankGallonsMin) {
          $strategicFitRaw += 8
        } else {
          [void]$missingEvidence.Add("propane_capacity_below_preference_or_verify")
        }
      } else {
        [void]$missingEvidence.Add("verify_propane_capacity")
      }
    }
    if ($null -ne $prefReq.naturalGasPreferred -and [bool]$prefReq.naturalGasPreferred -and $hasNaturalGas) {
      $dataFieldsObserved += 1
      $strategicFitRaw += 4
    }
  }

  $strategicFit = Clamp-Score ([double]$strategicFitRaw)
  $distress = Clamp-Score ([double]$distressRaw)
  $mispricing = Clamp-Score ([double]$mispricingRaw)

  $liquidityRaw = 0
  $liquidityRaw += [math]::Min(20, $sourceKeys.Count * 4)
  $liquidityRaw += [math]::Min(25, [int]($maxLeadScore / 4))
  if ($marketRegime -eq "distress_window") { $liquidityRaw += 10 }
  $liquidity = Clamp-Score ([double]$liquidityRaw)

  $executionRiskRaw = 20 + ($missingEvidence.Count * 8)
  if ($marketRegime -eq "tightening") { $executionRiskRaw += 8 }
  if ($marketRegime -eq "distress_window") { $executionRiskRaw += 5 }
  $executionRisk = Clamp-Score ([double]$executionRiskRaw)

  $freshnessDays = 9999
  foreach ($lead in $leadsForEntity) {
    $freshnessDays = [math]::Min($freshnessDays, (Get-DateAgeDays ([string]$lead.publishedAt)))
  }
  foreach ($signal in $signalsForEntity) {
    $freshnessDays = [math]::Min($freshnessDays, (Get-DateAgeDays ([string]$signal.eventDate)))
  }
  $freshnessScore = if ($freshnessDays -le 14) { 100 } elseif ($freshnessDays -le 45) { 80 } elseif ($freshnessDays -le 90) { 60 } elseif ($freshnessDays -le 180) { 40 } else { 20 }
  $crossSystemBonus = 0
  if ($signalsForEntity.Count -gt 0 -and $leadsForEntity.Count -gt 0) {
    $crossSystemBonus = 20
  }
  $corroborationScore = Clamp-Score ([double]([math]::Min(100, ($sourceKeys.Count * 20) + $crossSystemBonus)))
  $dataQualityScore = Clamp-Score ([double]([math]::Min(100, ($dataFieldsObserved * 20))))
  $sourceTrustScore = Clamp-Score ([double]([math]::Min(100, 25 + ($signalsForEntity.Count * 3) + ($leadsForEntity.Count * 2))))

  $cw = $weightsDoc.confidenceWeights
  $confidence = Clamp-Score ([double](
      ($corroborationScore * [double]$cw.corroboration) +
      ($dataQualityScore * [double]$cw.dataQuality) +
      ($freshnessScore * [double]$cw.freshness) +
      ($sourceTrustScore * [double]$cw.sourceTrust)
    ))

  $w = $weightsDoc.weights
  $opportunity = Clamp-Score ([double](
      ($distress * [double]$w.distress) +
      ($mispricing * [double]$w.mispricing) +
      ($strategicFit * [double]$w.strategicFit) +
      ($liquidity * [double]$w.liquidity) -
      ($executionRisk * [double]$w.executionRisk)
    ))

  $urgencyRaw = 0
  if ($freshnessDays -le 14) { $urgencyRaw += 45 } elseif ($freshnessDays -le 45) { $urgencyRaw += 30 } elseif ($freshnessDays -le 90) { $urgencyRaw += 20 } else { $urgencyRaw += 10 }
  foreach ($signal in $signalsForEntity) {
    if (([string]$signal.distressStage).ToLowerInvariant() -eq "auction_scheduled") { $urgencyRaw += 25 }
    if (([string]$signal.distressStage).ToLowerInvariant() -eq "notice_filed") { $urgencyRaw += 10 }
  }
  $urgency = Clamp-Score ([double]$urgencyRaw)

  $classification = Get-Classification -Score $opportunity -Thresholds $weightsDoc.thresholds
  if ($classification -eq "ignore" -or $opportunity -lt $MinOpportunityScore) {
    continue
  }

  $whyNow = New-Object System.Collections.Generic.List[string]
  if ($distress -ge 60) { [void]$whyNow.Add("High distress and legal/tax pressure signals are active.") }
  if ($mispricing -ge 55) { [void]$whyNow.Add("Pricing language implies potential discount or motivated disposition.") }
  if ($marketRegime -eq "distress_window") { [void]$whyNow.Add("Macro regime suggests a distress-driven opportunity window.") }
  if ($urgency -ge 60) { [void]$whyNow.Add("Fresh signals and near-term events increase timing urgency.") }
  if (@($whyNow).Count -eq 0) { [void]$whyNow.Add("Sufficient signal overlap to monitor for entry timing.") }

  $riskNotes = New-Object System.Collections.Generic.List[string]
  if ($executionRisk -ge 60) { [void]$riskNotes.Add("Execution risk is elevated due to missing capability and utility evidence.") }
  if ($missingEvidence.Count -gt 0) { [void]$riskNotes.Add("Key facility specs are not fully verified.") }

  $oppId = "opp-" + (Normalize-Key ($entity.entityKey + "-" + ((Get-Date).ToUniversalTime().ToString("yyyyMMdd"))))
  $opportunityObj = [pscustomobject]@{
    opportunityId = $oppId
    entityKey = $entity.entityKey
    cityHint = [string]$entity.cityHint
    classification = $classification
    opportunityScore = $opportunity
    confidenceScore = $confidence
    urgencyScore = $urgency
    distressScore = $distress
    mispricingScore = $mispricing
    strategicFitScore = $strategicFit
    liquidityScore = $liquidity
    executionRiskScore = $executionRisk
    evidenceCounts = [pscustomobject]@{
      leadCount = $leadsForEntity.Count
      signalCount = $signalsForEntity.Count
      sourceCount = $sourceKeys.Count
    }
    scoreBreakdown = [pscustomobject]@{
      distress = $distress
      mispricing = $mispricing
      strategicFit = $strategicFit
      liquidity = $liquidity
      executionRisk = $executionRisk
    }
    requiredNextEvidence = @($missingEvidence.ToArray() | Select-Object -Unique)
    whyNow = @($whyNow.ToArray())
    riskNotes = @($riskNotes.ToArray())
  }
  $opportunities += $opportunityObj

  $priority = if ($opportunity -ge [int]$weightsDoc.taskThresholds.highPriorityOpportunity) { "high" } elseif ($opportunity -ge [int]$weightsDoc.thresholds.investigateNow) { "medium" } else { "low" }

  if ($missingEvidence.Count -gt 0) {
    $taskIndex += 1
    $taskQueue += [pscustomobject]@{
      taskId = ("task-{0:D4}" -f $taskIndex)
      opportunityId = $oppId
      priority = $priority
      agentRole = "scout_verifier_agent"
      objective = "Verify utility and facility capability requirements for expansion fit."
      requiredInputs = @($missingEvidence.ToArray() | Select-Object -Unique)
      acceptanceCriteria = @(
        "Utility and facility specs confirmed with source links or broker confirmation.",
        "Each missing capability is marked pass/fail for current and next profile."
      )
      dueWithinDays = if ($priority -eq "high") { 3 } else { 7 }
    }
  }

  if ($confidence -lt [int]$weightsDoc.taskThresholds.confidenceForNegotiation) {
    $taskIndex += 1
    $taskQueue += [pscustomobject]@{
      taskId = ("task-{0:D4}" -f $taskIndex)
      opportunityId = $oppId
      priority = $priority
      agentRole = "distress_verifier_agent"
      objective = "Corroborate distress posture and ownership/legal status across independent sources."
      requiredInputs = @("recorder_notice_check", "treasurer_delinquency_check", "assessor_owner_check")
      acceptanceCriteria = @(
        "At least 2 independent source systems corroborate current distress status.",
        "Owner and parcel identifiers resolve with confidence."
      )
      dueWithinDays = if ($priority -eq "high") { 2 } else { 5 }
    }
  }

  if ($classification -eq "pursue" -and $confidence -ge [int]$weightsDoc.taskThresholds.confidenceForNegotiation) {
    $taskIndex += 1
    $taskQueue += [pscustomobject]@{
      taskId = ("task-{0:D4}" -f $taskIndex)
      opportunityId = $oppId
      priority = "high"
      agentRole = "negotiation_agent"
      objective = "Draft outreach and negotiation posture for initial contact."
      requiredInputs = @("ask_history", "known_distress_factors", "utility_gap_assessment")
      acceptanceCriteria = @(
        "Outreach sequence drafted with opening terms and fallback bands.",
        "Negotiation posture includes risk-adjusted pricing rationale."
      )
      dueWithinDays = 2
    }
  }

  if ($grantSignalCount -gt 0) {
    $taskIndex += 1
    $taskQueue += [pscustomobject]@{
      taskId = ("task-{0:D4}" -f $taskIndex)
      opportunityId = $oppId
      priority = if ($priority -eq "high") { "high" } else { "medium" }
      agentRole = "grant_funding_agent"
      objective = "Map grant/funding options to potential capex or utility upgrade plan."
      requiredInputs = @("grant_eligibility", "use_case_alignment", "application_timeline")
      acceptanceCriteria = @(
        "Top funding opportunities mapped to this asset with eligibility notes.",
        "Timeline and owner actions required for submission are listed."
      )
      dueWithinDays = 10
    }
  }

  $entityStates += [pscustomobject]@{
    entityKey = $entity.entityKey
    cityHint = [string]$entity.cityHint
    latestClassification = $classification
    latestOpportunityScore = $opportunity
    latestConfidenceScore = $confidence
    requiredNextEvidence = @($missingEvidence.ToArray() | Select-Object -Unique)
  }
}

$rankedOpportunities = @(
  $opportunities |
    Sort-Object @{ Expression = { $_.opportunityScore }; Descending = $true }, @{ Expression = { $_.confidenceScore }; Descending = $true } |
    Select-Object -First $Top
)

$taskQueue = @(
  $taskQueue |
    Sort-Object @{ Expression = { if ($_.priority -eq "high") { 0 } elseif ($_.priority -eq "medium") { 1 } else { 2 } } }, @{ Expression = { $_.dueWithinDays }; Ascending = $true }
)

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$result = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  summary = [pscustomobject]@{
    marketRegime = $marketRegime
    totalOpportunities = $rankedOpportunities.Count
    pursueCount = (@($rankedOpportunities | Where-Object { $_.classification -eq "pursue" })).Count
    investigateNowCount = (@($rankedOpportunities | Where-Object { $_.classification -eq "investigate_now" })).Count
    watchCount = (@($rankedOpportunities | Where-Object { $_.classification -eq "watch" })).Count
    taskCount = $taskQueue.Count
  }
  inputs = [pscustomobject]@{
    agenticResearchPath = $resolvedAgenticPath
    publicSignalsPath = $resolvedPublicPath
    parcelGraphPath = $resolvedParcelPath
    needsContextPath = $resolvedNeedsPath
    macroContextPath = $resolvedMacroPath
    weightsPath = if (Test-Path $WeightsPath) { (Resolve-Path $WeightsPath).Path } else { $WeightsPath }
  }
  needsProfile = $needsProfile
  topOpportunities = $rankedOpportunities
  taskQueue = $taskQueue
  entityStates = $entityStates
  parcelGraphSummary = if ($null -ne $parcelDoc -and $null -ne $parcelDoc.summary) { $parcelDoc.summary } else { $null }
}

$queueDoc = [pscustomobject]@{
  generatedAtUtc = $result.generatedAtUtc
  runId = $runId
  marketRegime = $marketRegime
  tasks = $taskQueue
}

$entityDoc = [pscustomobject]@{
  generatedAtUtc = $result.generatedAtUtc
  runId = $runId
  entities = $entityStates
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$analysisJson = Join-Path $OutputDir "intelligence-analysis-$runId.json"
$analysisMd = Join-Path $OutputDir "intelligence-analysis-$runId.md"
$analysisLatestJson = Join-Path $OutputDir "intelligence-analysis-latest.json"
$analysisLatestMd = Join-Path $OutputDir "intelligence-analysis-latest.md"
$taskJson = Join-Path $OutputDir "intelligence-task-queue-$runId.json"
$taskLatestJson = Join-Path $OutputDir "intelligence-task-queue-latest.json"
$entityJson = Join-Path $OutputDir "intelligence-entity-state-$runId.json"
$entityLatestJson = Join-Path $OutputDir "intelligence-entity-state-latest.json"

$result | ConvertTo-Json -Depth 12 | Set-Content -Path $analysisJson -Encoding UTF8
$result | ConvertTo-Json -Depth 12 | Set-Content -Path $analysisLatestJson -Encoding UTF8
$markdown = Build-Markdown -Result $result
$markdown | Set-Content -Path $analysisMd -Encoding UTF8
$markdown | Set-Content -Path $analysisLatestMd -Encoding UTF8
$queueDoc | ConvertTo-Json -Depth 10 | Set-Content -Path $taskJson -Encoding UTF8
$queueDoc | ConvertTo-Json -Depth 10 | Set-Content -Path $taskLatestJson -Encoding UTF8
$entityDoc | ConvertTo-Json -Depth 10 | Set-Content -Path $entityJson -Encoding UTF8
$entityDoc | ConvertTo-Json -Depth 10 | Set-Content -Path $entityLatestJson -Encoding UTF8

Write-Host "Wrote $analysisJson"
Write-Host "Wrote $analysisMd"
Write-Host "Wrote $analysisLatestJson"
Write-Host "Wrote $analysisLatestMd"
Write-Host "Wrote $taskJson"
Write-Host "Wrote $taskLatestJson"
Write-Host "Wrote $entityJson"
Write-Host "Wrote $entityLatestJson"
