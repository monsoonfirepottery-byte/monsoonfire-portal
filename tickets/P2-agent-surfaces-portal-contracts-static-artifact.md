# P2 — Stable Public Portal Contracts Artifact

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Portal + Functions
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

Portal contract references are available in source/docs but not exposed as a single stable public artifact optimized for agent retrieval.

## Objective

Provide a read-only, stable portal-contracts artifact (or endpoint) suitable for public agent discovery and version tracking.

## Scope

- contract generation script (if needed)
- static artifact path in portal or docs hosting
- links from `llms.txt` and `ai.txt`

## Tasks

1. Evaluate existing generated artifacts (`contracts/` or docs outputs) for suitability.
2. If missing, add deterministic generation step for a static public artifact.
3. Version or timestamp the artifact in a traceable way.
4. Link artifact from portal and website discovery files.
5. Document artifact lifecycle in runbook.

## Acceptance Criteria

1. A stable, read-only portal contracts artifact is publicly reachable.
2. Artifact is linked from both website and portal discovery files.
3. Artifact generation/update path is documented and deterministic.

## Dependencies

- `contracts/`
- `web/src/api/portalContracts.ts`
- `docs/API_CONTRACTS.md`
- `scripts/generate-runtime-docs.mjs`

