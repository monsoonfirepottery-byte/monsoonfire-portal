param(
  [string] $Mode = "once",
  [int] $IntervalMs = 60000,
  [int] $Iterations = 0,
  [switch] $IncludePreflight,
  [switch] $IncludeSmoke,
  [string] $ArtifactDir = "output/stability"
)

Write-Warning "Compatibility shim only: prefer Node command."
Write-Warning "node ./scripts/cutover-watchdog.mjs (or npm run cutover-watchdog...)"

$arguments = @()
if ($Mode -ieq "watch") {
  $arguments += @("watch")
} else {
  $arguments += @("once")
}

$arguments += @("--artifact-dir", $ArtifactDir)
$arguments += @("--interval-ms", $IntervalMs)

if ($Iterations -gt 0) {
  $arguments += @("--iterations", $Iterations)
}

if ($IncludePreflight) {
  $arguments += @("--include-preflight")
}
if ($IncludeSmoke) {
  $arguments += @("--include-smoke")
}

node (Join-Path $PSScriptRoot "cutover-watchdog.mjs") @arguments
