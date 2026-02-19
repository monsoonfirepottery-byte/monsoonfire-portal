param(
  [ValidateSet('local', 'staging', 'both', 'none')]
  [string]$StudioDrills = 'local',
  [switch]$RunNotificationDrills,
  [string]$FunctionsBaseUrl = 'https://us-central1-monsoonfire-portal.cloudfunctions.net',
  [string]$NotificationIdToken = '',
  [string]$NotificationUid = '',
  [string]$NotificationAdminToken = '',
  [string]$OutputDir = 'output/ops-evidence'
)

$ErrorActionPreference = 'Stop'

function Invoke-CapturedProcess {
  param(
    [Parameter(Mandatory = $true)] [string]$FilePath,
    [string[]]$Arguments = @(),
    [hashtable]$EnvironmentOverrides = @{}
  )

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  foreach ($arg in $Arguments) {
    [void]$psi.ArgumentList.Add($arg)
  }
  $psi.WorkingDirectory = (Resolve-Path '.').Path
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true

  foreach ($entry in $EnvironmentOverrides.GetEnumerator()) {
    if ($null -ne $entry.Value -and [string]::IsNullOrWhiteSpace([string]$entry.Value) -eq $false) {
      $psi.Environment[$entry.Key] = [string]$entry.Value
    }
  }

  $proc = [System.Diagnostics.Process]::new()
  $proc.StartInfo = $psi
  [void]$proc.Start()
  $stdout = $proc.StandardOutput.ReadToEnd()
  $stderr = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()

  return [pscustomobject]@{
    filePath = $FilePath
    arguments = $Arguments
    exitCode = $proc.ExitCode
    stdout = $stdout
    stderr = $stderr
  }
}

function Parse-ArtifactPath {
  param([string]$StdOut)

  if ([string]::IsNullOrWhiteSpace($StdOut)) {
    return $null
  }

  $match = [regex]::Match($StdOut, 'Wrote\s+(.+)$', [System.Text.RegularExpressions.RegexOptions]::Multiline)
  if (-not $match.Success) {
    return $null
  }

  return $match.Groups[1].Value.Trim()
}

function Add-StepResult {
  param(
    [Parameter(Mandatory = $true)] [ref]$Results,
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [string]$Status,
    [string]$Notes = '',
    [object]$Payload = $null
  )

  $Results.Value += [pscustomobject]@{
    name = $Name
    status = $Status
    notes = $Notes
    payload = $Payload
  }
}

function Build-MarkdownSummary {
  param(
    [Parameter(Mandatory = $true)] [pscustomobject]$RunSummary,
    [Parameter(Mandatory = $true)] [string]$JsonPath
  )

  $lines = @()
  $lines += '# Ops Evidence Autopilot Run'
  $lines += ''
  $lines += "- runId: $($RunSummary.runId)"
  $lines += "- startedAtUtc: $($RunSummary.startedAtUtc)"
  $lines += "- finishedAtUtc: $($RunSummary.finishedAtUtc)"
  $lines += "- summaryJson: $JsonPath"
  $lines += ''
  $lines += '## Steps'

  foreach ($step in $RunSummary.steps) {
    $marker = if ($step.status -eq 'success') { '[x]' } elseif ($step.status -eq 'skipped') { '[-]' } else { '[ ]' }
    $lines += "- $marker $($step.name): $($step.status)"
    if ($step.notes) {
      $lines += "  - $($step.notes)"
    }
  }

  $lines += ''
  $lines += '## Artifacts'
  if ($RunSummary.artifacts.Count -eq 0) {
    $lines += '- none'
  } else {
    foreach ($artifact in $RunSummary.artifacts) {
      $lines += "- $artifact"
    }
  }

  return ($lines -join "`n") + "`n"
}

$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$outDirPath = Resolve-Path '.' | ForEach-Object { Join-Path $_.Path $OutputDir }
New-Item -ItemType Directory -Force -Path $outDirPath | Out-Null

$steps = @()
$artifacts = New-Object System.Collections.Generic.List[string]

$summary = [pscustomobject]@{
  runId = $runId
  startedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  config = [pscustomobject]@{
    studioDrills = $StudioDrills
    runNotificationDrills = [bool]$RunNotificationDrills
    outputDir = $outDirPath
  }
  steps = $null
  artifacts = $artifacts
}

if ($StudioDrills -in @('local', 'both')) {
  $result = Invoke-CapturedProcess -FilePath 'node' -Arguments @('scripts/run-studio-os-v3-local-drills.mjs')
  $artifact = Parse-ArtifactPath -StdOut $result.stdout
  if ($artifact) {
    $artifacts.Add($artifact)
  }
  $status = if ($result.exitCode -eq 0) { 'success' } else { 'failed' }
  Add-StepResult -Results ([ref]$steps) -Name 'studio-v3-local-drills' -Status $status -Notes ($artifact ?? 'No artifact path detected.') -Payload $result
} else {
  Add-StepResult -Results ([ref]$steps) -Name 'studio-v3-local-drills' -Status 'skipped' -Notes 'Not requested.'
}

if ($StudioDrills -in @('staging', 'both')) {
  $idToken = [Environment]::GetEnvironmentVariable('STUDIO_BRAIN_ID_TOKEN')
  if ([string]::IsNullOrWhiteSpace($idToken)) {
    Add-StepResult -Results ([ref]$steps) -Name 'studio-v3-staging-drills' -Status 'skipped' -Notes 'Missing STUDIO_BRAIN_ID_TOKEN.'
  } else {
    $result = Invoke-CapturedProcess -FilePath 'node' -Arguments @('scripts/run-studio-os-v3-staging-drills.mjs')
    $artifact = Parse-ArtifactPath -StdOut $result.stdout
    if ($artifact) {
      $artifacts.Add($artifact)
    }
    $status = if ($result.exitCode -eq 0) { 'success' } else { 'failed' }
    Add-StepResult -Results ([ref]$steps) -Name 'studio-v3-staging-drills' -Status $status -Notes ($artifact ?? 'No artifact path detected.') -Payload $result
  }
} else {
  Add-StepResult -Results ([ref]$steps) -Name 'studio-v3-staging-drills' -Status 'skipped' -Notes 'Not requested.'
}

if ($RunNotificationDrills) {
  $idToken = if ($NotificationIdToken) { $NotificationIdToken } else { [Environment]::GetEnvironmentVariable('NOTIFICATION_ID_TOKEN') }
  $uid = if ($NotificationUid) { $NotificationUid } else { [Environment]::GetEnvironmentVariable('NOTIFICATION_UID') }

  if ([string]::IsNullOrWhiteSpace($idToken) -or [string]::IsNullOrWhiteSpace($uid)) {
    Add-StepResult -Results ([ref]$steps) -Name 'notification-drills' -Status 'skipped' -Notes 'Missing NotificationIdToken/NotificationUid (or env NOTIFICATION_ID_TOKEN/NOTIFICATION_UID).'
  } else {
    $notificationLog = Join-Path $outDirPath "notification-drills-$runId.jsonl"
    $notificationArgs = @(
      'scripts/ps1-run.mjs',
      'scripts/run-notification-drills.ps1',
      '-BaseUrl', $FunctionsBaseUrl,
      '-IdToken', $idToken,
      '-Uid', $uid,
      '-LogFile', $notificationLog,
      '-OutputJson'
    )

    if (-not [string]::IsNullOrWhiteSpace($NotificationAdminToken)) {
      $notificationArgs += @('-AdminToken', $NotificationAdminToken)
    }

    $result = Invoke-CapturedProcess -FilePath 'node' -Arguments $notificationArgs
    if (Test-Path $notificationLog) {
      $artifacts.Add($notificationLog)
    }

    $status = if ($result.exitCode -eq 0) { 'success' } else { 'failed' }
    Add-StepResult -Results ([ref]$steps) -Name 'notification-drills' -Status $status -Notes "Log: $notificationLog" -Payload $result
  }
} else {
  Add-StepResult -Results ([ref]$steps) -Name 'notification-drills' -Status 'skipped' -Notes 'Not requested.'
}

$summary | Add-Member -NotePropertyName finishedAtUtc -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o'))
$summary.steps = $steps

$jsonPath = Join-Path $outDirPath "ops-evidence-summary-$runId.json"
$mdPath = Join-Path $outDirPath "ops-evidence-summary-$runId.md"

$summary | ConvertTo-Json -Depth 10 | Set-Content -Path $jsonPath -Encoding utf8
$md = Build-MarkdownSummary -RunSummary $summary -JsonPath $jsonPath
$md | Set-Content -Path $mdPath -Encoding utf8

$artifacts.Add($jsonPath)
$artifacts.Add($mdPath)

Write-Host "Wrote $jsonPath"
Write-Host "Wrote $mdPath"
Write-Host "Ops evidence autopilot complete."
