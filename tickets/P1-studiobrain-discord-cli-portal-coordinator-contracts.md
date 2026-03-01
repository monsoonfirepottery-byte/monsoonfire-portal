# P1 - StudioBrain Coordinator Contracts (Discord + CLI + Portal)

Status: Completed
Date: 2026-02-17

## Problem
Real-estate intelligence outputs are growing, but there is not yet a unified coordination contract for human+agent operation across Discord, CLI, and Portal channels.

## Objective
Define and implement stable command/event contracts so a Codex/OpenClaw-like coordinator can safely orchestrate research, triage, and human approvals across all three interfaces.

## Scope
- Shared command schema for task creation, assignment, escalation, and closure
- Shared result schema for opportunity signals, parcel graph updates, and outreach recommendations
- Channel adapters for Discord, CLI, and Portal
- Role/permission guardrails for human approvals and high-impact actions
- Audit log model for coordinator decisions and human overrides

## Tasks
1. Define canonical coordinator command JSON contract.
2. Define canonical event/result JSON contract.
3. Implement channel-specific adapter layer:
   - Discord command + response formatting
   - CLI command runner + structured output
   - Portal action cards + approval workflows
4. Wire real-estate pipeline outputs (`public-signals`, `parcel-graph`, `agentic-research`) into coordinator input queue.
5. Add runbook section for operator workflows and escalation paths.

## Acceptance
- Same command can be issued from Discord, CLI, or Portal with equivalent behavior.
- Coordinator can ingest latest real-estate artifacts and produce channel-appropriate tasks.
- Approval-requiring actions are gated and auditable.

## Dependencies
- `output/real-estate/public-signals-latest.json`
- `output/real-estate/parcel-graph-latest.json`
- `output/real-estate/agent-swarm-research-context-*.json`
- `docs/REAL_ESTATE_MARKET_WATCH.md`

## Completion evidence (2026-02-28)
1. Coordinator contract generator is implemented in `scripts/build-studiobrain-coordinator-adapters.ps1`.
2. Weekly orchestrator includes coordinator contract generation in `scripts/run-real-estate-weekly-cadence.ps1`.
3. Channel command contracts for Discord/CLI/Portal and execution queue output are emitted to:
   - `output/real-estate/studiobrain-coordinator-*.json`
   - `output/real-estate/studiobrain-coordinator-latest.json`
4. Capability and operator handoff documentation is included in:
   - `docs/REAL_ESTATE_MARKET_WATCH.md`
   - `docs/real-estate/AGENT_CAPABILITIES_OVERVIEW.md`
