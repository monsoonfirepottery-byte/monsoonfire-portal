# P2 — Home Ops Cockpit and Tooling for Studiobrain Stability

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

As the studio environment becomes a long-lived host, we need a stable operator-first surface for
visibility, incident routing, and post-change confidence. Right now we have fragmented checks and
manual log inspection.

## Objective

Create a lightweight “home cockpit” that gives clear signals about host health, service drift, and
incident status without forcing the whole stack to run a full observability estate.

## Scope

- `studio-brain/docker-compose.ops.yml` (new, optional profile composition)
- `studio-brain/docker-compose.observability.yml` (existing or future optional profile)
- `studio-brain/docs/OPS_DASHBOARD.md` (new)
- `scripts/reliability-hub.mjs` (existing, new commands)
- `scripts/heartbeat-ops-notifier.mjs` (new)
- `studio-brain/docs/SWARM_BACKEND_SETUP.md`
- `scripts/cutover-watchdog.mjs`

## Vision

The cockpit should feel like a “studio ops desk”:

- Single dashboard page showing:
  - green/yellow/red service status
  - dependency readiness and drift risk
  - latest artifacts (smoke, heartbeat, uptime)
- Low-friction recovery links:
  - restart one service stack
  - capture a diagnostics bundle
  - open runbook links for remediation

## Tooling to Evaluate and Select

1. Process and service telemetry
   - `cAdvisor` for container health/resource tracking
   - `node_exporter` for host-level resource metrics
   - `Prometheus` for local time-series
2. Logs and event context
   - `Loki` + `Promtail` (or `Promtail`-equivalent local log forwarder)
   - `Dozzle` for fast container log tailing
3. Human visibility and latency
   - `Grafana` for dashboard surfaces
   - `Uptime Kuma` for one-line heartbeat endpoint monitoring
4. Durability and restoration
   - `pg_dump` + `pg_dumpall` with retention policy
   - `redis-cli` snapshot tooling
   - `mc`/`rclone` health checks for MinIO bucket integrity
5. Workflow ergonomics
   - lightweight shell launcher commands
   - optional OS-native notification bridge for critical state changes

## Tasks

1. Add a dedicated optional compose profile bundle (not default) that starts:
   - monitoring UI stack (dashboard + uptime view)
   - container telemetry collection and optional log aggregation
   - endpoint checks aligned with smoke/host contracts
2. Add a single entrypoint command for the ops profile:
   - `npm run ops:cockpit:start`
   - `npm run ops:cockpit:status`
   - `npm run ops:cockpit:stop`
3. Add persistent but bounded storage settings for metrics/logs so the host remains stable after days of uptime.
4. Add a “diagnostics bundle” generator:
   - `output/ops/<timestamp>/metrics-summary.json`
   - `output/ops/<timestamp>/log-tail.txt`
   - `output/ops/<timestamp>/health.json`
5. Connect the existing reliability hub artifacts to the cockpit summary view:
   - include latest heartbeat summary
   - include last smoke failure reason
6. Add runbook links and recovery commands:
   - service restart path
   - dependency warm-up path
   - full reset path
7. Add cleanup policy for optional stack:
   - stop and remove stale monitoring containers
   - rotate old dashboards/JSON snapshots
   - document disk-budget guardrails
8. Add a local backup-and-restore heartbeat check integrated into reliability flow:
   - PostgreSQL backup freshness check
   - Redis snapshot age check
   - MinIO bucket read/write check

## Acceptance Criteria

1. Operators can start/stop a self-contained ops cockpit in one command using stable host contracts.
2. Host drift/regression can be detected by one dashboard view plus heartbeat artifact.
3. Logs and resource metrics are available locally for at least 24h by default with clear retention policy.
4. Diagnostics can be exported in under 30s for handoff during issue triage.
5. Cockpit tooling does not interfere with default developer flow when not enabled.

## Dependencies

- `studio-brain/docker-compose.yml`
- `studio-brain/docker-compose.observability.yml`
- `studio-brain/docker-compose.ops.yml`
- `studio-brain/README.md`
- `scripts/reliability-hub.mjs`
- `scripts/cutover-watchdog.mjs`

## Definition of Done

- Ops cockpit compose profile and scripts are documented and runnable from a clean environment.
- Dashboard + heartbeat + diagnostics artifacts are present and linked from the onboarding runbook.
- The team can recover from one induced service fault using documented cockpit-driven recovery steps.
