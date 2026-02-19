param(
  [string]$PortalUrl = "https://portal.monsoonfire.com",
  [string]$ProjectId = "monsoonfire-portal",
  [string]$ChecklistOut = "docs/EXTERNAL_CUTOVER_EXECUTION.md",
  [string]$CutoverReportPath = "docs/cutover-verify.json",
  [switch]$SkipVerifier
)

# Compatibility shim for non-primary shell-first environments.
# Primary path is scripts/run-external-cutover-checklist.mjs.

$ErrorActionPreference = "Stop"

$nodeArgs = @(
  "--portal-url", $PortalUrl,
  "--project-id", $ProjectId,
  "--checklist-out", $ChecklistOut,
  "--cutover-report-path", $CutoverReportPath
)

if ($SkipVerifier) {
  $nodeArgs += "--skip-verifier"
}

& node (Join-Path $PSScriptRoot "run-external-cutover-checklist.mjs") @nodeArgs

if ($LASTEXITCODE -ne 0) {
  throw "Primary node script failed with exit code $LASTEXITCODE."
}
