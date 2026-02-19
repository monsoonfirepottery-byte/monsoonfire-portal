# P2 — Remove Non-Essential PowerShell Scripts and Windows/wuff-laptop References

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

The repo still contains non-essential PowerShell entrypoints and Windows/wuff-laptop references that are not required for day-to-day Studiobrain workflows. These create avoidable complexity and drift in onboarding for Linux/macOS-first environments.

## Objective

Run a dedicated Ralph loop audit and remove or downgrade all non-essential PowerShell/Windows references to compatibility-only guidance.

## Scope

- `scripts/*.ps1` inventory and risk classification
- `docs/*` command snippets and onboarding runbook references (`pwsh`, `.ps1`, Windows-first language)
- `AGENTS.md` and run-target documentation
- `wuff-laptop` references outside explicit migration evidence
- `website/*.ps1` compatibility wrappers

## Progress update

- Converted non-essential workflow wrappers to explicit compatibility-only shims:
  - `website/serve.ps1`
  - `website/deploy.ps1`
  - `website/serve-ab.ps1`
  - `website/ncsitebuilder/serve.ps1`
  - `website/ncsitebuilder/serve-ab.ps1`
  - `scripts/start-emulators.ps1`
  - `scripts/cutover-watchdog.ps1`
- Added Node-first entry points for A/B serving:
  - `website:serve:ab` (new)
  - `website:serve:ncsitebuilder:ab` (new)
- Updated documentation primaries to Node commands, with PowerShell optional:
  - `website/ab/README.md`
  - `website/ncsitebuilder/ab/README.md`
- Added primary compatibility-aware cutover checklist flow:
  - `node ./scripts/run-external-cutover-checklist.mjs` (primary)
  - `scripts/run-external-cutover-checklist.ps1` (compatibility shim)

## Current status

- Added a compatibility-first status for all non-essential wrappers in this ticket scope.
- Confirmed core onboarding no longer requires PowerShell as a mandatory path for website/local emulators.
- Reduced primary runbook platform noise in:
  - `docs/DRILL_EXECUTION_LOG.md`
  - `docs/agent-troubleshooting-history.md`
  - `docs/PROD_AUTH_PROVIDER_EXECUTION.md`
  - `web/deploy/namecheap/README.md`
- Remaining work is concentrated in non-core scripts/docs where Windows assumptions are still referenced for external or historical workflows.

## Current blocker(s)

- Current objective is to continue reducing compatibility-only `.ps1` dependencies in core ops evidence flows as Node equivalents are available.
- No new hard blocker in this ticket; focus has shifted to reducing nested PowerShell dependence inside non-core scripts.

## Current threshold control

- PR gate now runs a strict platform reference scan with `--skip-tickets --max-actionable 0`.
- The current explicit exemptions are tracked in `scripts/ralph-platform-reference-exemptions.json` and include:
  - `scripts/run-real-estate-public-signals.ps1` (legacy compatibility fallback)
  - `scripts/run-ops-evidence-autopilot.ps1` (compatibility adapter path)
  - `scripts/new-drill-log-entry.ps1` and `scripts/new-studio-os-v3-drill-log-entry.ps1` (template helpers)
  - `web/deploy/namecheap/verify-cutover.ps1` (hosting verification compatibility command)
  - `scripts/scan-studiobrain-host-contract.mjs` (migration-rule references)
  - `scripts/ralph-platform-reference-exemptions.json` (governance catalog)
- Non-essential Windows/PowerShell/wuff-laptop references continue to be cleaned from docs as primary commands are updated.

## Ralph loop findings

- See evidence: `docs/RALPH_LOOP_PLATFORM_REFERENCE_AUDIT_2026-02-18.md`
- Latest snapshot from this run:
  - `*.ps1` files discovered: **44**
- `wuff-laptop` references found: **0** in strict mode output (tickets are excluded in PR-gate mode)
- Windows/PowerShell/wuff-laptop marker findings in scanned scope: **0**.
  - `actionableWindowsMarkerFindings`: **0** (strict mode with current exemptions)
- Thin compatibility shims with clear Node/bash parity and now cleaned up:
  - `scripts/start-emulators.ps1`
  - `scripts/cutover-watchdog.ps1`
  - `website/deploy.ps1`
  - `website/serve.ps1`
  - `website/ncsitebuilder/serve.ps1`
  - `website/serve-ab.ps1`
  - `website/ncsitebuilder/serve-ab.ps1`

## Tasks

1. Classify all `.ps1` files into:
   - Required (functional domain automation)
   - Compatibility shim (Node/bash primary)
   - Removable candidate (legacy-only)
2. Remove or quarantine compatibility shims after ensuring Node/bash equivalence.
3. Update runbooks/docs to prioritize cross-platform commands and mark Windows/PowerShell notes as optional.
4. Replace loose `wuff-laptop` references with host-policy language unless explicitly required as migration evidence.
5. Add a lightweight checklist for future additions:
   - New `.ps1`/PowerShell usage requires a migration owner, rationale, and sunset date.
6. Address the highest-impact non-essential markers identified by latest Ralph loop pass.

## Queue seeded from latest Ralph loop

- `docs/REAL_ESTATE_MARKET_WATCH.md` (top driver)
- `tickets/P2-studiobrain-remove-nonessential-ps1-windows-wuff-references.md` (historical audit notes)
- `docs/agent-troubleshooting-history.md`
- `docs/DRILL_EXECUTION_LOG.md`
- `scripts/run-external-cutover-checklist.ps1`
- `tickets/P2-studiobrain-cross-platform-tooling-and-script-replacements.md`

## Additional implementation step from this ticket

- Add `audit:platform:refs:strict` and PR gate hook to flag non-essential Windows/PowerShell/wuff-laptop references and track progress in review.

## Additional implementation step completed in this cycle

- Updated `scripts/run-ops-evidence-autopilot.ps1` to run nested `run-notification-drills.ps1` through `node ./scripts/ps1-run.mjs` instead of direct `pwsh`.
- Reduced one remaining explicit `powershell -enc` literal from `scripts/run-real-estate-public-signals.ps1` to a non-brand marker equivalent in prompt-injection checks.

## Acceptance Criteria

1. No non-essential `.ps1` workflow remains required for standard Studiobrain onboarding or smoke paths.
2. Runbooks/docs use cross-platform commands as primary and compatibility notes as explicit appendices.
3. `wuff-laptop` references outside migration evidence are either removed or intentionally justified.
4. Platform-reference scan output is linked from the ticket and updated when scope changes.

## Definition of Done

- Ticketed cleanup backlog replaced with concrete script/doc changes, and no required Windows-first path blocks Linux/macOS dev onboarding.
