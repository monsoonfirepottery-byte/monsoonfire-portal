# P1 Epic: Daily Repo Security Scanning

## Goal
Run automated daily security checks against the published repository to catch:
- leaked secrets in tracked code/artifacts,
- newly opened GitHub secret-scanning alerts,
- high/critical dependency vulnerabilities.

## Scope Implemented
- Added daily GitHub Actions workflow:
  - `.github/workflows/security-daily-scan.yml`
- Added gitleaks config and allowlist:
  - `.gitleaks.toml`
- Added secret-scanning baseline enforcement script:
  - `scripts/check-secret-scanning-baseline.mjs`
- Added baseline file for current known open alerts:
  - `.github/security/secret-scanning-baseline.json`
- Added ingestion hardening to redact Google API key patterns from fetched HTML:
  - `scripts/fetch-real-estate-public-data.ps1`

## Schedule
- Daily run at `09:20 UTC` via cron.
- Manual run available through `workflow_dispatch`.

## Acceptance Criteria
- Workflow fails when:
  - gitleaks finds a non-allowlisted secret-like token in repository tree.
  - a new open GitHub secret-scanning alert appears outside the baseline.
  - npm audit reports high/critical vulns in root/web/functions/studio-brain.
- Workflow uploads scan artifacts (`output/security/*`) for triage.

## Operating Notes
- When a legacy alert is remediated/resolved, remove it from `.github/security/secret-scanning-baseline.json`.
- If a new alert is legitimate, rotate/revoke the credential first, then update code.
- Do not add broad allowlists; keep allowlist entries narrow and explain why.
