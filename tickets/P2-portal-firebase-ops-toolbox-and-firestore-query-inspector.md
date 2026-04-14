# P2 — Portal Firebase ops toolbox and Firestore query inspector

Status: Completed
Date: 2026-04-12
Priority: P2
Owner: Platform / Portal
Type: Ticket
Parent Epic: tickets/P1-EPIC-codex-tool-surface-and-portal-operator-access.md

## Problem
Firestore index, rules, log, and schema-query failures are currently detected piecemeal across separate scripts and runbooks. Debugging missing indexes or undefined-nullability hazards still requires too much manual assembly.

## Tasks
1. Add a single operator-facing Firebase ops entry point that bundles index guard, rules release drift, credential health, and targeted function or incident probes.
2. Add a Firestore query or schema inspector mode that flags likely composite-index requirements, undefined-write hazards, and ambiguous nullability before deploy.
3. Separate emulator-only findings from production or cloud findings in machine-readable and markdown output.
4. Document targeted incident usage by collection, query shape, or exact error text and link the relevant recovery steps.

## Acceptance Criteria
1. One command produces a Firebase ops report with index, rules, credential, and query-schema warnings.
2. Missing composite indexes and undefined or nullability risks are called out with actionable context.
3. Operators can run targeted checks without reading multiple runbooks first.

## Dependencies
- `package.json`
- `firestore.indexes.json`
- `firestore.rules`
- `scripts/firestore-index-contract-guard.mjs`
- `scripts/credentials-health-check.mjs`
- `scripts/sync-firestore-rules-releases.mjs`
- `scripts/deploy-preflight.mjs`
- `docs/runbooks/FIRESTORE_INDEX_TROUBLESHOOTING.md`
- `docs/runbooks/PORTAL_AUTOMATION_MATRIX.md`

## Verification
- toolbox command emits JSON and markdown output for a normal baseline run
- targeted query inspection highlights a known index or undefined-field risk
- emulator and production findings are reported in separate sections

## Completed In This Pass
1. Added `scripts/portal-firebase-ops-toolbox.mjs` and `npm run portal:firebase:ops` to bundle credential health, Firestore index guard, Firestore rules drift, and optional deploy preflight into one report.
2. Added exact error-text triage for common index-required, rules/auth, and Firestore-undefined-write failures.
3. Added focused tests for the new triage classifier.
4. Added `scripts/firestore-query-shape-inspector.mjs` so operators can scan file-backed query shapes before runtime and compare inferred composite indexes against `firestore.indexes.json`.
5. Updated `portal:firebase:ops` to include repo-static query inspection plus separate repo-static, local/operator, and cloud/production report sections.
6. Added `npm run portal:firebase:inspect` as a direct Firestore query-shape inspection entry point.
