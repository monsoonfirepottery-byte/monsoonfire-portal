param(
  [string]$OutputDir = "output/real-estate",
  [string]$ConfigPath = "docs/real-estate/opportunity-research-config.json",
  [string]$PublicSignalsPath = "output/real-estate/public-signals-latest.json",
  [string]$AgenticResearchPath = "output/real-estate/agentic-research-latest.json",
  [string]$PublicDataManifestPath = "output/real-estate/public-data/latest-manifest.json",
  [string]$MacroContextPath = "output/real-estate/macro-context-latest.json",
  [int]$Top = 40,
  [int]$MinOpportunityScore = 20
)

$ErrorActionPreference = "Stop"

function Resolve-LatestJsonPath {
  param([string]$PreferredPath, [string]$SearchDirectory, [string]$Filter)
  if (-not [string]::IsNullOrWhiteSpace($PreferredPath) -and (Test-Path $PreferredPath)) { return (Resolve-Path $PreferredPath).Path }
  if ([string]::IsNullOrWhiteSpace($SearchDirectory) -or [string]::IsNullOrWhiteSpace($Filter) -or -not (Test-Path $SearchDirectory)) { return $PreferredPath }
  $c = Get-ChildItem -Path $SearchDirectory -Filter $Filter -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($null -eq $c) { return $PreferredPath }
  return $c.FullName
}

function Get-JsonDoc {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) { return $null }
  try { return Get-Content -Raw $Path | ConvertFrom-Json } catch { return $null }
}

function Clamp-Score { param([double]$Value) if ($Value -lt 0) { return 0 }; if ($Value -gt 100) { return 100 }; return [int][math]::Round($Value, 0) }
function Normalize-Key { param([string]$Text) if ([string]::IsNullOrWhiteSpace($Text)) { return "" }; return ([regex]::Replace($Text.ToLowerInvariant(), "[^a-z0-9]+", "-")).Trim("-") }
function Get-UrlHost { param([string]$Url) if ([string]::IsNullOrWhiteSpace($Url)) { return "" }; try { return ([uri]$Url).Host.ToLowerInvariant() } catch { return "" } }
function Get-DateAgeDays { param([string]$Value) if ([string]::IsNullOrWhiteSpace($Value)) { return 9999 }; try { return [math]::Max(0, [int][math]::Floor(((Get-Date).ToUniversalTime() - ([datetime]$Value).ToUniversalTime()).TotalDays)) } catch { return 9999 } }
function Get-FreshnessScore { param([int]$AgeDays) if ($AgeDays -le 14) { return 100 }; if ($AgeDays -le 45) { return 80 }; if ($AgeDays -le 90) { return 65 }; if ($AgeDays -le 180) { return 45 }; return 25 }

$defaults = [pscustomobject]@{
  marketArea = "West Valley and Phoenix, Arizona"
  maxLinksPerSourceFile = 10
  categories = @(
    [pscustomobject]@{ key = "grant_funding"; score = 24; keywords = @("grant", "funding", "incentive", "rebate", "tax credit", "award", "matching funds") },
    [pscustomobject]@{ key = "financial_assistance_rates"; score = 20; keywords = @("loan", "interest rate", "apr", "prime rate", "fixed rate", "variable rate", "financing") },
    [pscustomobject]@{ key = "procurement_buildout"; score = 22; keywords = @("rfp", "request for proposal", "solicitation", "bid", "procurement", "build-out", "facility expansion", "manufacturing") },
    [pscustomobject]@{ key = "community_help_wanted"; score = 14; keywords = @("help wanted", "assistant", "studio help", "pottery help", "ceramic assistant", "contract help") },
    [pscustomobject]@{ key = "workforce_programs"; score = 16; keywords = @("apprenticeship", "workforce", "training grant", "upskilling", "technical assistance") }
  )
  sourceTypeTrust = [pscustomobject]@{
    government_program = 90; government_procurement = 88; government_signal = 78; grant_program = 82; government_data = 75
    public_signal = 74; listing_marketplace = 56; broker_research = 60; finance_data = 66
    community_signal = 32; public_web = 48; fallback = 40
  }
  sourceKeyTrustOverrides = [pscustomobject]@{
    grants_gov_opportunities = 94; sba_grants_and_funding_programs = 93; sba_loan_programs = 93
    hud_grants_and_funding = 92; eda_grants_and_competitions = 92; doe_funding_opportunities = 92
    data_gov_business_assistance_catalog = 90; usaspending_assistance_award_explorer = 90
    sam_gov_contract_opportunities = 92; city_phoenix_procurement_bids = 90; az_state_procurement_portal = 88
    maricopa_county_procurement = 88; reddit_pottery_assistance_signals = 28; craigslist_pottery_assistance_signals = 26
    meta_marketplace_community_signals = 26
  }
  suspicionPatterns = @(
    [pscustomobject]@{ pattern = "ignore previous instructions"; weight = 12 },
    [pscustomobject]@{ pattern = "wire money"; weight = 10 },
    [pscustomobject]@{ pattern = "crypto only"; weight = 8 },
    [pscustomobject]@{ pattern = "deposit required"; weight = 6 }
  )
}

$config = Get-JsonDoc -Path $ConfigPath
if ($null -eq $config) { $config = $defaults }

function Get-SourceTypeFromKey {
  param([string]$Key)
  $k = if ($null -eq $Key) { "" } else { $Key.ToLowerInvariant() }
  if ($k -match "grant|sba|loan|funding|incentive|commerce") { return "government_program" }
  if ($k -match "procure|procurement|sam_gov|rfp|bid|solicitation|contract") { return "government_procurement" }
  if ($k -match "reddit|meta|facebook|craigslist|community") { return "community_signal" }
  if ($k -match "auction|surplus|treasurer|recorder|court|assessor|maricopa|phoenix|federal_real_property") { return "government_signal" }
  return "public_web"
}

function Get-SourceTrustScore {
  param([string]$SourceType, [string]$SourceKey, [string]$UrlHost)
  $score = 45
  if ($null -ne $config.sourceTypeTrust) {
    $p = $config.sourceTypeTrust.PSObject.Properties[$SourceType]
    if ($null -ne $p) { try { $score = [int]$p.Value } catch {} }
  }
  if ($null -ne $config.sourceKeyTrustOverrides) {
    $o = $config.sourceKeyTrustOverrides.PSObject.Properties[$SourceKey]
    if ($null -ne $o) { try { $score = [int]$o.Value } catch {} }
  }
  if (-not [string]::IsNullOrWhiteSpace($UrlHost)) {
    if ($UrlHost -match "\.gov$|^grants\.gov$|^sam\.gov$|^sba\.gov$") { $score = [math]::Max($score, 88) }
    if ($UrlHost -match "reddit\.com|facebook\.com|craigslist\.org") { $score = [math]::Min($score, 35) }
  }
  return Clamp-Score $score
}

function Get-CategoryAssessment {
  param([string]$Text)
  $lower = if ($null -eq $Text) { "" } else { $Text.ToLowerInvariant() }
  $cats = @(); $words = @(); $score = 0
  foreach ($cat in @($config.categories)) {
    $hits = 0
    foreach ($kw in @($cat.keywords)) {
      $needle = [string]$kw
      if ([string]::IsNullOrWhiteSpace($needle)) { continue }
      if ($lower -match [regex]::Escape($needle.ToLowerInvariant())) { $hits += 1; $words += $needle }
    }
    if ($hits -gt 0) {
      $cats += [string]$cat.key
      $base = 8; try { $base = [int]$cat.score } catch {}
      $score += $base + [math]::Min(10, ($hits * 2))
    }
  }
  return [pscustomobject]@{ score = [int]$score; categories = @($cats | Select-Object -Unique); keywords = @($words | Select-Object -Unique) }
}

function Get-SuspicionAssessment {
  param([string]$Text, [int]$PromptScore, [bool]$IsCommunity, [bool]$HasUrl, [int]$SourceTrust)
  $lower = if ($null -eq $Text) { "" } else { $Text.ToLowerInvariant() }
  $score = [math]::Max(0, ($PromptScore * 4)); $reasons = @()
  if ($IsCommunity) { $score += 18; $reasons += "community_source_low_trust" }
  if (-not $HasUrl) { $score += 10; $reasons += "missing_primary_url" }
  if ($SourceTrust -lt 40) { $score += 14; $reasons += "low_source_trust" }
  foreach ($rule in @($config.suspicionPatterns)) {
    $pat = [string]$rule.pattern
    if (-not [string]::IsNullOrWhiteSpace($pat) -and $lower -match [regex]::Escape($pat.ToLowerInvariant())) {
      $w = 4; try { $w = [int]$rule.weight } catch {}
      $score += $w; $reasons += ("pattern:{0}" -f $pat)
    }
  }
  return [pscustomobject]@{ score = Clamp-Score $score; reasons = @($reasons | Select-Object -Unique) }
}

function Get-VerificationStatus { param([int]$ConfidenceScore, [int]$SkepticismScore, [int]$CorroborationCount, [int]$SourceTrustScore) if ($SkepticismScore -ge 75) { return "suspect" }; if ($ConfidenceScore -ge 75 -and $CorroborationCount -ge 2 -and $SourceTrustScore -ge 70) { return "cross_verified" }; if ($ConfidenceScore -ge 60 -and $SourceTrustScore -ge 60) { return "source_verified" }; return "unverified" }
function Get-RecommendedAction { param([string[]]$Categories, [int]$SkepticismScore) if ($SkepticismScore -ge 75) { return "manual_verify_before_action" }; if ($Categories -contains "procurement_buildout") { return "check_eligibility_scope_and_deadline" }; if ($Categories -contains "grant_funding") { return "validate_grant_fit_and_prepare_submission" }; if ($Categories -contains "financial_assistance_rates") { return "track_rate_terms_and_compare_program_cost" }; if ($Categories -contains "community_help_wanted") { return "verify_poster_identity_and_scope_before_outreach" }; return "triage_and_corroborate" }
function Get-TaskRole { param([string[]]$Categories) if ($Categories -contains "procurement_buildout") { return "procurement_agent" }; if ($Categories -contains "grant_funding" -or $Categories -contains "financial_assistance_rates") { return "grant_funding_agent" }; if ($Categories -contains "community_help_wanted") { return "community_verification_agent" }; return "opportunity_verifier_agent" }

$resolvedPublicSignalsPath = Resolve-LatestJsonPath -PreferredPath $PublicSignalsPath -SearchDirectory $OutputDir -Filter "public-signals-*.json"
$resolvedAgenticPath = Resolve-LatestJsonPath -PreferredPath $AgenticResearchPath -SearchDirectory $OutputDir -Filter "agentic-research-*.json"
$publicSignalsDoc = Get-JsonDoc -Path $resolvedPublicSignalsPath
$agenticDoc = Get-JsonDoc -Path $resolvedAgenticPath
$manifestDoc = Get-JsonDoc -Path $PublicDataManifestPath
$macroDoc = Get-JsonDoc -Path $MacroContextPath

$candidates = @()

foreach ($signal in @($publicSignalsDoc.signals)) {
  $text = @([string]$signal.notes, [string]$signal.signalType, [string]$signal.distressStage, [string]$signal.sourceName, [string]$signal.ownerName) -join " "
  $cat = Get-CategoryAssessment -Text $text
  if ([string]$signal.signalType -eq "grant_opportunity" -and -not ($cat.categories -contains "grant_funding")) { $cat.categories += @("grant_funding"); $cat.score += 18 }
  if ([int]$cat.score -le 0) { continue }
  $url = [string]$signal.recordUrl; $urlHost = Get-UrlHost -Url $url; $sourceKey = [string]$signal.sourceKey
  $sourceType = if (-not [string]::IsNullOrWhiteSpace([string]$signal.sourceType)) { [string]$signal.sourceType } else { (Get-SourceTypeFromKey -Key $sourceKey) }
  $trust = Get-SourceTrustScore -SourceType $sourceType -SourceKey $sourceKey -UrlHost $urlHost
  $prompt = 0; try { $prompt = [int]$signal.promptInjectionScore } catch {}
  $sus = Get-SuspicionAssessment -Text $text -PromptScore $prompt -IsCommunity:($sourceType -eq "community_signal" -or [string]$signal.signalType -eq "community_signal") -HasUrl:(-not [string]::IsNullOrWhiteSpace($url)) -SourceTrust $trust
  $fresh = Get-FreshnessScore -AgeDays (Get-DateAgeDays -Value ([string]$signal.eventDate))
  $base = 0; try { $base = [int]$signal.signalScore } catch {}
  $corrSeed = 0; if (-not [string]::IsNullOrWhiteSpace([string]$signal.caseNumber)) { $corrSeed += 1 }; if (-not [string]::IsNullOrWhiteSpace([string]$signal.parcelId)) { $corrSeed += 1 }
  $signalUrgencyBoost = 8
  if (([string]$signal.distressStage).ToLowerInvariant() -match "auction|open|deadline|notice") { $signalUrgencyBoost = 26 }
  $candidates += [pscustomobject]@{
    dedupKey = if (-not [string]::IsNullOrWhiteSpace($url)) { Normalize-Key $url } else { Normalize-Key (([string]$signal.notes) + "|" + [string]$signal.sourceKey + "|" + [string]$signal.caseNumber) }
    title = if (-not [string]::IsNullOrWhiteSpace([string]$signal.notes)) { [string]$signal.notes } else { "{0} {1}" -f [string]$signal.signalType, [string]$signal.city }
    summary = [string]$signal.notes; url = $url; publishedAt = [string]$signal.eventDate
    sourceSystem = "public_signals"; sourceKey = $sourceKey; sourceName = [string]$signal.sourceName; sourceType = $sourceType
    sourceTrustScore = $trust
    opportunityScore = Clamp-Score (($base * 0.5) + ([int]$cat.score * 0.55) + ($trust * 0.22) + ($fresh * 0.1) - ([int]$sus.score * 0.28))
    confidenceScore = Clamp-Score (($trust * 0.56) + ($fresh * 0.24) + ($corrSeed * 14) - ([int]$sus.score * 0.26))
    skepticismScore = [int]$sus.score; skepticismReasons = @($sus.reasons); urgencyScore = Clamp-Score (($fresh * 0.5) + $signalUrgencyBoost)
    categories = @($cat.categories); matchedKeywords = @($cat.keywords)
  }
}

foreach ($lead in @($agenticDoc.topLeads)) {
  $text = @([string]$lead.title, [string]$lead.summary, [string]$lead.sourceQuery) -join " "
  $cat = Get-CategoryAssessment -Text $text
  if ([int]$cat.score -le 0) { continue }
  $url = [string]$lead.url; $urlHost = Get-UrlHost -Url $url; $sourceKey = [string]$lead.sourceKey
  $sourceType = if (-not [string]::IsNullOrWhiteSpace([string]$lead.sourceType)) { [string]$lead.sourceType } else { (Get-SourceTypeFromKey -Key $sourceKey) }
  $trust = Get-SourceTrustScore -SourceType $sourceType -SourceKey $sourceKey -UrlHost $urlHost
  $sus = Get-SuspicionAssessment -Text $text -PromptScore 0 -IsCommunity:($sourceType -eq "community_signal") -HasUrl:(-not [string]::IsNullOrWhiteSpace($url)) -SourceTrust $trust
  $fresh = Get-FreshnessScore -AgeDays (Get-DateAgeDays -Value ([string]$lead.publishedAt))
  $base = 0; try { $base = [int]$lead.leadScore } catch {}
  $candidates += [pscustomobject]@{
    dedupKey = if (-not [string]::IsNullOrWhiteSpace($url)) { Normalize-Key $url } else { Normalize-Key (([string]$lead.title) + "|" + [string]$lead.sourceQuery) }
    title = [string]$lead.title; summary = [string]$lead.summary; url = $url; publishedAt = [string]$lead.publishedAt
    sourceSystem = "agentic_research"; sourceKey = $sourceKey; sourceName = [string]$lead.sourceName; sourceType = $sourceType
    sourceTrustScore = $trust
    opportunityScore = Clamp-Score (($base * 0.52) + ([int]$cat.score * 0.5) + ($trust * 0.2) + ($fresh * 0.1) - ([int]$sus.score * 0.22))
    confidenceScore = Clamp-Score (($trust * 0.5) + ($fresh * 0.2) + ([math]::Min(25, [int]$base * 0.3)) - ([int]$sus.score * 0.22))
    skepticismScore = [int]$sus.score; skepticismReasons = @($sus.reasons); urgencyScore = Clamp-Score (($fresh * 0.45) + ([math]::Min(40, [int]$base * 0.25)))
    categories = @($cat.categories); matchedKeywords = @($cat.keywords)
  }
}

$maxLinks = 10; try { $maxLinks = [int]$config.maxLinksPerSourceFile } catch {}
foreach ($entry in @($manifestDoc.results)) {
  if ([string]$entry.status -ne "ok" -or [string]$entry.mode -ne "text") { continue }
  $filePath = [string]$entry.outputFile
  if ([string]::IsNullOrWhiteSpace($filePath) -or -not (Test-Path $filePath)) { continue }
  $raw = ""; try { $raw = Get-Content -Raw $filePath } catch { $raw = "" }; if ([string]::IsNullOrWhiteSpace($raw)) { continue }
  $sourceKey = [string]$entry.key; $sourceName = [string]$entry.name; $sourceUrl = [string]$entry.url
  $sourceType = Get-SourceTypeFromKey -Key $sourceKey
  $trust = Get-SourceTrustScore -SourceType $sourceType -SourceKey $sourceKey -UrlHost (Get-UrlHost -Url $sourceUrl)
  $links = [regex]::Matches($raw, "<a[^>]+href\s*=\s*['""](?<u>[^'"">]+)['""][^>]*>(?<t>.*?)</a>", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  $i = 0
  foreach ($m in $links) {
    $i += 1; if ($i -gt $maxLinks) { break }
    $url = [string]$m.Groups["u"].Value; if ([string]::IsNullOrWhiteSpace($url)) { continue }
    if ($url.StartsWith("/")) { try { $url = ([uri]::new([uri]$sourceUrl, $url)).AbsoluteUri } catch {} }
    $title = [regex]::Replace(([string]$m.Groups["t"].Value), "<[^>]+>", " "); $title = [regex]::Replace($title, "\s+", " ").Trim(); if ([string]::IsNullOrWhiteSpace($title)) { $title = $sourceName }
    $text = @($title, $url, $sourceName, $sourceKey) -join " "
    $cat = Get-CategoryAssessment -Text $text; if ([int]$cat.score -le 0) { continue }
    $sus = Get-SuspicionAssessment -Text $text -PromptScore 0 -IsCommunity:($sourceType -eq "community_signal") -HasUrl:$true -SourceTrust $trust
    $manifestUrgencyBase = 42
    if ($text.ToLowerInvariant() -match "deadline|close|closing|due|open now|apply now|bid due") { $manifestUrgencyBase = 72 }
    $candidates += [pscustomobject]@{
      dedupKey = Normalize-Key $url; title = $title; summary = "Derived from fetched opportunity page links."; url = $url; publishedAt = [string]$manifestDoc.generatedAtUtc
      sourceSystem = "public_data_manifest"; sourceKey = $sourceKey; sourceName = $sourceName; sourceType = $sourceType; sourceTrustScore = $trust
      opportunityScore = Clamp-Score (([int]$cat.score * 0.82) + ($trust * 0.44) - ([int]$sus.score * 0.26) + 12)
      confidenceScore = Clamp-Score (($trust * 0.72) - ([int]$sus.score * 0.3) + 10)
      skepticismScore = [int]$sus.score; skepticismReasons = @($sus.reasons); urgencyScore = Clamp-Score $manifestUrgencyBase
      categories = @($cat.categories); matchedKeywords = @($cat.keywords)
    }
  }
}

$agg = @{}
foreach ($c in @($candidates | Where-Object { [int]$_.opportunityScore -ge $MinOpportunityScore })) {
  $k = [string]$c.dedupKey; if ([string]::IsNullOrWhiteSpace($k)) { $k = Normalize-Key (([string]$c.title) + "|" + ([string]$c.sourceKey)) }
  if (-not $agg.ContainsKey($k)) { $agg[$k] = [pscustomobject]@{ sample = $c; categories = @(); keywords = @(); reasons = @(); systems = @(); sourceKeys = @(); sourceNames = @(); bestScore = [int]$c.opportunityScore; bestConfidence = [int]$c.confidenceScore; worstSkepticism = [int]$c.skepticismScore; bestUrgency = [int]$c.urgencyScore; bestTrust = [int]$c.sourceTrustScore } }
  $a = $agg[$k]
  if ([int]$c.opportunityScore -gt [int]$a.bestScore) { $a.bestScore = [int]$c.opportunityScore; $a.sample = $c }
  $a.bestConfidence = [math]::Max([int]$a.bestConfidence, [int]$c.confidenceScore)
  $a.worstSkepticism = [math]::Max([int]$a.worstSkepticism, [int]$c.skepticismScore)
  $a.bestUrgency = [math]::Max([int]$a.bestUrgency, [int]$c.urgencyScore)
  $a.bestTrust = [math]::Max([int]$a.bestTrust, [int]$c.sourceTrustScore)
  $a.categories += @($c.categories); $a.keywords += @($c.matchedKeywords); $a.reasons += @($c.skepticismReasons)
  $a.systems += @([string]$c.sourceSystem); $a.sourceKeys += @([string]$c.sourceKey); $a.sourceNames += @([string]$c.sourceName)
}

$opportunities = @(); $tasks = @(); $taskId = 0
foreach ($kv in $agg.GetEnumerator()) {
  $a = $kv.Value
  $cats = @($a.categories | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique | Sort-Object)
  if ($cats.Count -eq 0) { continue }
  $systems = @($a.systems | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique | Sort-Object)
  $sourceKeys = @($a.sourceKeys | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique | Sort-Object)
  $sourceNames = @($a.sourceNames | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique | Sort-Object)
  $corroboration = [math]::Max(1, $systems.Count)
  $skepticPenalty = 0
  if ([int]$a.worstSkepticism -ge 75) { $skepticPenalty = 10 }
  $oppScore = Clamp-Score (([int]$a.bestScore) + (($corroboration - 1) * 7) - $skepticPenalty)
  if ($oppScore -lt $MinOpportunityScore) { continue }
  $conf = Clamp-Score (([int]$a.bestConfidence) + (($corroboration - 1) * 8) - ([int]$a.worstSkepticism * 0.16))
  $titleUrgencyBoost = 0
  if ([string]$a.sample.title -match "deadline|closing|bid due|open now|apply now") { $titleUrgencyBoost = 14 }
  $urgency = Clamp-Score (([int]$a.bestUrgency) + $titleUrgencyBoost)
  $verification = Get-VerificationStatus -ConfidenceScore $conf -SkepticismScore ([int]$a.worstSkepticism) -CorroborationCount $corroboration -SourceTrustScore ([int]$a.bestTrust)
  $oppId = "oppr-" + (Normalize-Key ($kv.Key + "-" + (Get-Date -Format "yyyyMMdd"))); if ($oppId.Length -gt 64) { $oppId = $oppId.Substring(0, 64) }
  $cautionDetail = "Verify source freshness and eligibility before execution."
  if ([int]$a.worstSkepticism -ge 75) { $cautionDetail = "High skepticism score; manual verification required before action." }
  $opportunities += [pscustomobject]@{
    opportunityId = $oppId; title = [string]$a.sample.title; summary = [string]$a.sample.summary; url = [string]$a.sample.url; publishedAt = [string]$a.sample.publishedAt
    primaryCategory = [string]$cats[0]; categories = $cats; matchedKeywords = @($a.keywords | Select-Object -Unique | Sort-Object)
    opportunityScore = $oppScore; confidenceScore = $conf; skepticismScore = [int]$a.worstSkepticism; urgencyScore = $urgency
    verificationStatus = $verification; skepticismReasons = @($a.reasons | Select-Object -Unique | Sort-Object)
    corroboration = [pscustomobject]@{ sourceCount = $sourceKeys.Count; systemCount = $systems.Count; sourceKeys = $sourceKeys; sourceSystems = $systems }
    sources = $sourceNames
    cautionNotes = @("Treat as suspect until corroborated with primary source documents.", $cautionDetail)
    recommendedNextStep = Get-RecommendedAction -Categories $cats -SkepticismScore ([int]$a.worstSkepticism)
  }
  $taskId += 1
  $priority = if ($oppScore -ge 72 -and [int]$a.worstSkepticism -lt 68) { "high" } elseif ($oppScore -ge 55) { "medium" } else { "low" }
  $tasks += [pscustomobject]@{ taskId = ("opp-task-{0:D4}" -f $taskId); opportunityId = $oppId; priority = $priority; agentRole = Get-TaskRole -Categories $cats; objective = if ([int]$a.worstSkepticism -ge 68) { "Manual verification pass before outreach or commitments." } else { "Collect eligibility, timeline, and execution constraints with source citations." }; dueWithinDays = if ($priority -eq "high") { 2 } elseif ($priority -eq "medium") { 5 } else { 10 } }
}

$ranked = @($opportunities | Sort-Object @{ Expression = { $_.opportunityScore }; Descending = $true }, @{ Expression = { $_.confidenceScore }; Descending = $true }, @{ Expression = { $_.skepticismScore }; Ascending = $true } | Select-Object -First $Top)
$categoryCounts = @{}; foreach ($o in $ranked) { foreach ($c in @($o.categories)) { if (-not $categoryCounts.ContainsKey([string]$c)) { $categoryCounts[[string]$c] = 0 }; $categoryCounts[[string]$c] += 1 } }
$sourceCoverageMap = @{}; foreach ($o in $ranked) { foreach ($k in @($o.corroboration.sourceKeys)) { if (-not $sourceCoverageMap.ContainsKey([string]$k)) { $sourceCoverageMap[[string]$k] = 0 }; $sourceCoverageMap[[string]$k] += 1 } }
$sourceCoverage = @(); foreach ($k in ($sourceCoverageMap.Keys | Sort-Object)) { $sourceCoverage += [pscustomobject]@{ sourceKey = [string]$k; opportunities = [int]$sourceCoverageMap[$k] } }

$rateContext = $null
if ($null -ne $macroDoc) {
  $fed = $null; $cre = $null; try { $fed = [double]$macroDoc.fedFunds.latest } catch {}; try { $cre = [double]$macroDoc.crePriceIndex.yoyPct } catch {}
  $rateContext = [pscustomobject]@{ fedFundsRate = $fed; crePriceIndexYoYPct = $cre; sentiment = if ($null -ne $fed -and $fed -ge 5.0) { "tight_credit_bias" } elseif ($null -ne $fed -and $fed -ge 3.0) { "neutral_credit_bias" } else { "easing_credit_bias" }; note = "Context only; verify current lender and program rates before decisions." }
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$result = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o"); runId = $runId; marketArea = [string]$config.marketArea
  summary = [pscustomobject]@{ totalCandidates = $candidates.Count; totalOpportunities = $ranked.Count; highPriority = (@($ranked | Where-Object { $_.opportunityScore -ge 72 -and $_.skepticismScore -lt 68 })).Count; mediumPriority = (@($ranked | Where-Object { $_.opportunityScore -ge 55 -and $_.opportunityScore -lt 72 })).Count; highSkepticism = (@($ranked | Where-Object { $_.skepticismScore -ge 68 })).Count; categoryCounts = $categoryCounts }
  inputs = [pscustomobject]@{ configPath = if (Test-Path $ConfigPath) { (Resolve-Path $ConfigPath).Path } else { $ConfigPath }; publicSignalsPath = $resolvedPublicSignalsPath; agenticResearchPath = $resolvedAgenticPath; publicDataManifestPath = if (Test-Path $PublicDataManifestPath) { (Resolve-Path $PublicDataManifestPath).Path } else { $PublicDataManifestPath }; macroContextPath = if (Test-Path $MacroContextPath) { (Resolve-Path $MacroContextPath).Path } else { $MacroContextPath } }
  dataPolicy = [pscustomobject]@{ defaultTrustLevel = "suspect_until_verified"; verificationRule = "Never commit funds or outreach without primary-source validation."; highRiskTrigger = "skepticismScore >= 75" }
  rateContext = $rateContext; sourceCoverage = $sourceCoverage; topOpportunities = $ranked
  followUpQueue = @($tasks | Sort-Object @{ Expression = { if ($_.priority -eq "high") { 0 } elseif ($_.priority -eq "medium") { 1 } else { 2 } } }, @{ Expression = { $_.dueWithinDays }; Ascending = $true } | Select-Object -First 60)
}

function Build-Markdown {
  param([pscustomobject]$Doc)
  $lines = @("# Opportunity Research Run", "", "- generatedAtUtc: $($Doc.generatedAtUtc)", "- opportunities: $($Doc.summary.totalOpportunities)", "- highPriority: $($Doc.summary.highPriority)", "- highSkepticism: $($Doc.summary.highSkepticism)", "- dataPolicy: Treat all opportunities as suspect until corroborated.", "", "## Top Opportunities", "", "| Score | Confidence | Skepticism | Category | Verification | Sources | Title |", "| ---: | ---: | ---: | --- | --- | ---: | --- |")
  foreach ($opp in $Doc.topOpportunities) { $lines += "| $($opp.opportunityScore) | $($opp.confidenceScore) | $($opp.skepticismScore) | $($opp.primaryCategory) | $($opp.verificationStatus) | $($opp.corroboration.sourceCount) | $($opp.title) |" }
  $lines += ""; $lines += "## Follow-up Queue"; $lines += ""
  if (@($Doc.followUpQueue).Count -eq 0) { $lines += "- none" } else { foreach ($t in $Doc.followUpQueue) { $lines += "- [$($t.priority)] $($t.agentRole): $($t.objective) (opportunity=$($t.opportunityId))" } }
  return ($lines -join "`n") + "`n"
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$jsonPath = Join-Path $OutputDir "opportunity-research-$runId.json"
$mdPath = Join-Path $OutputDir "opportunity-research-$runId.md"
$latestJsonPath = Join-Path $OutputDir "opportunity-research-latest.json"
$latestMdPath = Join-Path $OutputDir "opportunity-research-latest.md"
$queuePath = Join-Path $OutputDir "opportunity-research-task-queue-$runId.json"
$queueLatestPath = Join-Path $OutputDir "opportunity-research-task-queue-latest.json"
$result | ConvertTo-Json -Depth 14 | Set-Content -Path $jsonPath -Encoding UTF8
$result | ConvertTo-Json -Depth 14 | Set-Content -Path $latestJsonPath -Encoding UTF8
$md = Build-Markdown -Doc $result
$md | Set-Content -Path $mdPath -Encoding UTF8
$md | Set-Content -Path $latestMdPath -Encoding UTF8
([pscustomobject]@{ generatedAtUtc = $result.generatedAtUtc; runId = $runId; tasks = $result.followUpQueue }) | ConvertTo-Json -Depth 10 | Set-Content -Path $queuePath -Encoding UTF8
([pscustomobject]@{ generatedAtUtc = $result.generatedAtUtc; runId = $runId; tasks = $result.followUpQueue }) | ConvertTo-Json -Depth 10 | Set-Content -Path $queueLatestPath -Encoding UTF8

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $mdPath"
Write-Host "Wrote $latestJsonPath"
Write-Host "Wrote $latestMdPath"
Write-Host "Wrote $queuePath"
Write-Host "Wrote $queueLatestPath"
