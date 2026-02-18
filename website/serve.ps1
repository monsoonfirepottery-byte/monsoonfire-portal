param(
  [int] $Port = 8000,
  [string] $Host = "127.0.0.1"
)

Write-Warning "Legacy PowerShell wrapper: use Node equivalent when possible."
Write-Warning "node ./website/scripts/serve.mjs --port $Port --host $Host"

$script = Join-Path $PSScriptRoot "scripts/serve.mjs"
node $script --port $Port --host $Host
