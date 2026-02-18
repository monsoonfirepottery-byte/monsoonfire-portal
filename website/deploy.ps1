param(
  [string] $Server = "",
  [int] $Port = 0,
  [string] $RemotePath = ""
)

Write-Warning "Legacy PowerShell wrapper: use Node equivalent when possible."
$ResolvedServer = if ($Server) { $Server } elseif ($env:WEBSITE_DEPLOY_SERVER) { $env:WEBSITE_DEPLOY_SERVER } else { "monsggbd@66.29.137.142" }
$ResolvedPort = if ($Port -gt 0) { $Port } elseif ($env:WEBSITE_DEPLOY_PORT) { [int] $env:WEBSITE_DEPLOY_PORT } else { 21098 }
$ResolvedRemotePath = if ($RemotePath) { $RemotePath } elseif ($env:WEBSITE_DEPLOY_REMOTE_PATH) { $env:WEBSITE_DEPLOY_REMOTE_PATH } else { "public_html/" }

Write-Warning "node ./website/scripts/deploy.mjs --server $ResolvedServer --port $ResolvedPort --remote-path $ResolvedRemotePath"

$script = Join-Path $PSScriptRoot "scripts/deploy.mjs"
node $script --server $ResolvedServer --port $ResolvedPort --remote-path $ResolvedRemotePath
