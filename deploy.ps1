# MonsoonFire.com — deploy ncsitebuilder via SSH/SCP
$ErrorActionPreference = "Stop"

$Server = "monsggbd@66.29.137.142"
$Port   = 21098

$LocalNc = Join-Path $PSScriptRoot "ncsitebuilder"
if (-not (Test-Path $LocalNc)) {
  throw "Missing folder: $LocalNc"
}

Write-Host "Deploying ncsitebuilder/ to $Server:public_html/ (port $Port)..."
scp -P $Port -r "$LocalNc" "$Server:public_html/"
Write-Host "Done."
