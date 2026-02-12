param(
  [string]$HeadSha = "",
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if (-not $HeadSha) {
  $HeadSha = (git rev-parse HEAD).Trim()
}

$runs = gh run list --limit 50 --json databaseId,headSha,workflowName,status,conclusion,url | ConvertFrom-Json
$targetRuns = $runs | Where-Object { $_.headSha -eq $HeadSha }

$requiredWorkflows = @(
  "Smoke Tests",
  "Lighthouse Audit",
  "iOS macOS Smoke",
  "ios-build-gate",
  "Android Compile Check",
  "Deploy to Firebase Hosting on PR"
)

$result = @()
foreach ($wf in $requiredWorkflows) {
  $match = $targetRuns | Where-Object { $_.workflowName -eq $wf } | Select-Object -First 1
  if ($null -eq $match) {
    $result += [pscustomobject]@{
      workflow = $wf
      status = "missing"
      ok = $false
      url = ""
    }
    continue
  }

  $ok = ($match.status -eq "completed" -and $match.conclusion -eq "success")
  $result += [pscustomobject]@{
    workflow = $wf
    status = "$($match.status)/$($match.conclusion)"
    ok = $ok
    url = $match.url
  }
}

$overallOk = -not ($result | Where-Object { -not $_.ok })

if ($Json) {
  [pscustomobject]@{
    headSha = $HeadSha
    ok = $overallOk
    checks = $result
  } | ConvertTo-Json -Depth 5
  exit 0
}

Write-Host "Alpha preflight for $HeadSha"
foreach ($row in $result) {
  $icon = if ($row.ok) { "[ok]" } else { "[!!]" }
  Write-Host "$icon $($row.workflow): $($row.status)"
  if ($row.url) {
    Write-Host "     $($row.url)"
  }
}

if ($overallOk) {
  Write-Host "Preflight checks are green for this commit."
} else {
  Write-Warning "Some required workflows are missing or not green."
}
