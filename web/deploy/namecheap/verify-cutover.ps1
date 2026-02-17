<#
Works in both pwsh (PowerShell 7+) and Windows PowerShell 5.1.
Run:
  pwsh .\web\deploy\namecheap\verify-cutover.ps1 -PortalUrl "https://portal.monsoonfire.com" -ReportPath "docs/cutover-verify.json"
  powershell .\web\deploy\namecheap\verify-cutover.ps1 -PortalUrl "https://portal.monsoonfire.com" -ReportPath "docs/cutover-verify.json"
#>

param(
  [string]$PortalUrl = "https://portal.monsoonfire.com",
  [string]$DeepPath = "/reservations",
  [string]$WellKnownPath = "/.well-known/apple-app-site-association",
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

function Invoke-HttpGet {
  param(
    [string]$Uri,
    [int]$TimeoutSec = 30
  )

  $invokeArgs = @{
    Uri = $Uri
    Method = "Get"
    MaximumRedirection = 5
    TimeoutSec = $TimeoutSec
  }

  if (Get-Command Invoke-WebRequest -ParameterName SkipHttpErrorCheck -ErrorAction SilentlyContinue) {
    $invokeArgs.SkipHttpErrorCheck = $true
  }
  if ($PSVersionTable.PSEdition -eq "Desktop") {
    $invokeArgs.UseBasicParsing = $true
  }

  try {
    $response = Invoke-WebRequest @invokeArgs
    return [ordered]@{
      ok = $true
      statusCode = [int]$response.StatusCode
      content = [string]$response.Content
      headers = $response.Headers
      error = $null
    }
  } catch {
    $statusCode = 0
    $content = ""
    $headers = @{}
    $resp = $_.Exception.Response
    if ($resp) {
      try {
        if ($resp.StatusCode) { $statusCode = [int]$resp.StatusCode }
      } catch {}
      try {
        $headers = $resp.Headers
      } catch {}
      try {
        $stream = $resp.GetResponseStream()
        if ($stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $content = $reader.ReadToEnd()
          $reader.Dispose()
        }
      } catch {}
    }
    return [ordered]@{
      ok = $false
      statusCode = $statusCode
      content = [string]$content
      headers = $headers
      error = $_.Exception.Message
    }
  }
}

function Get-HeaderValue {
  param(
    [object]$Headers,
    [string]$HeaderName
  )

  if (-not $Headers) { return "" }
  try {
    $value = $Headers[$HeaderName]
    if (-not [string]::IsNullOrWhiteSpace([string]$value)) { return [string]$value }
  } catch {}
  try {
    foreach ($key in $Headers.Keys) {
      if ([string]::Equals([string]$key, $HeaderName, [System.StringComparison]::OrdinalIgnoreCase)) {
        return [string]$Headers[$key]
      }
    }
  } catch {}
  return ""
}

function Assert-Status {
  param(
    [string]$Label,
    [hashtable]$Response,
    [int[]]$AllowedStatus = @(200)
  )

  if ($AllowedStatus -notcontains [int]$Response.statusCode) {
    $msg = if ($Response.error) { " Error: $($Response.error)" } else { "" }
    throw "$Label failed. Expected status $($AllowedStatus -join ',') but got $($Response.statusCode).$msg"
  }
  Write-Host ("[ok] {0} - {1}" -f $Label, $Response.statusCode)
}

function Assert-Contains {
  param(
    [string]$Label,
    [string]$Body,
    [string]$Needle
  )
  if (-not $Body.Contains($Needle)) {
    throw "$Label failed. Missing expected text: $Needle"
  }
  Write-Host "[ok] $Label"
}

function Show-Header {
  param(
    [string]$Label,
    [hashtable]$Response,
    [string]$HeaderName
  )
  $value = Get-HeaderValue -Headers $Response.headers -HeaderName $HeaderName
  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Warning "$Label missing header: $HeaderName"
    return
  }
  Write-Host ("[info] {0} {1}: {2}" -f $Label, $HeaderName, $value)
}

function Resolve-AssetPathsFromHtml {
  param([string]$Html)

  $paths = New-Object System.Collections.Generic.List[string]
  $regexes = @(
    'src\s*=\s*"(/assets/[^"]+)"',
    "src\s*=\s*'(/assets/[^']+)'",
    'href\s*=\s*"(/assets/[^"]+)"',
    "href\s*=\s*'(/assets/[^']+)'"
  )
  foreach ($pattern in $regexes) {
    foreach ($match in [regex]::Matches($Html, $pattern)) {
      if ($match.Groups.Count -gt 1) {
        $assetPath = $match.Groups[1].Value
        if (-not [string]::IsNullOrWhiteSpace($assetPath)) {
          $paths.Add($assetPath)
        }
      }
    }
  }

  $unique = $paths | Select-Object -Unique
  $jsAssets = @($unique | Where-Object { $_ -match '^/assets/.*\.js($|\?)' } | Select-Object -First 3)
  if ($jsAssets.Count -gt 0) {
    return $jsAssets
  }
  return @($unique | Select-Object -First 3)
}

function Check-AssetCacheHeaders {
  param(
    [string]$PortalBase,
    [string[]]$AssetPaths
  )

  $results = @()
  foreach ($assetPath in $AssetPaths) {
    $assetUrl = "$PortalBase$assetPath"
    $assetResp = Invoke-HttpGet -Uri $assetUrl
    $cache = Get-HeaderValue -Headers $assetResp.headers -HeaderName "Cache-Control"
    $immutable = $cache -match "immutable"
    $hasLongMaxAge = $cache -match "max-age=(\d{5,})"
    $ok = ($assetResp.statusCode -eq 200) -and ($immutable -or $hasLongMaxAge)
    if ($ok) {
      Write-Host "[ok] Asset cache header for $assetPath -> $cache"
    } else {
      Write-Warning "Asset cache header may be too weak for $assetPath -> status=$($assetResp.statusCode) cache=$cache"
    }
    $results += [ordered]@{
      path = $assetPath
      status = [int]$assetResp.statusCode
      cacheControl = $cache
      cacheLooksLongLived = [bool]$ok
      error = $assetResp.error
    }
  }
  return $results
}

$portal = $PortalUrl.TrimEnd("/")
$rootUrl = "$portal/"
$deepUrl = "$portal$DeepPath"
$wellKnownUrl = "$portal$WellKnownPath"

Write-Host "Verifying portal cutover for $portal"

$root = Invoke-HttpGet -Uri $rootUrl
Assert-Status -Label "Root route" -Response $root
Assert-Contains -Label "Root contains app shell" -Body $root.content -Needle "<html"
Show-Header -Label "Root" -Response $root -HeaderName "Cache-Control"

$deep = Invoke-HttpGet -Uri $deepUrl
Assert-Status -Label "Deep route ($DeepPath)" -Response $deep
Assert-Contains -Label "Deep route served HTML" -Body $deep.content -Needle "<html"
Show-Header -Label "Deep route" -Response $deep -HeaderName "Cache-Control"

$assetPaths = Resolve-AssetPathsFromHtml -Html $root.content
$sampleAssets = @($assetPaths)
if ($sampleAssets.Count -eq 0) {
  Write-Warning "No /assets/* paths were found in root HTML. Verify build output and upload integrity."
}
$assetChecks = Check-AssetCacheHeaders -PortalBase $portal -AssetPaths $sampleAssets

$wellKnown = Invoke-HttpGet -Uri $wellKnownUrl
if ($wellKnown.statusCode -eq 200) {
  $wellKnownContent = if ($null -eq $wellKnown.content) { "" } else { [string]$wellKnown.content }
  if ($wellKnownContent -match "<html") {
    Write-Warning "Well-known route appears rewritten to HTML. Check .htaccess rewrite bypass for /.well-known/."
  } else {
    Write-Host "[ok] Well-known route not rewritten to SPA"
  }
} else {
  Write-Warning "Well-known check warning: status=$($wellKnown.statusCode) error=$($wellKnown.error)"
  Write-Warning "If this file is not deployed yet, this warning can be ignored until AASA/assetlinks are uploaded."
}

if ($ReportPath) {
  $report = [ordered]@{
    atUtc = (Get-Date).ToUniversalTime().ToString("o")
    portalUrl = $portal
    rootUrl = $rootUrl
    deepUrl = $deepUrl
    wellKnownUrl = $wellKnownUrl
    rootStatus = [int]$root.statusCode
    deepStatus = [int]$deep.statusCode
    rootCacheControl = (Get-HeaderValue -Headers $root.headers -HeaderName "Cache-Control")
    deepCacheControl = (Get-HeaderValue -Headers $deep.headers -HeaderName "Cache-Control")
    sampledAssets = $sampleAssets
    assetChecks = $assetChecks
  }
  ($report | ConvertTo-Json -Depth 8) | Set-Content -Path $ReportPath
  Write-Host "Wrote cutover verification report to $ReportPath"
}

Write-Host "Cutover verification complete."
