# Ralph Loop — Platform Reference Audit (Windows / PowerShell / wuff-laptop)

Scope: docs, tickets, scripts, website, web, functions, studio-brain
Date: 2026-02-18

## Scan command used

- `node ./scripts/ralph-platform-reference-audit.mjs --json --strict --skip-tickets --max-actionable 0`
- Alias: `npm run audit:platform:refs:strict`

## Snapshot results

- Scanned files: **531**
- Windows/PowerShell/wuff-laptop marker findings: **0**
- Actionable windows references: **0**
- Wuff-laptop findings: **0**
- .ps1 files found: **44**
- .ps1 compatibility shims: **9**
- .ps1 review candidates: **35**
- Exempted findings (non-blocking): **0**

## Current gate status

- PR gate strict mode result: **PASS** (maxActionable = 0)
- Remaining platform-marker hits are currently zero under strict + skip-tickets configuration.

## Exemptions in force

- Exemptions file: `scripts/ralph-platform-reference-exemptions.json`

## Top actionable findings after exemptions

- None
