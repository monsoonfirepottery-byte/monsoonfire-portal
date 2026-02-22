# P2 — iOS Docs Translation Bridge for Agent-readable Surfaces

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Mobile + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

Agent-facing discovery docs will only help long-term if they translate cleanly into iOS/mobile documentation and contract tooling.

## Objective

Define a lightweight translation path from public agent surfaces to iOS documentation references and parity checks.

## Scope

- mobile docs references
- contract/runbook cross-links
- parity notes for future iOS docs tooling

## Tasks

1. Map `llms.txt`/`ai.txt` authoritative links to existing iOS reference docs.
2. Add notes for which discovery entries should remain platform-neutral.
3. Define a future-compatible schema for mobile docs ingestion (without adding runtime dependencies yet).
4. Document this bridge in runbook and mobile docs index.
5. Add lightweight validation checklist for parity updates.

## Acceptance Criteria

1. iOS/mobile docs have explicit references to new agent-surface sources.
2. Translation rules avoid web-only assumptions.
3. Update checklist exists for future mobile tooling integration.

## Dependencies

- `ios/README.md`
- `docs/DEEP_LINK_CONTRACT.md`
- `docs/API_CONTRACTS.md`
- `docs/runbooks/AGENT_SURFACES.md`

