param(
  [string] $BaseUrl = $env:STUDIO_BRAIN_BASE_URL,
  [string] $CapabilitiesPath = "/api/capabilities",
  [string] $IdToken = $env:STUDIO_BRAIN_ID_TOKEN,
  [string] $AdminToken = $env:STUDIO_BRAIN_ADMIN_TOKEN,
  [switch] $PromptForToken
)

$scriptPath = Join-Path $PSScriptRoot "test-studio-brain-auth.mjs"
$argsList = @($scriptPath)

if (-not [string]::IsNullOrWhiteSpace($BaseUrl)) {
  $argsList += "--base-url"
  $argsList += $BaseUrl
}

if (-not [string]::IsNullOrWhiteSpace($CapabilitiesPath)) {
  $argsList += "--capabilities-path"
  $argsList += $CapabilitiesPath
}

if (-not [string]::IsNullOrWhiteSpace($IdToken)) {
  $argsList += "--id-token"
  $argsList += $IdToken
}

if (-not [string]::IsNullOrWhiteSpace($AdminToken)) {
  $argsList += "--admin-token"
  $argsList += $AdminToken
}

if ($PromptForToken) {
  $argsList += "--prompt-for-token"
}

node @argsList
