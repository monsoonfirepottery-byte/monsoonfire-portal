# P2 — Cross-Platform Script Replacements for Studiobrain Cutover

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Multiple workflow entrypoints still rely on PowerShell as the primary path, which blocks clean Linux/macOS usage and increases onboarding friction on Studiobrain.

## Objective

Migrate launch/deploy/smoke entrypoints to Node-first, cross-platform wrappers while keeping PowerShell paths optional and documented as legacy compatibility.

## Scope

- `scripts/start-emulators.mjs`
- `scripts/start-emulators.ps1`
- `website/deploy.ps1`
- `website/serve.ps1`
- `website/ncsitebuilder/serve.ps1`
- `scripts/website-playwright-smoke.mjs`
- `scripts/portal-playwright-smoke.mjs`
- `scripts/test-studio-brain-auth.mjs`

## Tasks

1. Add/confirm Node-first orchestrators for:
   - emulator startup
   - studio-brain bootstrap
   - website local preview + deploy
   - smoke orchestration
2. Replace any script default behavior that depends on `$env:` naming or PowerShell-only syntax.
3. Convert website deploy/serve flows to cross-platform Node/Bash wrappers with environment-driven arguments.
4. Keep PowerShell files as compatibility shims that delegate to Node scripts.
5. Update `AGENTS.md`, `docs/runbooks/*`, and `package.json` script docs to show primary non-Windows paths.
6. Add a migration note per command in the cutover runbook listing:
   - canonical command
   - equivalent legacy command (if retained)
   - required env vars

## Acceptance Criteria

1. A clean Linux/macOS Studiobrain environment can execute the full local startup + smoke flow without PowerShell dependency.
2. PowerShell entrypoints are optional shims with no hidden mandatory behavior.
3. All platform-specific scripts are documented as optional and not used by default in onboarding.
4. If both paths remain, they resolve to identical env contracts and host contracts.

## Dependencies

- `package.json`
- `scripts/start-emulators.mjs`
- `website/deploy.ps1`
- `website/serve.ps1`
- `website/ncsitebuilder/serve.ps1`
- `scripts/website-playwright-smoke.mjs`
- `scripts/portal-playwright-smoke.mjs`

## Definition of Done

- Core commands have documented primary paths on Node and optional PowerShell delegates.
- Team can execute all mandatory smoke/onboarding workflows from Linux/macOS without manual command translation.
- No new script behavior depends on Windows-only defaults.

