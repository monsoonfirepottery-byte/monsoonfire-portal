# MonsoonFire.com — deploy ncsitebuilder via SSH/SCP
$ErrorActionPreference = "Stop"

$Server = "monsggbd@66.29.137.142"
$Port   = 21098
$RemotePath = "public_html/"

$LocalNc = Join-Path $PSScriptRoot "ncsitebuilder"
if (-not (Test-Path $LocalNc)) {
  throw "Missing folder: $LocalNc"
}

Write-Host "Deploying ncsitebuilder/ to ${Server}:$RemotePath (port $Port)..."
scp -P $Port -r "$LocalNc" "${Server}:$RemotePath"
Write-Host "Promoting ncsitebuilder/ into live public_html/..."
ssh -p $Port $Server "cd public_html && cp -a ncsitebuilder/. ."
Write-Host "Done."
