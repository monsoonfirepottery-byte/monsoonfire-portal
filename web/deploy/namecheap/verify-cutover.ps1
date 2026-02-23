param(
  [string]$PortalUrl = "https://portal.monsoonfire.com",
  [string]$DeepPath = "/reservations",
  [string]$WellKnownPath = "/.well-known/apple-app-site-association",
  [string]$ReportPath = "",
  [string]$FunctionsBaseUrl = "https://us-central1-monsoonfire-portal.cloudfunctions.net",
  [string]$ProtectedFn = "listMaterialsProducts",
  [string]$ProtectedBody = "",
  [string]$IdToken = "",
  [string]$IdTokenEnv = "PORTAL_CUTOVER_ID_TOKEN",
  [switch]$RequireProtectedCheck
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

$arguments += @("--functions-base-url", $FunctionsBaseUrl)
$arguments += @("--protected-fn", $ProtectedFn)

if ($ProtectedBody) {
  $arguments += @("--protected-body", $ProtectedBody)
}

if ($IdToken) {
  $arguments += @("--id-token", $IdToken)
} else {
  $arguments += @("--id-token-env", $IdTokenEnv)
}

if ($RequireProtectedCheck) {
  $arguments += @("--require-protected-check", "true")
}

node $script @arguments
