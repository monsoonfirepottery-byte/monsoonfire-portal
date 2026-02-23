# P2 — Smoke-First PR Gate for Studiobrain Cutover Changes

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: QA + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Project changes can land before essential local-contract health and endpoint checks are validated.

## Objective

Implement a deterministic smoke-first gate that runs contract, host, and dependency checks before merge-ready actions.

## Scope

- `scripts/pr-gate.mjs` (new)
- `package.json` scripts
- `docs/runbooks/PR_GATE.md` (new)
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`
- `docs/EMULATOR_RUNBOOK.md`

## Tasks

1. Define PR gate steps:
   - env contract validation
   - host profile consistency check
   - dependency readiness
   - portal + website smoke checks
   - reliability heartbeat sanity
2. Add command:
   - `npm run pr:gate`
   - exits non-zero on any required check failure
3. Add staged optional/required modes:
   - required minimum for PRs
   - extended optional for pre-merge performance smoke
4. Add contract artifact output:
   - machine-readable result file for CI/manual review
5. Add clear fail-fast remediation links and mapping to tickets.

## Acceptance Criteria

1. `npm run pr:gate` has deterministic pass/fail for contract and smoke requirements.
2. Required checks execute automatically in local PR preparation guidance.
3. Failures include exact step and next best action.

## Dependencies

- `scripts/reliability-hub.mjs`
- `studio-brain/scripts/preflight.mjs`
- `scripts/portal-playwright-smoke.mjs`
- `scripts/website-playwright-smoke.mjs`

## Definition of Done

- PR gate is adopted as the default pre-merge safety path and documented for all contributors.

## Work completed
- `scripts/pr-gate.mjs` now runs deterministic required checks (env contract, host profile consistency, preflight, status gate).
- Added optional smoke mode via `--smoke` for portal and website Playwright smoke checks.
- Added `npm run pr:gate` script in root `package.json`.
- Added machine-readable artifact output to `artifacts/pr-gate.json` (overridable via `--artifact`).
- Added runbook at `docs/runbooks/PR_GATE.md`.
- Added runtime docs freshness and backup freshness checks:
  - `npm run docs:contract:check`
  - `npm run backup:verify:freshness`
- Added required-entrypoint guard coverage for newly introduced tooling scripts.

## Evidence

1. `npm run pr:gate -- --json` (gate executes deterministic steps; current failure source is external source-index/MCP drift outside this ticket scope)
2. `npm run reliability:once -- --json`
