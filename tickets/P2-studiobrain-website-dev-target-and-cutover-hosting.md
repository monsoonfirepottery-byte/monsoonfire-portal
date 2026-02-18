# P2 — Website Development Target and Cutover Hosting for Studiobrain Workflow

Status: In Progress
Date: 2026-02-18
Priority: P2
Owner: Platform + Website
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem
Marketing website delivery is currently bound to manual, machine-specific deployment behavior, which is fragile and not stable for repeatable workstation setup.

## Objective
Create a stable website development/deploy target model that works from any workstation and aligns with the new studiobrain-first cutover process.

## Scope
- `website/deploy.ps1` and server target configuration.
- Website local serving and smoke test flow (`website/serve*.ps1`, `scripts/website-playwright-smoke.mjs`).
- Separation of environment secrets from executable scripts.
- Dedicated development/verification target definitions for website publishing.
- LAN and host-identity strategy for studio machine deploy target (studiobrain host may move on DHCP).

## Tasks
1. Define a local config model for website deploy target and credentials (e.g. `.env`/secret-backed variables), removing hard-coded host and port.
2. Add a Node-based deployment helper (or portable wrapper) that accepts target, source path, and remote directory from env and uses cross-platform SSH/SCP when available.
3. Define a canonical website dev target (e.g. staging subfolder/preview host) distinct from production root.
4. Add or update smoke checks to verify both local and target-hosted website delivery.
5. Document approval-ready runbook for website-target cutover in cutover epic context.
6. Add a machine-stability note so the target host uses a hostname alias (for example `studiobrain.local`) plus optional static LAN fallback so target writes do not depend on ephemeral DHCP hostnames.

## Acceptance Criteria
1. No website deployment script relies on hard-coded SSH credentials or ports.
2. A developer can run a documented command to deploy to a non-production website target with the same environment constraints as portal cutover.
3. Local website smoke and remote website smoke checks pass against stable target definitions.
4. Evidence shows staging/development target can be used as part of team onboarding.
5. The development target is reachable from a known host identity that survives DHCP churn.

## Dependencies
- `website/deploy.ps1`
- `website/serve.ps1`
- `website/ncsitebuilder/serve.ps1`
- `scripts/website-playwright-smoke.mjs`
- `AGENTS.md`

## Work completed

- Added environment-driven server/port/path resolution to `website/scripts/deploy.mjs`:
  - `WEBSITE_DEPLOY_SERVER`
  - `WEBSITE_DEPLOY_PORT`
  - `WEBSITE_DEPLOY_REMOTE_PATH`
- Kept PowerShell shim compatibility while resolving deployment params via env with explicit fallback behavior.
