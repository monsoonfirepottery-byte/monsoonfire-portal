<#
.SYNOPSIS
Builds a human-facing review packet from intelligence outputs.

.DESCRIPTION
Creates channel-agnostic opportunity cards for Portal/Discord/CLI review with:
- rank, class, score, confidence, urgency
- fit-now / fit-future summaries
- missing evidence and risk notes
- change deltas vs prior packet
- recommended human and agent actions

Also emits fixed steering action definitions so downstream agents can process
human decisions consistently.

.OUTPUTS
output/real-estate/intelligence-review-packet-<timestamp>.json
output/real-estate/intelligence-review-packet-<timestamp>.md
output/real-estate/intelligence-review-packet-latest.json
output/real-estate/intelligence-review-packet-latest.md
#>
param(
  [string]$OutputDir = "output/real-estate",
  [string]$IntelligencePath = "output/real-estate/intelligence-analysis-latest.json",
  [string]$NeedsContextPath = "output/real-estate/needs-context-latest.json",
  [int]$Top = 10,
  [int]$ConfidenceForOutreach = 65
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
  if ([string]::IsNullOrWhiteSpace($SearchDirectory) -or [string]::IsNullOrWhiteSpace($Filter) -or -not (Test-Path $SearchDirectory)) {
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

function Build-Markdown {
  param([pscustomobject]$Result)

  $lines = @()
  $lines += "# Intelligence Review Packet"
  $lines += ""
  $lines += "- generatedAtUtc: $($Result.generatedAtUtc)"
  $lines += "- intelligenceRunId: $($Result.intelligenceRunId)"
  $lines += "- opportunities: $($Result.summary.opportunityCount)"
  $lines += "- alerts: $($Result.summary.alertCount)"
  $lines += ""
  $lines += "## Top Opportunities"
  $lines += ""
  $lines += "| Rank | Opportunity | Class | Score | Confidence | Urgency | Recommended Human Action |"
  $lines += "| ---: | --- | --- | ---: | ---: | ---: | --- |"
  foreach ($card in $Result.opportunities) {
    $lines += "| $($card.rank) | $($card.opportunityId) | $($card.classification) | $($card.opportunityScore) | $($card.confidenceScore) | $($card.urgencyScore) | $($card.recommendedHumanAction) |"
  }
  $lines += ""
  $lines += "## Alerts"
  $lines += ""
  if (@($Result.alerts).Count -eq 0) {
    $lines += "- none"
  } else {
    foreach ($alert in $Result.alerts) {
      $lines += "- [$($alert.severity)] $($alert.opportunityId): $($alert.message)"
    }
  }
  return ($lines -join "`n") + "`n"
}

$resolvedIntelligencePath = Resolve-LatestJsonPath -PreferredPath $IntelligencePath -SearchDirectory $OutputDir -Filter "intelligence-analysis-*.json"
$resolvedNeedsPath = Resolve-LatestJsonPath -PreferredPath $NeedsContextPath -SearchDirectory $OutputDir -Filter "needs-context-*.json"

$intelligence = Get-JsonDoc -Path $resolvedIntelligencePath
if ($null -eq $intelligence) {
  throw "Intelligence analysis input not found or invalid JSON: $resolvedIntelligencePath"
}
$needs = Get-JsonDoc -Path $resolvedNeedsPath

$priorLatestPath = Join-Path $OutputDir "intelligence-review-packet-latest.json"
$prior = Get-JsonDoc -Path $priorLatestPath
$priorMap = @{}
if ($null -ne $prior -and $null -ne $prior.opportunities) {
  foreach ($old in @($prior.opportunities)) {
    $priorMap[[string]$old.opportunityId] = $old
  }
}

$cards = @()
$alerts = @()
$rank = 0

$topOpportunities = @()
if ($null -ne $intelligence.topOpportunities) {
  $topOpportunities = @($intelligence.topOpportunities | Select-Object -First $Top)
}

foreach ($opp in $topOpportunities) {
  $rank += 1
  $oppId = [string]$opp.opportunityId
  $prev = $null
  if ($priorMap.ContainsKey($oppId)) {
    $prev = $priorMap[$oppId]
  }

  $scoreDelta = 0
  $confidenceDelta = 0
  $urgencyDelta = 0
  $changed = New-Object System.Collections.Generic.List[string]
  if ($null -ne $prev) {
    $scoreDelta = [int]$opp.opportunityScore - [int]$prev.opportunityScore
    $confidenceDelta = [int]$opp.confidenceScore - [int]$prev.confidenceScore
    $urgencyDelta = [int]$opp.urgencyScore - [int]$prev.urgencyScore
    if ([string]$opp.classification -ne [string]$prev.classification) {
      [void]$changed.Add(("classification: {0} -> {1}" -f [string]$prev.classification, [string]$opp.classification))
    }
    if ($scoreDelta -ne 0) { [void]$changed.Add(("score delta: {0}" -f $scoreDelta)) }
    if ($confidenceDelta -ne 0) { [void]$changed.Add(("confidence delta: {0}" -f $confidenceDelta)) }
    if ($urgencyDelta -ne 0) { [void]$changed.Add(("urgency delta: {0}" -f $urgencyDelta)) }
  } else {
    [void]$changed.Add("new opportunity in review packet")
  }

  $missingEvidence = @($opp.requiredNextEvidence | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $hardFails = @($missingEvidence | Where-Object { $_ -match "insufficient|below|upgrade_needed" })

  $recommendedHumanAction = "request_more_evidence"
  if ([string]$opp.classification -eq "pursue" -and [int]$opp.confidenceScore -ge $ConfidenceForOutreach) {
    $recommendedHumanAction = "approve_next_step"
  } elseif ([string]$opp.classification -eq "watch") {
    $recommendedHumanAction = "hold"
  }

  $recommendedAgentTask = $null
  if ($null -ne $intelligence.taskQueue) {
    $recommendedAgentTask = @($intelligence.taskQueue | Where-Object { [string]$_.opportunityId -eq $oppId } | Select-Object -First 1)
    if ($recommendedAgentTask.Count -gt 0) {
      $recommendedAgentTask = $recommendedAgentTask[0]
    } else {
      $recommendedAgentTask = $null
    }
  }

  $fitNow = 0
  try { $fitNow = [int]$opp.strategicFitScore } catch { $fitNow = 0 }
  $fitFuture = [math]::Max(0, $fitNow - ($missingEvidence.Count * 5))

  $card = [pscustomobject]@{
    rank = $rank
    opportunityId = $oppId
    entityKey = [string]$opp.entityKey
    cityHint = [string]$opp.cityHint
    classification = [string]$opp.classification
    opportunityScore = [int]$opp.opportunityScore
    confidenceScore = [int]$opp.confidenceScore
    urgencyScore = [int]$opp.urgencyScore
    fitNowScore = $fitNow
    fitFutureScore = $fitFuture
    hardFails = $hardFails
    missingEvidence = $missingEvidence
    whyNow = @($opp.whyNow)
    riskNotes = @($opp.riskNotes)
    whatChangedSinceLastRun = @($changed.ToArray())
    recommendedHumanAction = $recommendedHumanAction
    recommendedAgentAction = if ($null -ne $recommendedAgentTask) {
      [pscustomobject]@{
        agentRole = [string]$recommendedAgentTask.agentRole
        objective = [string]$recommendedAgentTask.objective
        dueWithinDays = $recommendedAgentTask.dueWithinDays
        priority = [string]$recommendedAgentTask.priority
      }
    } else {
      $null
    }
  }
  $cards += $card

  if ([string]$opp.classification -eq "pursue" -and [int]$opp.confidenceScore -ge $ConfidenceForOutreach) {
    $alerts += [pscustomobject]@{
      severity = "high"
      opportunityId = $oppId
      message = "Pursue-ready candidate exceeds confidence threshold."
    }
  } elseif ([int]$opp.urgencyScore -ge 85 -and $missingEvidence.Count -gt 0) {
    $alerts += [pscustomobject]@{
      severity = "medium"
      opportunityId = $oppId
      message = "Urgent signal window with unresolved evidence gaps."
    }
  }
}

$humanActions = @(
  [pscustomobject]@{ action = "approve_next_step"; description = "Proceed with the recommended next agent action." },
  [pscustomobject]@{ action = "hold"; description = "Keep monitoring without additional execution right now." },
  [pscustomobject]@{ action = "reject"; description = "Discard this opportunity from active focus." },
  [pscustomobject]@{ action = "request_more_evidence"; description = "Require additional verification before moving forward." },
  [pscustomobject]@{ action = "change_constraints"; description = "Update needs constraints and rescore." },
  [pscustomobject]@{ action = "change_risk_mode"; description = "Adjust screening posture: conservative, balanced, aggressive." }
)

$recommendedNeeds = $null
if ($null -ne $needs -and $null -ne $needs.recommendedProfile) {
  $recommendedNeeds = $needs.recommendedProfile
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$result = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  intelligenceRunId = [string]$intelligence.runId
  summary = [pscustomobject]@{
    opportunityCount = $cards.Count
    alertCount = $alerts.Count
    marketRegime = [string]$intelligence.summary.marketRegime
  }
  inputs = [pscustomobject]@{
    intelligencePath = $resolvedIntelligencePath
    needsContextPath = $resolvedNeedsPath
  }
  opportunities = $cards
  alerts = $alerts
  humanActions = $humanActions
  steeringControls = [pscustomobject]@{
    riskModes = @("conservative", "balanced", "aggressive")
    recommendedRiskMode = "balanced"
    activeNeedsProfileId = if ($null -ne $recommendedNeeds) { [string]$recommendedNeeds.id } else { "" }
    keyConstraints = if ($null -ne $recommendedNeeds) { $recommendedNeeds.hardRequirements } else { $null }
  }
  steeringContract = [pscustomobject]@{
    requiredFields = @("opportunityId", "action", "reasonCode", "timestampUtc")
    optionalFields = @("constraintsPatch", "riskMode", "notes")
    sinkPath = (Join-Path $OutputDir "intelligence-steering-log.jsonl")
  }
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$jsonPath = Join-Path $OutputDir "intelligence-review-packet-$runId.json"
$mdPath = Join-Path $OutputDir "intelligence-review-packet-$runId.md"
$latestJsonPath = Join-Path $OutputDir "intelligence-review-packet-latest.json"
$latestMdPath = Join-Path $OutputDir "intelligence-review-packet-latest.md"

$result | ConvertTo-Json -Depth 14 | Set-Content -Path $jsonPath -Encoding UTF8
$result | ConvertTo-Json -Depth 14 | Set-Content -Path $latestJsonPath -Encoding UTF8
$markdown = Build-Markdown -Result $result
$markdown | Set-Content -Path $mdPath -Encoding UTF8
$markdown | Set-Content -Path $latestMdPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $mdPath"
Write-Host "Wrote $latestJsonPath"
Write-Host "Wrote $latestMdPath"
