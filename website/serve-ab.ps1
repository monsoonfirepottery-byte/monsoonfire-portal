param(
  [int] $Port = 8000,
  [string] $Host = "127.0.0.1",
  [string] $Root = "",
  [string] $VariantRoot = "ab",
  [int] $CookieDays = 30
)

Write-Warning "Compatibility shim only. Use Node command by default:"

$ServeRoot = if ($Root) { $Root } else { $PSScriptRoot }
Write-Warning "node ./website/scripts/serve-ab.mjs --root `"$ServeRoot`" --port $Port --host $Host --variant-root $VariantRoot --cookie-days $CookieDays"

$script = Join-Path $PSScriptRoot "scripts/serve-ab.mjs"
$arguments = @("--root", $ServeRoot, "--port", $Port, "--host", $Host, "--variant-root", $VariantRoot, "--cookie-days", $CookieDays)
node $script @arguments
