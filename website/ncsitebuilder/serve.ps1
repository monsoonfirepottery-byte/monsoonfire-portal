param(
  [int] $Port = 8000,
  [string] $Host = "127.0.0.1",
  [string] $Root = ""
)

Write-Warning "Compatibility shim only. Use Node command by default:"
Write-Warning "node ./website/ncsitebuilder/scripts/serve.mjs --port $Port --host $Host" + $(if($Root){ " --root $Root" } else { "" })

$script = Join-Path $PSScriptRoot "scripts/serve.mjs"
$arguments = @("--port", $Port, "--host", $Host)
if ($Root) {
  $arguments += @("--root", $Root)
}
node $script @arguments
