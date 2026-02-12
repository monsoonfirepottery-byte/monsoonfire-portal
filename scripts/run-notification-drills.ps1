param(
  [Parameter(Mandatory = $true)] [string] $BaseUrl,
  [Parameter(Mandatory = $true)] [string] $IdToken,
  [Parameter(Mandatory = $true)] [string] $Uid,
  [string] $AdminToken = "",
  [string] $LogFile = "",
  [switch] $OutputJson
)

function Test-Placeholder([string] $value) {
  return $value -match "^<.+>$"
}

$BaseUrl = $BaseUrl.Trim()
$IdToken = $IdToken.Trim()
$Uid = $Uid.Trim()
$AdminToken = $AdminToken.Trim()

if ($IdToken -match "^Bearer\\s+") {
  $IdToken = ($IdToken -replace "^Bearer\\s+", "").Trim()
}

function ConvertFrom-Base64Url([string] $value) {
  $value = $value.Replace("-", "+").Replace("_", "/")
  switch ($value.Length % 4) {
    0 { break }
    2 { $value += "=="; break }
    3 { $value += "="; break }
    default { return $null }
  }

  try {
    return [System.Convert]::FromBase64String($value)
  } catch {
    return $null
  }
}

function Get-JwtPayload([string] $jwt) {
  if (-not $jwt) { return $null }
  $parts = $jwt.Split(".")
  if ($parts.Length -ne 3) { return $null }

  $payloadBytes = ConvertFrom-Base64Url $parts[1]
  if ($null -eq $payloadBytes) { return $null }

  try {
    $payloadJson = [System.Text.Encoding]::UTF8.GetString($payloadBytes)
    return $payloadJson | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Test-FirebaseIdToken([string] $jwt) {
  # Firebase ID tokens have issuer like: https://securetoken.google.com/<projectId>
  $payload = Get-JwtPayload $jwt
  if ($null -eq $payload) { return $false }
  if (-not $payload.iss) { return $false }
  return ([string] $payload.iss) -like "https://securetoken.google.com/*"
}

if (Test-Placeholder $IdToken) {
  Write-Error "IdToken is a placeholder. Use a real Firebase ID token (JWT)."
  Write-Error "Hint: In the portal web app, sign in then open DevTools -> Network, click any Cloud Functions request, and copy the Authorization header value (strip 'Bearer ')."
  exit 1
}
if (-not (Test-FirebaseIdToken $IdToken)) {
  Write-Error "IdToken does not look like a Firebase ID token. Do not use the dev admin token here."
  Write-Error "Hint: In the portal web app, sign in then open DevTools -> Network, click any Cloud Functions request, and copy the Authorization header value (strip 'Bearer ')."
  exit 1
}
if (Test-Placeholder $Uid) {
  Write-Error "Uid is a placeholder. Use the real Firebase UID for drill target."
  exit 1
}
if ($AdminToken -ne "" -and (Test-Placeholder $AdminToken)) {
  Write-Error "AdminToken is a placeholder. Use a real admin token or omit -AdminToken."
  exit 1
}

$headers = @{
  "Authorization" = "Bearer $IdToken"
  "Content-Type"  = "application/json"
}
if ($AdminToken -ne "") {
  $headers["x-admin-token"] = $AdminToken
}

$modes = @("auth", "provider_4xx", "provider_5xx", "network", "success")
$runSummary = [ordered]@{
  atUtc = (Get-Date).ToUniversalTime().ToString("o")
  baseUrl = $BaseUrl
  uid = $Uid
  adminTokenUsed = [bool]($AdminToken -ne "")
  drills = @()
  metrics = $null
}

foreach ($mode in $modes) {
  $payload = @{
    uid = $Uid
    mode = $mode
    channels = @{
      push = $true
      inApp = $false
      email = $false
    }
    forceRunNow = $true
  } | ConvertTo-Json -Depth 5

  Write-Host "Queueing drill mode: $mode"
  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/runNotificationFailureDrill" -Headers $headers -Body $payload
    $runSummary.drills += [ordered]@{
      mode = $mode
      ok = $true
      status = $resp.status
      failureClass = $resp.failureClass
      retryable = $resp.retryable
      response = $resp
    }
    $resp | Out-Host
  } catch {
    Write-Host "Drill mode '$mode' failed: $($_.Exception.Message)"
    $runSummary.drills += [ordered]@{
      mode = $mode
      ok = $false
      error = $_.Exception.Message
    }
  }
}

Write-Host "Running metrics aggregation snapshot..."
try {
  $metricsResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/runNotificationMetricsAggregationNow" -Headers $headers -Body "{}"
  $runSummary.metrics = $metricsResp
  $metricsResp | Out-Host
} catch {
  Write-Host "Metrics aggregation failed: $($_.Exception.Message)"
  $runSummary.metrics = [ordered]@{
    ok = $false
    error = $_.Exception.Message
  }
}

if ($OutputJson) {
  $json = $runSummary | ConvertTo-Json -Depth 10
  Write-Output $json
}

if ($LogFile) {
  $logPath = $LogFile.Trim()
  $line = $runSummary | ConvertTo-Json -Depth 10 -Compress
  Add-Content -Path $logPath -Value $line
  Write-Host "Appended structured run summary to $logPath"
}

Write-Host "Drill run completed."
