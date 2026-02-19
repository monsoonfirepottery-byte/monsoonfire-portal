# P2 — Studio Brain Platform Reference Automation and Exemption Governance

Status: In Progress
Date: 2026-02-18
Priority: P2
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

There is no consistent enforcement loop for non-essential Windows/PowerShell/wuff-laptop references, and cleanup work is hard to track consistently across docs and scripts.

## Objective

Turn the platform-reference audit into a repeatable workflow that surfaces drift, supports intentional exemptions, and links directly to P2 cleanup tickets.

## Scope

- `scripts/ralph-platform-reference-audit.mjs`
- `scripts/pr-gate.mjs`
- `package.json`
- `tickets/P2-studiobrain-remove-nonessential-ps1-windows-wuff-references.md`
- `scripts/ralph-platform-reference-exemptions.json` (to capture intentional exceptions)

## Tasks

1. Add strict-mode scan command for CI/PR visibility:
   - `npm run audit:platform:refs:strict` ✅
2. Update PR gate to include platform-reference drift check with clear remediation path.
   - Wired into `scripts/pr-gate.mjs` as required step with `--strict` and ticket-scope skip.
3. Add an explicit exemption file with owner/reason entries for non-actionable legacy references.
   - Added `scripts/ralph-platform-reference-exemptions.json` with owner/reason records.
4. Reduce explicit nested PowerShell dependence in core non-essential orchestration.
   - Updated `scripts/run-ops-evidence-autopilot.ps1` to call notification drills through `scripts/ps1-run.mjs` instead of `pwsh`.
5. Use scan output to create/update concrete cleanup tickets in a small queue file or comments.
   - Outstanding non-essential hits are tracked under `tickets/P2-studiobrain-remove-nonessential-ps1-windows-wuff-references.md`.
6. Track and lower the non-essential reference threshold in milestones until zero for standard paths.
   - PR gate uses a zero-baseline threshold for non-ticket actionable platform markers (`--max-actionable 0`).

## Acceptance Criteria

1. `npm run audit:platform:refs` reports actionable findings with file/line and category.
2. `npm run audit:platform:refs:strict` can be executed by PR gate and surfaces a single actionable status.
3. Exemption entries are explicit (`file`, `owner`, `reason`, optional `expiresAt`) and reviewed at least weekly.
4. PR gate output includes the audit result for every merge candidate.
5. Outstanding non-essential markers are converted into follow-up P2 tickets in this epic.

## Definition of Done

- Automation is in place and documented.
- Remediation workflow is no longer ad-hoc.
- Non-essential Windows/wuff references are either removed or deliberately justified.
