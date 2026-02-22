# P2 — CI Gate for Agent Surfaces + Secret Leak Guard

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Platform + Security
Type: Ticket
Parent Epic: tickets/P1-EPIC-09-agent-readable-website-and-portal.md

## Problem

Without guardrails, public agent-facing files can drift, disappear, or accidentally include sensitive/internal strings.

## Objective

Add deterministic CI checks that verify agent-surface presence and reject obvious sensitive content in public discovery files.

## Scope

- CI/check script in `scripts/`
- root/package command wiring
- PR gate integration

## Tasks

1. Add script checks for required files:
   - website `llms.txt`, `ai.txt`
   - portal `llms.txt`, `ai.txt`
2. Add deterministic grep-style leak checks for common sensitive patterns:
   - bearer/token-like keys
   - private host patterns
   - internal-only URL markers
3. Integrate check into PR gate command path.
4. Provide readable error output with direct file references.
5. Document false-positive handling policy.

## Acceptance Criteria

1. CI fails when required discovery files are missing.
2. CI fails when sensitive-pattern checks match in public agent files.
3. Check runs deterministically without external API/network dependency.

## Dependencies

- `scripts/pr-gate.mjs`
- `.github/workflows/`
- `docs/runbooks/PR_GATE.md`

