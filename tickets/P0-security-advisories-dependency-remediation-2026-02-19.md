# P0 — Dependency Security Remediation: root/web/functions/studio-brain audit findings

Status: Todo
Date: 2026-02-19
Priority: P0
Owner: Engineering
Type: Ticket
Parent Epic: tickets/P1-dependency-audit-triage.md

## Problem

High-severity `npm audit --omit=dev` findings are currently present across active repo workspaces:

1) Root workspace (`npm audit --omit=dev`)
- `fast-xml-parser` (high)
  - advisory: `GHSA-jmr7-xgp7-cmfj`
  - path: `node_modules/fast-xml-parser`

2) Functions workspace (`npm audit --omit=dev`)
- `fast-xml-parser` (high)
  - advisory: `GHSA-jmr7-xgp7-cmfj`
- `minimatch` (high)
  - advisory: `GHSA-3ppc-4f35-3m26`
- `glob` (high)
- `rimraf` (high)
- `gaxios` (high)

3) Studio-brain workspace (`npm audit --omit=dev`)
- `minio` (high, direct dep)
- `fast-xml-parser` (high)
  - advisory: `GHSA-jmr7-xgp7-cmfj`

## Why this is P0

- The current production-path workspaces remain with high-severity supply-chain vulnerabilities.
- Multiple advisories are parser/glob path vulnerabilities that can produce denial-of-service behavior and should be reduced before unblocked follow-up releases.

## Tasks

1) Reproduce and verify current state
- Run:
  - `npm audit --omit=dev`
  - `npm --prefix functions audit --omit=dev`
  - `npm --prefix studio-brain audit --omit=dev`
- Archive output for evidence in the ticket thread/next handoff.

2) Remediate `fast-xml-parser` / `GHSA-jmr7-xgp7-cmfj`
- Attempt non-breaking fixes first (`npm audit fix` in each workspace where feasible).
- If a non-breaking remediation is unavailable, propose controlled upgrade paths and risk notes.
- For studio-brain, evaluate `minio` upgrade strategy and confirm compatibility before bump.

3) Remediate `minimatch` / `glob` / `rimraf` / `gaxios` chain in functions
- Track fix path through transitive dependency chain:
  - minimatch advisory: `GHSA-3ppc-4f35-3m26`
  - minimatch affects `glob`, which affects `rimraf`, which affects `gaxios`.
- Try direct fixes first (dependency alignment/bump) and verify no breakage.

4) Validation
- Re-run all three `npm audit --omit=dev` commands and confirm high severity is resolved or explicitly documented with rationale/mitigation.
- Run targeted smoke checks where dependency changes may affect packaging/build tooling.

5) Close loop
- Update `tickets/P1-dependency-audit-triage.md` and board status if any residual vulnerabilities are accepted for later remediation.

## Acceptance

- No remaining high-severity vulnerabilities in:
  - root
  - functions
  - studio-brain
- If any high-severity vulnerabilities remain, include a signed exception with explicit mitigation and next remediation window in this ticket.
- Required evidence attached:
  - post-remediation audit outputs
  - any dependency change plan that required major-version bump/compatibility validation.
