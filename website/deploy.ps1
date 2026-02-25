param(
  [string] $Server = "",
  [int] $Port = 0,
  [string] $RemotePath = "",
  [string] $Key = ""
)

Write-Warning "Compatibility shim only: mainline workflow is Node."
Write-Warning "node ./website/scripts/deploy.mjs --server <server> --port <port> --key <private-key-path> --remote-path <path>"

$ResolvedServer = if ($Server) {
  $Server
} elseif ($env:WEBSITE_DEPLOY_SERVER) {
  $env:WEBSITE_DEPLOY_SERVER
} else {
  ""
}

$ResolvedPort = if ($Port -gt 0) {
  $Port
} elseif ($env:WEBSITE_DEPLOY_PORT) {
  [int] $env:WEBSITE_DEPLOY_PORT
} else {
  21098
}

$ResolvedRemotePath = if ($RemotePath) {
  $RemotePath
} elseif ($env:WEBSITE_DEPLOY_REMOTE_PATH) {
  $env:WEBSITE_DEPLOY_REMOTE_PATH
} else {
  "public_html/"
}

$ResolvedKey = if ($Key) {
  $Key
} elseif ($env:WEBSITE_DEPLOY_KEY) {
  $env:WEBSITE_DEPLOY_KEY
} else {
  ""
}

if (-not $ResolvedServer) {
  Write-Error "Missing deploy server. Set --server or WEBSITE_DEPLOY_SERVER."
  Exit 1
}

if ($ResolvedKey) {
  Write-Warning "node ./website/scripts/deploy.mjs --server $ResolvedServer --port $ResolvedPort --key $ResolvedKey --remote-path $ResolvedRemotePath"
} else {
  Write-Warning "node ./website/scripts/deploy.mjs --server $ResolvedServer --port $ResolvedPort --remote-path $ResolvedRemotePath"
}

$script = Join-Path $PSScriptRoot "scripts/deploy.mjs"
if ($ResolvedKey) {
  node $script --server $ResolvedServer --port $ResolvedPort --key $ResolvedKey --remote-path $ResolvedRemotePath
} else {
  node $script --server $ResolvedServer --port $ResolvedPort --remote-path $ResolvedRemotePath
}
