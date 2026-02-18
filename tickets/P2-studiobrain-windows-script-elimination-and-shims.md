# P2 — Windows Script Elimination and Compatibility Shim Cleanup

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Windows-only script paths and assumptions increase maintenance cost and reduce reproducibility on Studiobrain's Linux/macOS-centric environment.

## Objective

Replace platform-specific scripts with cross-platform equivalents and keep only minimal shims for environments where they are unavoidable.

## Scope

- `website/deploy.ps1`
- `website/serve.ps1`
- `website/ncsitebuilder/serve.ps1`
- `scripts/*` command surface
- `AGENTS.md`

## Tasks

1. Map all existing `.ps1` flow entries and identify pure replacements.
2. Implement equivalent Node/bash utilities:
   - deployment flows
   - serve/preview flows
   - environment bootstrap flows
3. Deprecate direct `.ps1` usage in runbooks and scripts.
4. Keep compatibility shims only for backward compatibility with explicit warning output.
5. Add migration note:
   - recommended Linux/macOS commands
   - removal sunset window

## Acceptance Criteria

1. Mainline developer path runs without PowerShell scripts.
2. Any remaining `.ps1` use is documented as compatibility-only and not required for core flows.
3. Command parity is maintained across replaced script paths.
4. Onboarding docs are updated to remove PowerShell-first assumptions.

## Dependencies

- `scripts/cutover-watchdog.mjs`
- `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`
- `AGENTS.md`

## Definition of Done

- The project no longer relies on Windows tooling for routine operations.
- Compatibility shims are explicitly constrained and temporary.
