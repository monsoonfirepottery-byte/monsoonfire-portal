param(
  [string] $Only = "firestore,functions,auth",
  [string] $Project = "monsoonfire-portal",
  [string] $Config = "firebase.json",
  [string] $Host = "",
  [string] $NetworkProfile = ""
)

Write-Warning "Compatibility shim only; primary workflow is Node."
Write-Warning "node ./scripts/start-emulators.mjs --only $Only --project $Project --config $Config $(if ($NetworkProfile) { '--network-profile ' + $NetworkProfile }) $(if ($Host) { '--host ' + $Host })"

$script = Join-Path $PSScriptRoot "start-emulators.mjs"
$arguments = @("--only", $Only, "--project", $Project, "--config", $Config)
if ($Host) {
  $arguments += @("--host", $Host)
}
if ($NetworkProfile) {
  $arguments += @("--network-profile", $NetworkProfile)
}

node $script @arguments
