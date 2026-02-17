param(
  [string] $Only = "firestore,functions,auth",
  [string] $Project = "monsoonfire-portal",
  [string] $Config = "firebase.json"
)

$envFile = Join-Path $PSScriptRoot "..\functions\.env.local"
$envFile = [System.IO.Path]::GetFullPath($envFile)

if (Test-Path $envFile) {
  Write-Host "Loading local env from $envFile"
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $parts = $line.Split("=", 2)
    if ($parts.Count -ne 2) { return }
    $key = $parts[0].Trim()
    $value = $parts[1]
    [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
} else {
  Write-Host "No functions/.env.local found. Starting emulators with current process env only."
}

Write-Host "Starting Firebase emulators ($Only) for project $Project..."
firebase emulators:start --config $Config --project $Project --only $Only
