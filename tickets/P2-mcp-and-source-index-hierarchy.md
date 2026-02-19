# P2 — MCP and Source Index Hierarchy

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

There is no explicit, hierarchical index linking MCP sources, deployment truths, API contracts, and deep-link sources to execution paths.
This causes lookup drift and makes release evidence harder to reconstruct.

## Objective

Create a source-index hierarchy doc and validation that points every source file to its canonical runtime owner and validation script.

## Scope

- `docs/SOURCE_OF_TRUTH_INDEX.md` (new)
- `AGENTS.md`
- `docs/README.md`
- `scripts/source-of-truth-contract-matrix.mjs`
- `scripts/source-of-truth-deployment-gates.mjs`
- `scripts/pr-gate.mjs`
- `scripts/mcp-config.mjs` (if present; create/update as needed)

## Tasks

1. Define index categories and precedence:
   - MCP catalog / external source-of-truth
   - API contract sources
   - deployment and workflow contracts
   - deep-link/store artifacts
2. Publish an index table by file, owner, and trust level (authoritative / generated / derived).
3. Add an index-lint command that fails on duplicate or missing authoritative references.
4. Require index updates when ticketed files in Epic 08 are touched.
5. Add an operator-facing section explaining where to verify each evidence artifact.

## Acceptance Criteria

1. Index is versioned, human-readable, and consumed in CI PR docs checks.
2. Index lint catches missing source ownership and unknown authority labels.
3. All current Epic 08 dependencies can be traced from source entry -> enforcement artifact.

## Dependencies

- `docs/README.md`
- `AGENTS.md`
- `scripts/pr-gate.mjs`
