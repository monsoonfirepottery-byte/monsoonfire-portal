# P2 — Non-flaky Link Validation for `llms.txt` and `ai.txt`

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Platform + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

Discovery-file link validation can become flaky if checks depend on live network calls during CI.

## Objective

Implement deterministic validation for agent-surface links that catches obvious drift without introducing flaky external dependencies.

## Scope

- validation script under `scripts/`
- CI/PR gate wiring
- runbook notes for local verification

## Tasks

1. Parse `llms.txt` and `ai.txt` entries for both website and portal.
2. Validate link format and approved host/path patterns.
3. Optionally validate local-repo relative paths exist when links target docs in-repo.
4. Add clear report output for invalid/missing references.
5. Wire into CI in non-flaky mode by default.

## Acceptance Criteria

1. Validation catches malformed/forbidden link entries in discovery files.
2. Validation remains deterministic in CI (no required live HTTP checks).
3. Failure output maps directly to offending file + line content.

## Dependencies

- `scripts/`
- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `docs/runbooks/AGENT_SURFACES.md`

