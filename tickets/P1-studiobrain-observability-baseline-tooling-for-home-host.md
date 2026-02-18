# P1 — Studiobrain Home-Host Observability and Stability Tooling

Status: In Progress
Date: 2026-02-18
Priority: P1
Owner: Platform + Studio Brain + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

The home host now has a long-lived operational role; we need first-class visibility into host health, process drift, and service readiness without adding fragility.

## Objective

Establish lightweight, stable observability tooling and procedures for everyday Studiobrain residency, including heartbeat checks, readiness evidence, and actionable failure triage.

## Scope

- Reliability and heartbeat scripts (`scripts/cutover-watchdog.*`)
- Studio-brain operational health surface (`scripts/studiobrain-status.mjs`)
- Container and resource health surfaces (compose/ops config)
- Evidence artifacts in `output/` (`heartbeat`, `smoke`, `incident-bundle`)
- runbooks and onboarding docs

## Tasks

1. Define an operational baseline with required checks:
   - Studio Brain HTTP health
   - Firebase emulator availability
   - Portal/website smoke endpoints
   - disk and process guardrails (low-cost/low-maintenance)
2. Add a one-command "house status" command and a one-command "watch" command in root scripts.
3. Persist lightweight artifacts:
   - latest heartbeat JSON
   - rotating event log
   - incident bundle for critical failures
4. Define severity levels and triage notes for host residency:
   - `yellow` (warning)
   - `red` (go/no-go block)
5. Add an evidence requirement in `docs/sprints` or runbook for EoD readiness checks.

## Acceptance Criteria

1. A stable operator command can report host health in under 60 seconds.
2. Repeated drifts are captured as structured events, not ad-hoc terminal notes.
3. A failed critical check blocks cutover PR gate or onboarding progression.
4. Evidence artifacts are retained and readable by future operators.

## Dependencies

- `scripts/cutover-watchdog.mjs`
- `scripts/studiobrain-status.mjs`
- `scripts/pr-gate.mjs`
- `studio-brain/docker-compose.ops.yml`
- `studio-brain/docker-compose.observability.yml`

## Definition of Done

- Core operational checks are standardized and documented.
- Baseline monitoring is optional for dev, required for cutover/handoff.
- Evidence artifacts become part of handoff/checklist flow.

## Work completed

- Added reliability heartbeat infrastructure for Studiobrain residency:
  - `scripts/reliability-hub.mjs`
  - `scripts/cutover-watchdog.mjs`
  - `scripts/cutover-watchdog.ps1`
  - `package.json` command additions:
    - `reliability:once`
    - `reliability:watch`
    - `reliability:report`
    - `cutover-watchdog` (and `:once`, `:watch`)
- Documented reliability operations in:
  - `docs/runbooks/PR_GATE.md`
  - `docs/EMULATOR_RUNBOOK.md`
- Updated reliability loop to include critical checks:
  - Studio Brain env contract
  - Studio Brain infra integrity
  - Host contract scan
  - Network profile contract
  - Emulator contract
  - Studio health status gate
  - Optional preflight/smoke probes
