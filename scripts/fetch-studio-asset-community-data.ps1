<#
.SYNOPSIS
Fetches targeted community/newsletter feed data for studio asset intelligence.

.DESCRIPTION
Reads `directFeeds` entries from `docs/real-estate/studio-asset-intel-config.json`
and attempts to pull RSS/Atom/JSON feed records into normalized per-source CSVs.
This gives the asset scanner a stable local staging input when search indexing
is weak or channel visibility is inconsistent.

.OUTPUTS
output/real-estate/asset-community-data/<runId>/*.json
output/real-estate/staging/studio-assets/<source-key>.csv
output/real-estate/asset-community-data/latest-manifest.json
#>
param(
  [string]$ConfigPath = "docs/real-estate/studio-asset-intel-config.json",
  [string]$OutDir = "output/real-estate/asset-community-data",
  [string]$StagingDir = "output/real-estate/staging/studio-assets",
  [int]$TimeoutSec = 30
)

$ErrorActionPreference = "Stop"

function Convert-ValueToString {
  param([object]$Value)
  if ($null -eq $Value) { return "" }
  if ($Value -is [string]) { return $Value.Trim() }
  if ($Value -is [System.Xml.XmlNode]) { return ([string]$Value.InnerText).Trim() }
  foreach ($name in @("#text", "InnerText", "href", "Value")) {
    $prop = $Value.PSObject.Properties[$name]
    if ($null -ne $prop -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
      return ([string]$prop.Value).Trim()
    }
  }
  return ([string]$Value).Trim()
}

function Resolve-FeedUrl {
  param([pscustomobject]$Feed)
  if ($null -eq $Feed) { return "" }

  $envKey = [string]$Feed.urlEnv
  if (-not [string]::IsNullOrWhiteSpace($envKey)) {
    $fromEnv = [Environment]::GetEnvironmentVariable($envKey)
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
      return [string]$fromEnv
    }
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$Feed.url)) {
    return [string]$Feed.url
  }
  return ""
}

function Resolve-FeedCredentialValues {
  param([pscustomobject]$Feed)

  $values = New-Object System.Collections.Generic.List[string]
  $envNames = @()

  if ($null -ne $Feed.credentialEnvs) {
    $envNames += @($Feed.credentialEnvs | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$Feed.credentialEnv)) {
    $envNames += @([string]$Feed.credentialEnv)
  }

  foreach ($envName in $envNames) {
    $value = [Environment]::GetEnvironmentVariable($envName)
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      [void]$values.Add([string]$value)
    }
  }

  if (-not [string]::IsNullOrWhiteSpace([string]$Feed.credentialValuesEnv)) {
    $packed = [Environment]::GetEnvironmentVariable([string]$Feed.credentialValuesEnv)
    if (-not [string]::IsNullOrWhiteSpace($packed)) {
      foreach ($part in ($packed -split "[,;]")) {
        $trimmed = [string]$part
        if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
          [void]$values.Add($trimmed.Trim())
        }
      }
    }
  }

  return @($values | Select-Object -Unique)
}

function Build-FeedRequestPlans {
  param(
    [pscustomobject]$Feed,
    [string]$Url
  )

  $baseHeaders = @{
    "User-Agent" = "Mozilla/5.0 (compatible; MonsoonFireAssetFeedCollector/1.0)"
    "Accept" = "*/*"
  }
  $plans = New-Object System.Collections.Generic.List[object]
  $authType = ([string]$Feed.authType).ToLowerInvariant()
  $authRequired = $false
  if ($null -ne $Feed.authRequired) {
    $authRequired = [bool]$Feed.authRequired
  }
  $credentials = @(Resolve-FeedCredentialValues -Feed $Feed)

  if ([string]::IsNullOrWhiteSpace($authType) -or $credentials.Count -eq 0) {
    [void]$plans.Add([pscustomobject]@{
      url = $Url
      headers = $baseHeaders
      authMode = "none"
      authRef = "none"
    })
    return @($plans.ToArray())
  }

  $index = 0
  foreach ($credential in $credentials) {
    $index += 1
    $headers = @{}
    foreach ($k in $baseHeaders.Keys) { $headers[$k] = $baseHeaders[$k] }
    $requestUrl = $Url
    $authRef = "candidate_$index"
    switch ($authType) {
      "bearer" {
        $prefix = if (-not [string]::IsNullOrWhiteSpace([string]$Feed.authPrefix)) { [string]$Feed.authPrefix } else { "Bearer " }
        $headers["Authorization"] = "$prefix$credential"
      }
      "header" {
        $headerName = if (-not [string]::IsNullOrWhiteSpace([string]$Feed.authHeader)) { [string]$Feed.authHeader } else { "x-api-key" }
        $headers[$headerName] = [string]$credential
      }
      "cookie" {
        $headers["Cookie"] = [string]$credential
      }
      "query" {
        $param = if (-not [string]::IsNullOrWhiteSpace([string]$Feed.authQueryParam)) { [string]$Feed.authQueryParam } else { "api_key" }
        $sep = if ($requestUrl -match "\?") { "&" } else { "?" }
        $requestUrl = "$requestUrl$sep$param=$([uri]::EscapeDataString([string]$credential))"
      }
      default {
        $headers["Authorization"] = "Bearer $credential"
      }
    }
    [void]$plans.Add([pscustomobject]@{
      url = $requestUrl
      headers = $headers
      authMode = $authType
      authRef = $authRef
    })
  }

  if (-not $authRequired) {
    [void]$plans.Add([pscustomobject]@{
      url = $Url
      headers = $baseHeaders
      authMode = "none"
      authRef = "fallback_no_auth"
    })
  }

  return @($plans.ToArray())
}

function Parse-JsonRows {
  param([object]$Doc)
  if ($null -eq $Doc) { return @() }
  if ($Doc -is [System.Collections.IEnumerable] -and -not ($Doc -is [string])) {
    return @($Doc)
  }
  if ($null -ne $Doc.items) { return @($Doc.items) }
  if ($null -ne $Doc.data) { return @($Doc.data) }
  if ($null -ne $Doc.records) { return @($Doc.records) }
  return @($Doc)
}

function Parse-XmlRows {
  param([xml]$Doc)
  if ($null -eq $Doc) { return @() }

  $rows = @()
  if ($null -ne $Doc.rss -and $null -ne $Doc.rss.channel -and $null -ne $Doc.rss.channel.item) {
    foreach ($item in @($Doc.rss.channel.item)) {
      $rows += [pscustomobject]@{
        title = Convert-ValueToString $item.title
        url = Convert-ValueToString $item.link
        summary = Convert-ValueToString $item.description
        publishedAt = Convert-ValueToString $item.pubDate
      }
    }
    return $rows
  }

  if ($null -ne $Doc.feed -and $null -ne $Doc.feed.entry) {
    foreach ($entry in @($Doc.feed.entry)) {
      $link = ""
      if ($null -ne $entry.link) {
        if ($entry.link -is [System.Collections.IEnumerable] -and -not ($entry.link -is [string])) {
          foreach ($candidate in @($entry.link)) {
            $href = Convert-ValueToString $candidate.href
            if (-not [string]::IsNullOrWhiteSpace($href)) {
              $link = $href
              break
            }
          }
        } else {
          $link = Convert-ValueToString $entry.link.href
        }
      }
      if ([string]::IsNullOrWhiteSpace($link)) {
        $link = Convert-ValueToString $entry.id
      }
      $rows += [pscustomobject]@{
        title = Convert-ValueToString $entry.title
        url = $link
        summary = Convert-ValueToString $entry.summary
        publishedAt = (Convert-ValueToString $entry.updated)
      }
    }
    return $rows
  }

  return @()
}

function Normalize-FeedRows {
  param(
    [object[]]$Rows,
    [pscustomobject]$Source,
    [string]$FeedName,
    [string]$FeedUrl
  )

  $normalized = @()
  foreach ($row in $Rows) {
    $title = ""
    $url = ""
    $summary = ""
    $publishedAt = ""
    $city = ""
    $notes = ""

    $titleCandidates = @($row.title, $row.name, $row.headline)
    foreach ($candidate in $titleCandidates) {
      $value = Convert-ValueToString $candidate
      if (-not [string]::IsNullOrWhiteSpace($value)) { $title = $value; break }
    }

    $urlCandidates = @($row.url, $row.link, $row.href, $row.permalink)
    foreach ($candidate in $urlCandidates) {
      $value = Convert-ValueToString $candidate
      if (-not [string]::IsNullOrWhiteSpace($value)) { $url = $value; break }
    }

    $summaryCandidates = @($row.summary, $row.description, $row.body, $row.content, $row.text)
    foreach ($candidate in $summaryCandidates) {
      $value = Convert-ValueToString $candidate
      if (-not [string]::IsNullOrWhiteSpace($value)) { $summary = $value; break }
    }

    $publishedCandidates = @($row.publishedAt, $row.pubDate, $row.date, $row.updated, $row.created_at, $row.timestamp)
    foreach ($candidate in $publishedCandidates) {
      $value = Convert-ValueToString $candidate
      if (-not [string]::IsNullOrWhiteSpace($value)) { $publishedAt = $value; break }
    }

    $cityCandidates = @($row.city, $row.location, $row.region)
    foreach ($candidate in $cityCandidates) {
      $value = Convert-ValueToString $candidate
      if (-not [string]::IsNullOrWhiteSpace($value)) { $city = $value; break }
    }

    $notes = "feed:$FeedName"
    if (-not [string]::IsNullOrWhiteSpace($FeedUrl)) {
      $notes = "$notes; url:$FeedUrl"
    }

    if ([string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($url)) { continue }

    $normalized += [pscustomobject]@{
      title = $title
      url = $url
      summary = $summary
      publishedAt = $publishedAt
      city = $city
      sourceQuery = "direct_feed:$FeedName"
      notes = $notes
      sourceKey = [string]$Source.key
      sourceName = [string]$Source.name
      sourceType = [string]$Source.sourceType
    }
  }
  return $normalized
}

if (-not (Test-Path $ConfigPath)) {
  throw "Asset intelligence config not found: $ConfigPath"
}

$config = Get-Content -Raw $ConfigPath | ConvertFrom-Json
$sources = @($config.sources)
if ($sources.Count -eq 0) {
  throw "No sources configured in $ConfigPath"
}

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$runOutDir = Join-Path $OutDir $runId
New-Item -ItemType Directory -Path $runOutDir -Force | Out-Null
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null

$sourceStatus = @()

foreach ($source in $sources) {
  $feeds = @($source.directFeeds)
  $sourceRows = @()
  $feedStatuses = @()

  if ($feeds.Count -eq 0) {
    $sourceStatus += [pscustomobject]@{
      sourceKey = [string]$source.key
      sourceName = [string]$source.name
      status = "skipped_no_direct_feeds"
      feedCount = 0
      rows = 0
      feeds = @()
    }
    continue
  }

  foreach ($feed in $feeds) {
    $feedName = [string]$feed.name
    $url = Resolve-FeedUrl -Feed $feed
    if ([string]::IsNullOrWhiteSpace($url)) {
      $feedStatuses += [pscustomobject]@{
        feedName = $feedName
        status = "skipped_missing_url"
        rows = 0
        authMode = "none"
        authRef = ""
        attempts = 0
        error = ""
      }
      continue
    }

    $plans = @(Build-FeedRequestPlans -Feed $feed -Url $url)
    $errors = New-Object System.Collections.Generic.List[string]
    $loaded = $false
    foreach ($plan in $plans) {
      try {
        $resp = Invoke-WebRequest -Method Get -Uri ([string]$plan.url) -TimeoutSec $TimeoutSec -Headers $plan.headers
        $content = [string]$resp.Content
        $parsedRows = @()

        $jsonDoc = $null
        $asXml = $null
        $parsedAsJson = $false
        try {
          $jsonDoc = $content | ConvertFrom-Json
          $parsedAsJson = $true
        } catch {
          $parsedAsJson = $false
        }

        if ($parsedAsJson) {
          $parsedRows = Parse-JsonRows -Doc $jsonDoc
        } else {
          try {
            $asXml = [xml]$content
            $parsedRows = Parse-XmlRows -Doc $asXml
          } catch {
            $parsedRows = @()
          }
        }

        $normalized = Normalize-FeedRows -Rows $parsedRows -Source $source -FeedName $feedName -FeedUrl ([string]$plan.url)
        $sourceRows += $normalized
        $feedStatuses += [pscustomobject]@{
          feedName = $feedName
          status = "ok"
          rows = $normalized.Count
          authMode = [string]$plan.authMode
          authRef = [string]$plan.authRef
          attempts = $plans.Count
          error = ""
        }
        $loaded = $true
        break
      } catch {
        [void]$errors.Add(("{0}:{1}" -f [string]$plan.authRef, [string]$_.Exception.Message))
      }
    }

    if (-not $loaded) {
      $feedStatuses += [pscustomobject]@{
        feedName = $feedName
        status = "error"
        rows = 0
        authMode = ""
        authRef = ""
        attempts = $plans.Count
        error = ("All auth attempts failed ({0}): {1}" -f $plans.Count, ($errors -join " | "))
      }
    }
  }

  $sourceJsonPath = Join-Path $runOutDir ("{0}.json" -f [string]$source.key)
  $sourceRows | ConvertTo-Json -Depth 8 | Set-Content -Path $sourceJsonPath -Encoding UTF8

  $stagingPath = Join-Path $StagingDir ("{0}.csv" -f [string]$source.key)
  if ($sourceRows.Count -gt 0) {
    $sourceRows | Export-Csv -Path $stagingPath -NoTypeInformation -Encoding UTF8
  } elseif (-not (Test-Path $stagingPath)) {
    "title,url,summary,publishedAt,city,sourceQuery,notes,sourceKey,sourceName,sourceType" | Set-Content -Path $stagingPath -Encoding UTF8
  }

  $status = if ((@($feedStatuses | Where-Object { $_.status -eq "ok" -and $_.rows -gt 0 })).Count -gt 0) {
    "ok"
  } elseif ((@($feedStatuses | Where-Object { $_.status -eq "error" })).Count -gt 0) {
    "partial_or_error"
  } else {
    "no_rows"
  }

  $sourceStatus += [pscustomobject]@{
    sourceKey = [string]$source.key
    sourceName = [string]$source.name
    status = $status
    feedCount = $feeds.Count
    rows = $sourceRows.Count
    stagingPath = $stagingPath
    feeds = $feedStatuses
  }
}

$manifest = [pscustomobject]@{
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  runId = $runId
  configPath = (Resolve-Path $ConfigPath).Path
  outputDir = (Resolve-Path $runOutDir).Path
  stagingDir = (Resolve-Path $StagingDir).Path
  summary = [pscustomobject]@{
    configuredSources = $sources.Count
    sourcesWithRows = (@($sourceStatus | Where-Object { $_.rows -gt 0 })).Count
    totalRows = (@($sourceStatus | Measure-Object -Property rows -Sum).Sum)
  }
  sourceStatus = $sourceStatus
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$manifestPath = Join-Path $runOutDir "manifest.json"
$latestPath = Join-Path $OutDir "latest-manifest.json"
$manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $manifestPath -Encoding UTF8
$manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $latestPath -Encoding UTF8

Write-Host "Wrote $manifestPath"
Write-Host "Wrote $latestPath"
