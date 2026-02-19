# P2 — MCP Server Registry Authority Expansion and Drift Guardrails

Status: Completed
Date: 2026-02-19
Priority: P2
Owner: Platform + Operations
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

Epic-08 already tracks MCP sources, but it still uses broad domain buckets and can miss specific authority gaps for:

- Ubuntu server administration and lifecycle hardening references
- Agent orchestration tooling and runtime control plane references
- Home automation and camera connector assumptions (Hubitat/Home Assistant ecosystem)
- Apple Home / app-association operational references

Without explicit expansion to known authoritative sources, these gaps become silent drift points in cutover and release workflows.

## Objective

Expand and lock the MCP registry source-of-truth domain from generic buckets into explicit, auditable entries that are validated during Epic-08 drift gates.

## Scope

- `.codex/config.toml`
- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `scripts/source-of-truth-index-audit.mjs`
- `tickets/P2-mcp-and-source-index-hierarchy.md`
- `tickets/P2-mcp-authoritative-source-registry-and-open-ops-connectors.md`
- `scripts/epic-hub.mjs` (if required by registry-to-ticket traceability)

## Tasks

1. Expand the MCP source-of-truth list to explicit entries for:
   - `homeAssistantMcpIntegration`
   - `agentOrchestrationKubernetesDocs`
   - Additional Home automation/camera references already present in `.codex/config.toml` where useful for explicit auditability
2. Update `docs/SOURCE_OF_TRUTH_INDEX.md` to include expanded "Home automation vendor integrations" and "agent orchestration control-plane references" rows.
3. Update source-of-truth index audit behavior to fail if expected authoritative MCP keys for these domains disappear.
4. Add ticket-level ownership and remediation policy in the index/ops docs for each expansion domain.
5. Keep the "required MCP key" list aligned when new authoritative MCP keys are added or retired.

## Acceptance Criteria

1. MCP coverage in `docs/SOURCE_OF_TRUTH_INDEX.md` reflects each critical domain with concrete key lists instead of only wildcard buckets.
2. `node ./scripts/source-of-truth-index-audit.mjs --strict` fails when any listed authoritative MCP key for Epic-08 is missing.
3. `tickets` and source-of-truth index updates stay in sync via the epic owner checklist.

## Definition of Done

- `scripts/source-of-truth-index-audit.mjs` contains explicit, domain-specific required keys for expanded MCP sources.
- `docs/SOURCE_OF_TRUTH_INDEX.md` has clear, auditable references for Ubuntu + agent orchestration + home automation/camera/Hubitat.
- Changes in MCP registry assumptions are represented by a ticket update tied to `P1-EPIC-08...`.
