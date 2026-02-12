param(
  [string]$PortalUrl = "https://portal.monsoonfire.com",
  [string]$DeepPath = "/reservations",
  [string]$WellKnownPath = "/.well-known/apple-app-site-association",
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"

function Assert-Ok {
  param(
    [string]$Label,
    [Microsoft.PowerShell.Commands.HtmlWebResponseObject]$Response,
    [int[]]$AllowedStatus = @(200)
  )

  if ($AllowedStatus -notcontains [int]$Response.StatusCode) {
    throw "$Label failed. Expected status $($AllowedStatus -join ',') but got $($Response.StatusCode)."
  }

  Write-Host "[ok] $Label - $($Response.StatusCode)"
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
    [Microsoft.PowerShell.Commands.HtmlWebResponseObject]$Response,
    [string]$HeaderName
  )

  $value = $Response.Headers[$HeaderName]
  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Warning "$Label missing header: $HeaderName"
    return
  }

  Write-Host "[info] $Label $HeaderName: $value"
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
  return $paths | Select-Object -Unique
}

function Check-AssetCacheHeaders {
  param(
    [string]$PortalBase,
    [string[]]$AssetPaths
  )

  $results = @()
  foreach ($assetPath in $AssetPaths) {
    $assetUrl = "$PortalBase$assetPath"
    try {
      $assetResp = Invoke-WebRequest -Uri $assetUrl -MaximumRedirection 5
      $cache = [string]$assetResp.Headers["Cache-Control"]
      $immutable = $cache -match "immutable"
      $hasLongMaxAge = $cache -match "max-age=(\d{5,})"
      $ok = $immutable -or $hasLongMaxAge
      if ($ok) {
        Write-Host "[ok] Asset cache header for $assetPath -> $cache"
      } else {
        Write-Warning "Asset cache header may be too weak for $assetPath -> $cache"
      }
      $results += [ordered]@{
        path = $assetPath
        status = [int]$assetResp.StatusCode
        cacheControl = $cache
        cacheLooksLongLived = [bool]$ok
      }
    } catch {
      Write-Warning "Failed to fetch asset $assetPath : $($_.Exception.Message)"
      $results += [ordered]@{
        path = $assetPath
        status = 0
        cacheControl = ""
        cacheLooksLongLived = $false
        error = $_.Exception.Message
      }
    }
  }
  return $results
}

$portal = $PortalUrl.TrimEnd('/')
$rootUrl = "$portal/"
$deepUrl = "$portal$DeepPath"
$wellKnownUrl = "$portal$WellKnownPath"

Write-Host "Verifying portal cutover for $portal"

$root = Invoke-WebRequest -Uri $rootUrl -MaximumRedirection 5
Assert-Ok -Label "Root route" -Response $root
Assert-Contains -Label "Root contains app shell" -Body $root.Content -Needle "<html"
Show-Header -Label "Root" -Response $root -HeaderName "Cache-Control"

$deep = Invoke-WebRequest -Uri $deepUrl -MaximumRedirection 5
Assert-Ok -Label "Deep route ($DeepPath)" -Response $deep
Assert-Contains -Label "Deep route served HTML" -Body $deep.Content -Needle "<html"
Show-Header -Label "Deep route" -Response $deep -HeaderName "Cache-Control"

$assetPaths = Resolve-AssetPathsFromHtml -Html $root.Content
$sampleAssets = @($assetPaths | Select-Object -First 3)
if ($sampleAssets.Count -eq 0) {
  Write-Warning "No /assets/* paths were found in root HTML. Verify build output and upload integrity."
}
$assetChecks = Check-AssetCacheHeaders -PortalBase $portal -AssetPaths $sampleAssets

try {
  $wellKnown = Invoke-WebRequest -Uri $wellKnownUrl -MaximumRedirection 5
  Assert-Ok -Label "Well-known route ($WellKnownPath)" -Response $wellKnown -AllowedStatus @(200)
  if ($wellKnown.Content -match "<html") {
    throw "Well-known route appears rewritten to HTML. Check .htaccess rewrite bypass for /.well-known/."
  }
  Write-Host "[ok] Well-known route not rewritten to SPA"
} catch {
  Write-Warning "Well-known check warning: $($_.Exception.Message)"
  Write-Warning "If this file is not deployed yet, this warning can be ignored until AASA/assetlinks are uploaded."
}

if ($ReportPath) {
  $report = [ordered]@{
    atUtc = (Get-Date).ToUniversalTime().ToString("o")
    portalUrl = $portal
    rootUrl = $rootUrl
    deepUrl = $deepUrl
    wellKnownUrl = $wellKnownUrl
    rootStatus = [int]$root.StatusCode
    deepStatus = [int]$deep.StatusCode
    rootCacheControl = [string]$root.Headers["Cache-Control"]
    deepCacheControl = [string]$deep.Headers["Cache-Control"]
    sampledAssets = $sampleAssets
    assetChecks = $assetChecks
  }
  ($report | ConvertTo-Json -Depth 8) | Set-Content -Path $ReportPath
  Write-Host "Wrote cutover verification report to $ReportPath"
}

Write-Host "Cutover verification complete."
