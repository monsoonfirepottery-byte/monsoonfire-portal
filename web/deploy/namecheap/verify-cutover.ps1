param(
  [string]$PortalUrl = "https://portal.monsoonfire.com",
  [string]$DeepPath = "/reservations",
  [string]$WellKnownPath = "/.well-known/apple-app-site-association"
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

Write-Host "Cutover verification complete."
