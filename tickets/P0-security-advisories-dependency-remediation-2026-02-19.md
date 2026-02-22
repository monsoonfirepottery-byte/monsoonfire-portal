# P0 — Dependency Security Remediation: root/web/functions/studio-brain audit findings

Status: Completed
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

## Resolution (2026-02-22)

Remediation completed for the open GitHub Dependabot alerts observed on 2026-02-22:

1) `studio-brain/package-lock.json`
- `fast-xml-parser` advisories resolved:
  - `GHSA-jmr7-xgp7-cmfj` (high)
  - `GHSA-m7jm-9gc2-mpf2` (critical)
- Change:
  - Added `studio-brain/package.json` override:
    - `"fast-xml-parser": "^5.3.6"`
  - Reinstalled `studio-brain` lockfile.
- Verified resolved tree:
  - `minio@8.0.6 -> fast-xml-parser@5.3.7`
  - `@google-cloud/storage@7.19.0 -> fast-xml-parser@5.3.7`

2) `functions/package-lock.json`
- `minimatch` advisory chain resolved:
  - `GHSA-3ppc-4f35-3m26` (high)
  - transitive chain: `glob` / `rimraf` / `gaxios`
- Change:
  - Added `functions/package.json` overrides:
    - `"minimatch": "^10.2.2"`
    - `"glob": "^13.0.6"`
    - `"rimraf": "^6.1.3"`
  - Reinstalled `functions` lockfile.
- Verified resolved runtime chain:
  - `googleapis -> google-auth-library -> gaxios -> rimraf@6.1.3 -> glob@13.0.6 -> minimatch@10.2.2`

## Validation Evidence (2026-02-22)

- `npm audit --omit=dev --json` (root): `0 vulnerabilities`
- `npm audit --omit=dev --json --prefix web`: `0 vulnerabilities`
- `npm audit --omit=dev --json --prefix functions`: `0 vulnerabilities`
- `npm audit --omit=dev --json --prefix studio-brain`: `0 vulnerabilities`
- `npm --prefix functions run build`: pass
- `npm --prefix functions run test`: pass
- `npm --prefix studio-brain run build`: pass
- `npm --prefix studio-brain run test:infra`: pass
