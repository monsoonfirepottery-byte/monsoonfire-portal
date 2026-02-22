# P1 — Contract Discovery Linkage for Agent Surfaces

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Platform + API
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

Core contract docs exist, but agents do not have a compact, stable discovery path that prioritizes those authoritative sources.

## Objective

Guarantee that website/portal `llms.txt` and `ai.txt` files directly point to canonical contract and source-of-truth docs.

## Scope

- `docs/API_CONTRACTS.md`
- `docs/DEEP_LINK_CONTRACT.md`
- `docs/SOURCE_OF_TRUTH_INDEX.md`
- website + portal discovery files

## Tasks

1. Add authoritative links to the above docs from both website and portal discovery files.
2. Add explicit authority labels in `llms.txt` blocks.
3. Ensure link ordering keeps highest-signal docs near the top for token efficiency.
4. Add short validation rule in CI to require these canonical pointers.
5. Document expected contract-link set in runbook.

## Acceptance Criteria

1. Both website and portal discovery files include all three canonical docs.
2. Discovery files label these docs as authoritative.
3. CI check fails if required contract links are removed.

## Dependencies

- `docs/API_CONTRACTS.md`
- `docs/DEEP_LINK_CONTRACT.md`
- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `scripts/`

