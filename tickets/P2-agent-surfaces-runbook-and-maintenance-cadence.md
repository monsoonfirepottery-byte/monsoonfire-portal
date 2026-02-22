# P2 — Agent Surfaces Runbook + Maintenance Cadence

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Docs + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

Agent-facing files become stale quickly without clear ownership, update triggers, and release-time checks.

## Objective

Create and operationalize `docs/runbooks/AGENT_SURFACES.md` with ownership, update triggers, review cadence, and verification commands.

## Scope

- `docs/runbooks/AGENT_SURFACES.md` (new)
- references in `docs/README.md` and relevant sprint/ops docs

## Tasks

1. Define runbook sections:
   - ownership and review cadence
   - required surfaces and expected formats
   - pre-deploy and PR verification steps
2. Document escalation path when discovery content and contracts diverge.
3. Add update-trigger checklist:
   - new API endpoints
   - deep-link changes
   - major workflow changes
4. Add change log guidance for agent surfaces.
5. Cross-link from docs index and relevant onboarding docs.

## Acceptance Criteria

1. Runbook exists and is linked from docs navigation.
2. Ownership and review cadence are explicit.
3. Runbook commands map to deterministic checks in repo scripts.

## Dependencies

- `docs/README.md`
- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `scripts/pr-gate.mjs`

