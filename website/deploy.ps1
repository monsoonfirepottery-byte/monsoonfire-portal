param(
  [string] $Server = "monsggbd@66.29.137.142",
  [int] $Port = 21098,
  [string] $RemotePath = "public_html/"
)

Write-Warning "Legacy PowerShell wrapper: use Node equivalent when possible."
Write-Warning "node ./website/scripts/deploy.mjs --server $Server --port $Port --remote-path $RemotePath"

$script = Join-Path $PSScriptRoot "scripts/deploy.mjs"
node $script --server $Server --port $Port --remote-path $RemotePath
