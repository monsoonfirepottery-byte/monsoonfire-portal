$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root ".venv-cad\Scripts\python.exe"

if (-not (Test-Path $python)) {
  Write-Error "Missing local CAD environment at $python"
  exit 1
}

& $python -m jupyter lab
