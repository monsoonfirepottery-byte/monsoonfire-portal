# P2 — Stability Budget and Failure Thresholds for Long-Running Loops

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Operations + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Watch loops can mask recurring flapping or repeated recoveries and turn into unstable but persistent false-green states.

## Objective

Define explicit stability budgets and thresholds that force escalation before silent degradation becomes persistent.

## Scope

- `scripts/reliability-hub.mjs`
- `scripts/cutover-watchdog.mjs`
- `studio-brain/scripts/preflight.mjs`

## Tasks

1. Define stability budgets:
   - max restarts per service per hour
   - repeated readiness failures
   - API latency threshold breaches
2. Add per-loop severity grading and escalation:
   - warning, degraded, critical
3. Add auto-pause/rescope mode when budget exceeded:
   - stop noisy restarts
   - require manual acknowledgement
4. Add dashboard artifact updates:
   - budget consumption over time
   - top offenders and mitigation hints
5. Add configuration:
   - per-environment thresholds
   - grace period and cooldown config

## Acceptance Criteria

1. Repeated failures produce controlled, explicit escalation.
2. Stability budgets are configurable and versioned.
3. Operators can see budget consumption without scanning raw logs.
4. The tool never silently loops on repeated hard failure indefinitely.

## Dependencies

- `studio-brain/scripts/soak.mjs`
- `scripts/reliability-hub.mjs`
- `docs/metrics/STUDIO_OS_V3_SCORECARD.md`

## Definition of Done

- Failure behavior has defined upper bounds and operator escalation behavior.

## Work completed

- Added rolling stability-budget evaluation to `scripts/reliability-hub.mjs`:
  - tracks failures, critical failures, and slow runs over a configurable window
  - emits `stabilityBudget` in heartbeat summary/report payloads
  - adds explicit `stability budget window` check entry in reliability results
- Added budget thresholds with env/config support:
  - `STUDIO_BRAIN_BUDGET_WINDOW_MINUTES`
  - `STUDIO_BRAIN_BUDGET_MAX_FAILURES_PER_HOUR`
  - `STUDIO_BRAIN_BUDGET_MAX_CRITICAL_FAILURES_PER_HOUR`
  - `STUDIO_BRAIN_BUDGET_MAX_SLOW_RUNS_PER_HOUR`
  - `STUDIO_BRAIN_BUDGET_MAX_RUN_DURATION_MS`
- Added watch-loop auto-pause behavior on budget failure (toggle: `--no-auto-pause-budget`).
- Updated operations tuning docs with budget defaults and escalation usage:
  - `studio-brain/docs/OPS_TUNING.md`

## Evidence

1. `npm run reliability:once -- --json` (includes `stabilityBudget` and budget check line item)
2. `npm run reliability:watch -- --interval-ms 60000` (auto-pause behavior on budget exceed)
