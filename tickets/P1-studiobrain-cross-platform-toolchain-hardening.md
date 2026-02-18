# P1 — Cross-Platform Developer Toolchain for Studiobrain Workflows

Status: In Progress
Date: 2026-02-18
Priority: P1
Owner: Platform + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Some core onboarding flows still depend on PowerShell-first execution in practice, which slows or blocks Linux/macOS workflow parity for studiobrain-native work.

## Objective

Make Node-first command execution the normative path for all required portal/functions/studio-brain operations, with optional compatibility shims only.

## Scope

- `package.json` scripts
- `scripts/start-emulators.mjs`
- `scripts/pr-gate.mjs`
- `scripts/studiobrain-status.mjs`
- `website/scripts/deploy.mjs`
- `website/scripts/serve.mjs`
- `website/ncsitebuilder/scripts/serve.mjs`
- `.github/workflows/*` smoke/CI entrypoints (where script commands are surfaced)
- `AGENTS.md`

## Tasks

1. Audit every required cutover dependency and ensure each has a Node/batch-neutral entrypoint:
   - emulators
   - smoke
   - status checks
   - website deploy/serve
2. Mark PowerShell files as compatibility-only and remove them from "primary" docs.
3. Add one canonical command matrix (`docs/runbooks/*`) that avoids OS-prefixed instructions.
4. Add a preflight check that exits early when required Node entrypoints are missing.
5. Ensure smoke and launch commands tolerate environments without PowerShell installed.

## Acceptance Criteria

1. Mainline onboarding on Linux/macOS completes with no required PowerShell dependency.
2. All required commands appear with Node-first forms in runbooks and onboarding docs.
3. Compatibility shims remain available but never required by the P1 cutover path.

## Dependencies

- `website/deploy.ps1`
- `website/serve.ps1`
- `website/ncsitebuilder/serve.ps1`
- `scripts/start-emulators.ps1`
- `AGENTS.md`

## Definition of Done

- Cross-platform command list is documented and verified as first-class.
- Legacy commands are explicitly labeled as compatibility-only.
- Core cutover runs can be executed from Linux/macOS with no PowerShell path dependency.
