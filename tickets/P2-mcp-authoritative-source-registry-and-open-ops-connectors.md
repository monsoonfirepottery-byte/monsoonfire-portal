# P2 — MCP and Operations Connector Source Registry

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Operations
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

Epic-08 now treats MCP and external connector catalogs as part of the source-of-truth surface, but the authoritative registry is incomplete and does not capture the operational domains we depend on for Studiobrain hosting and home automation.

## Objective

Define a complete MCP source-of-truth catalog and connect it to deployment/monitoring evidence so that missing or drifting tool-chain endpoints are surfaced as blockers.

## Scope

- `.codex/config.toml`
- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `scripts/source-of-truth-deployment-gates.mjs`
- `scripts/source-of-truth-contract-matrix.mjs`
- `scripts/epic-hub.mjs` (if needed for source-hierarchy visibility)
- `docs/OPS_EVIDENCE_AUTOPILOT.md` or replacement evidence notes

## Tasks

1. Expand MCP domain sections to include expected external sources for:
   - Ubuntu/server administration and host lifecycle tooling
   - Home automation connectors (Home Assistant, Hubitat, Apple Home, roborock/camera-related tooling)
   - Agent orchestration/runner tooling
   - Explicit MCP key-level entries for:
     - `homeAssistantMcpIntegration`
     - `agentOrchestrationKubernetesDocs`
2. Add trust-level tags per source:
   - authoritative
   - derived
   - advisory
3. Add a pre-check entry in Epic-08 deployment gate coverage so MCP entries are validated as part of staging + production readiness.
4. Add an evidence artifact mapping so reviewers can trace each MCP domain to its owning ticket and command surface.
5. Document missing/placeholder MCP sources in ticket format whenever environment assumptions change.

## Acceptance Criteria

1. Source-of-truth index lists every required MCP/tooling domain with explicit authoritative source and evidence owner.
2. Changes to MCP configuration require an accompanying source-of-truth entry update.
3. Epic-08 staging/production gate output includes MCP coverage status.
4. No MCP domain used in operational scripts remains undocumented in source-of-truth evidence.

## Definition of Done

- New entries in `docs/SOURCE_OF_TRUTH_INDEX.md` are merged and enforced in at least one gate command.
- A reviewer can identify the authority owner for each MCP source from index or ticket.
- Deployment blocker behavior is preserved when MCP domain coverage is missing.
