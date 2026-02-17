param(
  [string]$PortalUrl = "https://portal.monsoonfire.com",
  [string]$ProjectId = "monsoonfire-portal",
  [string]$ChecklistOut = "docs/EXTERNAL_CUTOVER_EXECUTION.md",
  [string]$CutoverReportPath = "docs/cutover-verify.json",
  [switch]$SkipVerifier
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Text)
  Write-Host "[ ] $Text"
}

function Ensure-PathExists {
  param([string]$PathValue)
  if (-not (Test-Path $PathValue)) {
    throw "Required file not found: $PathValue"
  }
}

function Resolve-HostAvailable {
  param([string]$Url)
  try {
    $uri = [Uri]$Url
    Resolve-DnsName -Name $uri.Host -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  }
}

$utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$operator = if ($env:USERNAME) { $env:USERNAME } else { "unknown" }

Ensure-PathExists "docs/PROD_AUTH_PROVIDER_EXECUTION.md"
Ensure-PathExists "web/deploy/namecheap/verify-cutover.ps1"
Ensure-PathExists "scripts/new-auth-provider-run-entry.ps1"
Ensure-PathExists "scripts/new-drill-log-entry.ps1"
Ensure-PathExists "scripts/run-notification-drills.ps1"

$hostAvailable = Resolve-HostAvailable -Url $PortalUrl

$summary = @(
  '# External Cutover Execution Checklist',
  '',
  ('Generated at: {0}  ' -f $utc),
  ('Operator: {0}  ' -f $operator),
  ('Portal URL: {0}  ' -f $PortalUrl),
  ('Firebase project: {0}' -f $ProjectId),
  '',
  '## 1) DNS + hosting cutover',
  '- [ ] DNS A/CNAME for portal host points to target hosting',
  '- [ ] TLS/HTTPS valid and HTTP -> HTTPS redirect active',
  '- [ ] Upload latest `web/dist` build + Namecheap `.htaccess`',
  '- [ ] Confirm `.well-known` files exist when needed',
  '',
  'Run verifier:',
  '```powershell',
  ('pwsh web/deploy/namecheap/verify-cutover.ps1 -PortalUrl "{0}" -ReportPath "{1}"' -f $PortalUrl, $CutoverReportPath),
  '```',
  '',
  '## 2) Firebase Auth baseline',
  '- [ ] Firebase Console -> Authentication -> Settings -> Authorized domains include:',
  '  - `portal.monsoonfire.com`',
  '  - `monsoonfire.com`',
  '  - `www.monsoonfire.com`',
  '  - `localhost`',
  '  - `127.0.0.1`',
  '- [ ] Firebase sign-in methods enabled: Google, Email/Password, Email Link',
  '',
  '## 3) OAuth provider credentials (external consoles)',
  '- [ ] Apple configured in Firebase (Service ID + key)',
  '- [ ] Facebook configured in Firebase (App ID + secret)',
  '- [ ] Microsoft configured in Firebase (App ID + secret)',
  '- [ ] Redirect URIs copied from Firebase provider panels exactly',
  '',
  'Log entry helper:',
  '```powershell',
  ('pwsh scripts/new-auth-provider-run-entry.ps1 -OutFile docs/PROD_AUTH_PROVIDER_RUN_LOG.md -PortalUrl "{0}"' -f $PortalUrl),
  '```',
  '',
  '## 4) Hosted auth verification',
  '- [ ] Google sign-in succeeds on hosted portal',
  '- [ ] Apple sign-in succeeds on hosted portal',
  '- [ ] Facebook sign-in succeeds on hosted portal',
  '- [ ] Microsoft sign-in succeeds on hosted portal',
  '- [ ] No `auth/unauthorized-domain` errors',
  '- [ ] Popup blocked fallback works',
  '',
  '## 5) Notification drill execution (prod token required)',
  '- [ ] Append run template:',
  '```powershell',
  'pwsh scripts/new-drill-log-entry.ps1 -Uid "<REAL_UID>"',
  '```',
  '- [ ] Run drills:',
  '```powershell',
  ('pwsh scripts/run-notification-drills.ps1 -BaseUrl "https://us-central1-{0}.cloudfunctions.net" -IdToken "<REAL_ID_TOKEN>" -Uid "<REAL_UID>" -OutputJson -LogFile "docs/drill-runs.jsonl"' -f $ProjectId),
  '```',
  '- [ ] Verify Firestore evidence collections and update `docs/DRILL_EXECUTION_LOG.md`',
  '',
  '## 6) Final evidence handoff',
  '- [ ] Attach cutover verifier JSON report',
  '- [ ] Attach provider run log entry',
  '- [ ] Attach drill summary/log output',
  '- [ ] Mark tickets complete:',
  '  - `tickets/P0-portal-hosting-cutover.md`',
  '  - `tickets/P1-prod-auth-oauth-provider-credentials.md`',
  '  - `tickets/P0-alpha-drills-real-auth.md`'
) -join "`n"

Set-Content -Path $ChecklistOut -Value $summary
Write-Host "Wrote checklist: $ChecklistOut"

if ($SkipVerifier) {
  Write-Host "Skipping verifier (explicit)."
} elseif (-not $hostAvailable) {
  Write-Warning "DNS for portal host is not resolvable yet. Skipping verify-cutover run."
  Write-Warning "Run after DNS propagates:"
  Write-Host "pwsh web/deploy/namecheap/verify-cutover.ps1 -PortalUrl `"$PortalUrl`" -ReportPath `"$CutoverReportPath`""
} else {
  Write-Host "Portal host resolves. Running cutover verifier..."
  & pwsh "web/deploy/namecheap/verify-cutover.ps1" -PortalUrl $PortalUrl -ReportPath $CutoverReportPath
}

Write-Host ""
Write-Host "Next actions:"
Write-Step "Open docs/PROD_AUTH_PROVIDER_EXECUTION.md and execute provider console steps."
Write-Step "Append provider run log with scripts/new-auth-provider-run-entry.ps1."
Write-Step "Run notification drills with real staff token and capture evidence."
