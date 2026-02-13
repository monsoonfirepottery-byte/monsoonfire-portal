param(
  [string]$BaseUrl = $env:STUDIO_BRAIN_BASE_URL,
  [string]$CapabilitiesPath = "/api/capabilities",
  [string]$IdToken = $env:STUDIO_BRAIN_ID_TOKEN,
  [switch]$PromptForToken
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = "http://127.0.0.1:8787"
}

function Redact-Token {
  param([string]$Token)
  if ([string]::IsNullOrWhiteSpace($Token)) { return "<empty>" }
  $trimmed = $Token.Trim()
  $prefix = if ($trimmed.Length -le 12) { $trimmed } else { $trimmed.Substring(0, 12) }
  return ("{0}... (len={1})" -f $prefix, $trimmed.Length)
}

function To-Preview {
  param([string]$Value, [int]$Max = 220)
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  $single = ($Value -replace "`r", "" -replace "`n", " ").Trim()
  if ($single.Length -le $Max) { return $single }
  return $single.Substring(0, $Max) + "..."
}

function Invoke-Probe {
  param(
    [string]$Label,
    [string]$Url,
    [hashtable]$Headers
  )

  try {
    $invokeArgs = @{
      Uri = $Url
      Method = "Get"
      Headers = $Headers
      TimeoutSec = 15
    }
    if (Get-Command Invoke-WebRequest -ParameterName SkipHttpErrorCheck -ErrorAction SilentlyContinue) {
      $invokeArgs.SkipHttpErrorCheck = $true
    } elseif ($PSVersionTable.PSEdition -eq "Desktop") {
      $invokeArgs.UseBasicParsing = $true
    }
    $response = Invoke-WebRequest @invokeArgs
    return [ordered]@{
      label = $Label
      statusCode = [int]$response.StatusCode
      body = [string]$response.Content
      error = $null
    }
  } catch {
    $status = 0
    $body = ""
    $resp = $_.Exception.Response
    if ($resp) {
      try {
        if ($resp.StatusCode) { $status = [int]$resp.StatusCode }
      } catch {}
      try {
        $stream = $resp.GetResponseStream()
        if ($stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $body = $reader.ReadToEnd()
          $reader.Dispose()
        }
      } catch {}
    }
    return [ordered]@{
      label = $Label
      statusCode = $status
      body = [string]$body
      error = $_.Exception.Message
    }
  }
}

function Find-WorkingCapabilitiesPath {
  param([string]$PortalBase, [string]$PreferredPath)

  $candidatePaths = @($PreferredPath, "/api/capabilities", "/capabilities") | Select-Object -Unique
  foreach ($path in $candidatePaths) {
    $probe = Invoke-Probe -Label "path-probe:$path" -Url "$PortalBase$path" -Headers @{}
    if ($probe.statusCode -ne 404) {
      return [ordered]@{
        path = $path
        statusCode = $probe.statusCode
      }
    }
  }
  return [ordered]@{
    path = $PreferredPath
    statusCode = 404
  }
}

$trimmedToken = [string]$IdToken
$trimmedToken = $trimmedToken.Trim()
if ([string]::IsNullOrWhiteSpace($trimmedToken) -and $PromptForToken) {
  $trimmedToken = (Read-Host "Enter Firebase ID token for Authorization header").Trim()
}

$base = $BaseUrl.TrimEnd("/")
$pathResolution = Find-WorkingCapabilitiesPath -PortalBase $base -PreferredPath $CapabilitiesPath
$targetPath = [string]$pathResolution.path
$targetUrl = "$base$targetPath"
$adminToken = [string]$env:STUDIO_BRAIN_ADMIN_TOKEN

Write-Host ("Studio Brain auth probe target: {0}" -f $targetUrl)
Write-Host ("Capabilities path detection status: {0}" -f $pathResolution.statusCode)
Write-Host ("ID token source: {0}" -f $(if ([string]::IsNullOrWhiteSpace($trimmedToken)) { "missing" } else { Redact-Token -Token $trimmedToken }))
Write-Host ("Admin token source: {0}" -f $(if ([string]::IsNullOrWhiteSpace($adminToken)) { "missing" } else { Redact-Token -Token $adminToken }))

$cases = New-Object System.Collections.Generic.List[object]
$cases.Add((Invoke-Probe -Label "A no headers" -Url $targetUrl -Headers @{})) | Out-Null

if (-not [string]::IsNullOrWhiteSpace($trimmedToken)) {
  $cases.Add((Invoke-Probe -Label "B Authorization only" -Url $targetUrl -Headers @{ Authorization = "Bearer $trimmedToken" })) | Out-Null
} else {
  $cases.Add([ordered]@{
    label = "B Authorization only"
    statusCode = -1
    body = ""
    error = "Skipped: no ID token. Set STUDIO_BRAIN_ID_TOKEN or pass -PromptForToken."
  }) | Out-Null
}

if (-not [string]::IsNullOrWhiteSpace($trimmedToken) -and -not [string]::IsNullOrWhiteSpace($adminToken)) {
  $cases.Add((Invoke-Probe -Label "C Authorization + x-studio-brain-admin-token" -Url $targetUrl -Headers @{
    Authorization = "Bearer $trimmedToken"
    "x-studio-brain-admin-token" = $adminToken
  })) | Out-Null
} else {
  $cases.Add([ordered]@{
    label = "C Authorization + x-studio-brain-admin-token"
    statusCode = -1
    body = ""
    error = "Skipped: missing STUDIO_BRAIN_ID_TOKEN or STUDIO_BRAIN_ADMIN_TOKEN."
  }) | Out-Null
}

Write-Host ""
Write-Host "Results:"
foreach ($item in $cases) {
  Write-Host ("- {0}: status={1}" -f $item.label, $item.statusCode)
  if (-not [string]::IsNullOrWhiteSpace($item.error)) {
    Write-Host ("  error={0}" -f (To-Preview -Value $item.error -Max 180))
  }
  if (-not [string]::IsNullOrWhiteSpace($item.body)) {
    Write-Host ("  body={0}" -f (To-Preview -Value $item.body -Max 220))
  }
}

$caseA = $cases[0]
$caseB = $cases[1]
$passA = (
  ($caseA.statusCode -in @(401, 403)) -or
  (([string]$caseA.body).ToLowerInvariant().Contains("missing authorization header"))
)

$passB = $false
if ($caseB.statusCode -eq -1) {
  $passB = $false
} else {
  $bodyLower = ([string]$caseB.body).ToLowerInvariant()
  $passB = ($caseB.statusCode -eq 200) -or (-not $bodyLower.Contains("missing authorization header"))
}

$passC = $true
if ($cases[2].statusCode -ne -1) {
  $bodyLowerC = ([string]$cases[2].body).ToLowerInvariant()
  $passC = ($cases[2].statusCode -eq 200) -or (-not $bodyLowerC.Contains("missing authorization header"))
}

Write-Host ""
Write-Host ("PASS A (no headers rejected): {0}" -f $passA)
Write-Host ("PASS B (authorization accepted/non-missing-auth): {0}" -f $passB)
Write-Host ("PASS C (authorization+admin accepted/non-missing-auth): {0}" -f $passC)

if ($passA -and $passB -and $passC) {
  Write-Host "Overall: PASS"
  exit 0
}

Write-Host "Overall: FAIL"
exit 1
