$ErrorActionPreference = "Stop"

Write-Host "Monsoon Fire Portal - Smoke Tests" -ForegroundColor Cyan

Write-Host "`n[1/3] Web unit tests (vitest run)" -ForegroundColor Yellow
npm --prefix web run test:run

Write-Host "`n[2/3] Web build" -ForegroundColor Yellow
npm --prefix web run build

Write-Host "`n[3/3] Functions build" -ForegroundColor Yellow
npm --prefix functions run build

Write-Host "`nSmoke tests complete." -ForegroundColor Green
