# P1 - StudioBrain Coordinator Contracts (Discord + CLI + Portal)

Status: Open
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
