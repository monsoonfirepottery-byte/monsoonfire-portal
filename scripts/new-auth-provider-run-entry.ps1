param(
  [string]$OutFile = "docs/PROD_AUTH_PROVIDER_RUN_LOG.md",
  [string]$PortalUrl = "https://portal.monsoonfire.com",
  [string]$ProjectId = "monsoonfire-portal",
  [string]$ExecutedBy = ""
)

$ErrorActionPreference = "Stop"

if (-not $ExecutedBy) {
  $ExecutedBy = $env:USERNAME
}

$dateUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$entry = @"

---

## Provider auth run
```txt
dateUtc: $dateUtc
executedBy: $ExecutedBy
projectId: $ProjectId
portalUrl: $PortalUrl
```

### Authorized domains check
- [ ] portal.monsoonfire.com
- [ ] monsoonfire.com
- [ ] www.monsoonfire.com
- [ ] localhost
- [ ] 127.0.0.1

### Provider setup + sign-in verification
| Provider | Config completed | Sign-in pass | Notes |
|---|---|---|---|
| Google |  |  |  |
| Apple |  |  |  |
| Facebook |  |  |  |
| Microsoft |  |  |  |

### Issues / remediation
- 
 
### Evidence links
- screenshot(s):
- console notes:
 
"@

if (-not (Test-Path $OutFile)) {
  @"
# Production Auth Provider Run Log

Use this log to capture each execution pass for `tickets/P1-prod-auth-oauth-provider-credentials.md`.

Do not paste secrets or client secret values into this file.
"@ | Set-Content -Path $OutFile
}

Add-Content -Path $OutFile -Value $entry
Write-Host "Appended provider auth run template to $OutFile"
