# P2 — Agent Orchestration and Home-Host Automation Governance

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Studio Brain + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

Swarm/agent orchestration runbooks and orchestration tool integrations are part of Epic-08 deployment trust, but there is no explicit source-of-truth mapping for agent runtime topology, connector operators, and observability controls.

## Objective

Establish explicit source-of-truth and smoke/gate coverage for agent orchestration tooling so multi-agent execution remains auditable during cutover and releases.

## Scope

- `studio-brain/src/swarm/**`
- `studio-brain/docs/SWARM_BACKEND_SETUP.md`
- `studio-brain/docs/SWARM_BACKEND_ARCHITECTURE.md`
- `studio-brain/docker-compose.yml`
- `scripts/source-of-truth-deployment-gates.mjs`
- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `scripts/reliability-hub.mjs`

## Tasks

1. Capture orchestration service dependencies in source-of-truth index:
   - swarm API/runtime services
   - worker roles and event bus assumptions
   - health and queue telemetry signals
2. Add source references for operational tooling used by agents (queue/worker/control scripts, dashboards, alerts).
3. Extend readiness gates with a minimal orchestration smoke check (service health endpoint + queue baseline).
4. Add artifact output for agent-runner readiness during Epic-08 phased smoke.

## Acceptance Criteria

1. A reviewer can trace each orchestration tool and control path to an authoritative doc/source file.
2. Orchestration readiness is surfaced in Epic-08 gate evidence.
3. Missing orchestration prerequisites fail release readiness before deployment smoke.
4. Runbooks include concrete recovery steps for stalled orchestrators or backlog spikes.

## Definition of Done

- Agent orchestration readiness becomes an explicit Epic-08 checklist item with evidence output.
- Queue health and scheduler health checks are deterministic and source-linked.
- Orchestration-related docs and scripts are linked to a named owner for future edits.
