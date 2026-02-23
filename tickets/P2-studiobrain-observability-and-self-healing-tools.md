# P2 — Observability and Self-Healing Tools for Studiobrain Host

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

The Studiobrain host now becomes a long-lived operations platform, but we currently do not have a dedicated local observability stack for trend, drift, and fail-fast alerting tied to the same onboarding contract.

## Objective

Add an optional, composable monitoring profile that gives Studio Brain operators visibility into availability, dependencies, latency, and drift before users do.

## Scope

- `studio-brain/docker-compose.yml`
- `studio-brain/docker/otel-collector.yaml`
- `studio-brain/docs/SWARM_BACKEND_SETUP.md`
- `studio-brain/README.md`
- `docs/metrics/STUDIO_OS_V3_SCORECARD.md`
- `studio-brain/scripts/preflight.mjs`
- `studio-brain/docs/OPS_TUNING.md`

## Tasks

1. Add a local observability compose profile (opt-in) for:
   - health scraping
   - service uptime checks (Postgres/Redis/MinIO/Studio Brain)
   - endpoint latency probes (`/healthz`, `/readyz`, `/api/status`, `/api/metrics`)
2. Add a lightweight dashboard surface:
   - SLO-oriented views (snapshot freshness, readiness ratio, dependency health)
   - recent alert/failure markers
3. Wire OTEL exporter outputs into local storage (where available) and confirm optional collector profile is resilient without the profile as well.
4. Add simple routing checks for web + website + functions endpoints from the same host contract used in onboarding/smoke.
5. Define restart and escalation behavior for common local faults:
   - repeated readiness failures
   - dependency degraded state
   - container flapping threshold
6. Add one-click start/stop commands for the observability bundle and one command to reset local metric state.

## Acceptance Criteria

1. Local operator can start observability tooling with a documented single command.
2. Observability bundle consumes the same host/URL contract as dev and smoke profiles.
3. Failures are visible in a single dashboard summary plus JSON artifacts.
4. Monitoring can be disabled cleanly (no startup penalty for non-observability profile).
5. Operators can identify regressions from a single failed health/latency signal without scanning logs manually.

## Dependencies

- `studio-brain/docker-compose.yml`
- `studio-brain/scripts/preflight.mjs`
- `studio-brain/src/config/env.ts`
- `studio-brain/docs/OPS_TUNING.md`

## Definition of Done

- Composable observability profile exists and is documented in onboarding docs.
- Alerts/health windows are mapped to concrete runbook responses.
- Failure signals are reproducible by local fault injection (`start-stop` and endpoint fault tests).

## Work completed

- Added composable observability command surface:
  - `scripts/studiobrain-observability-bundle.mjs`
  - `npm run studio:observability:up|down|status|reset`
  - `make ops-up|ops-down|ops-status|ops-reset` (`studio-brain/Makefile`)
- Added optional OTEL collector profile wiring in `studio-brain/docker-compose.yml` and collector config in `studio-brain/docker/otel-collector.yaml`.
- Wired OTEL output artifacts to local storage (`output/otel/traces.jsonl`) and validated collector startup.
- Added routing contract evidence integration into reliability checks:
  - `studio:stack:profile:snapshot:strict`
  - `reliability:once` now includes stack routing contract.
- Updated operational docs:
  - `studio-brain/README.md`
  - `studio-brain/docs/SWARM_BACKEND_SETUP.md`
  - `studio-brain/docs/OPS_TUNING.md`
  - `docs/metrics/STUDIO_OS_V3_SCORECARD.md`

## Evidence

1. `npm run studio:observability:up -- --json`
2. `npm run studio:observability:status -- --json`
3. `npm run studio:observability:down -- --json`
4. `npm run studio:observability:reset -- --json`
5. `npm run reliability:once -- --json`
