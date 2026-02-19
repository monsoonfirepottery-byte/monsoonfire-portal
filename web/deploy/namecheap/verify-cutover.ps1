param(
  [string]$PortalUrl = "https://portal.monsoonfire.com",
  [string]$DeepPath = "/reservations",
  [string]$WellKnownPath = "/.well-known/apple-app-site-association",
  [string]$ReportPath = ""
)

Write-Warning "Compatibility shim: prefer node ./web/deploy/namecheap/verify-cutover.mjs"

$script = Join-Path $PSScriptRoot "verify-cutover.mjs"
$arguments = @(
  "--portal-url", $PortalUrl,
  "--deep-path", $DeepPath,
  "--well-known-path", $WellKnownPath
)

if ($ReportPath) {
  $arguments += @("--report-path", $ReportPath)
}

node $script @arguments

