# Epic: P1 — Source-of-Truth Drift Audit for MCP, Frontend/Backend, and Store-Ready Deployment

Status: Completed
Date: 2026-02-18
Priority: P1
Owner: Platform + Mobile + Release
Type: Epic

## Problem

There are multiple partial sources of truth for this system:

- API and function contracts (`web/src/api/portalContracts.ts`, `docs/API_CONTRACTS.md`, `functions/src/index.ts`)
- Frontend/native deep-link behavior (`docs/DEEP_LINK_CONTRACT.md`, web routes, iOS/Android routers)
- Deployment and build assumptions (`AGENTS.md`, `docs/README.md`, `firebase.json`, CI workflows)
- App submission artifacts (`website/.well-known/*`, iOS bundle/build metadata, Android app id/signature assets)

Phased beta and mobile app-store workflows will become brittle if any of these drift. We currently have known placeholders and inconsistencies (for example `.well-known` templates still containing placeholder values), and no single hard-fail drift gate that validates all three layers together.

## Objective

Create a high-confidence, automation-backed source-of-truth verification loop that blocks drift before phased beta rollout and before store-facing release candidates.

## Tickets

- `tickets/P1-source-of-truth-contract-audit-matrix.md`
- `tickets/P1-source-of-truth-deployment-gate-matrix.md`
- `tickets/P2-mcp-and-source-index-hierarchy.md`
- `tickets/P2-mcp-authoritative-source-registry-and-open-ops-connectors.md`
- `tickets/P2-well-known-and-app-links-production-compliance.md`
- `tickets/P2-phased-beta-release-gates-and-smoke-paths.md`
- `tickets/P2-mobile-store-readiness-evidence-gate.md`
- `tickets/P2-studiobrain-stable-hosting-network-and-static-ip-governance.md`
- `tickets/P2-studiobrain-vite-firebase-stack-cutover-and-legacy-ghosts.md`
- `tickets/P2-home-automation-camera-and-hubitat-source-stability.md`
- `tickets/P2-agent-orchestration-control-and-observability-hygiene.md`
- `tickets/P2-studiobrain-observability-and-tooling-stability-baseline.md`
- `tickets/P2-mcp-server-registry-authority-expansion-and-drift.md`
- `tickets/P2-studiobrain-remove-nonessential-ps1-windows-wuff-references.md`

## Scope

1. Build an explicit source-of-truth index for this release domain:
   - backend contract source-of-truth
   - frontend/client construction source-of-truth
   - mobile deep-link/store-compatibility source-of-truth
   - deployment and release-source-of-truth
2. Validate contract parity across implementations:
   - `web/src/api/portalContracts.ts` against `docs/API_CONTRACTS.md`
   - `web/src/api/portalContracts.ts` against iOS and Android contract mirrors
   - `docs/API_CONTRACTS.md` against backend function handlers and exposed endpoints
3. Validate production deployment contracts:
   - Firebase hosting/routes in `firebase.json`
   - production/staging base URLs in frontend env wiring and runbooks
   - workflow commands in `.github/workflows/*` and automation scripts (`ci-smoke`, `portal-prod-smoke`, `website-prod-smoke`, `website deploy`)
4. Validate mobile launch compatibility:
   - AASA + assetlinks templates are deployed, non-placeholder, and consistent with native app identifiers
   - deep-link canonical paths in docs and native routers align
   - auth domain and callback host expectations are consistent across web + native
5. Add pre-flight and CI gates:
   - local and CI scripts that fail on unresolved placeholders and stale hardcoded development endpoints in production paths
   - PR/merge block for high-impact drift deltas
6. Publish a release-readiness evidence manifest for each gated phase (staging, beta, production, store readiness snapshot).

## Dependencies

- `web/src/api/portalContracts.ts`
- `web/src/api/portalApi.ts`
- `functions/src/index.ts`
- `docs/API_CONTRACTS.md`
- `docs/DEEP_LINK_CONTRACT.md`
- `docs/MOBILE_PARITY_TODOS.md`
- `docs/IOS_RUNBOOK.md`
- `ios/PortalContracts.swift`
- `ios/DeepLinkRouter.swift`
- `android/app/src/main/java/com/monsoonfire/portal/reference/PortalContracts.kt`
- `android/app/src/main/java/com/monsoonfire/portal/reference/DeepLinkRouter.kt`
- `android/app/src/main/AndroidManifest.xml`
- `website/.well-known/apple-app-site-association`
- `website/.well-known/assetlinks.json`
- `.github/workflows/ci-smoke.yml`
- `.github/workflows/portal-prod-smoke.yml`
- `.github/workflows/website-prod-smoke.yml`
- `.github/workflows/ios-build-gate.yml`
- `.github/workflows/ios-macos-smoke.yml`
- `.github/workflows/android-compile.yml`
- `firebase.json` and website/web-hosting source
- `web/package.json`, `functions/package.json`, `ios-gate/Package.swift`
- `scripts/studio-cutover-gate.mjs`, `scripts/pr-gate.mjs`, `scripts/scan-studiobrain-host-contract.mjs`, `scripts/validate-emulator-contract.mjs`, and related validation scripts

## Acceptance Criteria

1. One canonical source-of-truth index file exists and is versioned with each acceptance scope.
2. A CI-safe drift audit compares at least the following triples and fails on mismatch:
   - `portalContracts.ts` ↔ `API_CONTRACTS.md` ↔ backend route exports in `functions/src/index.ts`
   - `portalContracts.ts` ↔ `ios/PortalContracts.swift` and Android contract mirror
   - `DEEP_LINK_CONTRACT.md` ↔ iOS/Android routers and host/domain manifests
3. Production deployment and smoke scripts fail fast on:
   - placeholder values in `.well-known` files
   - localhost/loopback endpoints in production build/test targets
   - environment-target mismatches between docs and implementation runbooks
4. Release readiness artifact is created per release candidate containing:
   - contract parity result
   - deep-link proof file (iOS + Android)
   - store-readiness checks (placeholders cleared, manifests valid, bundle IDs aligned)
5. No high-priority manual “source assumptions” remain undocumented in one or more of: AGENTS, API contracts, runbooks, or deployment docs.

## Definition of Done

1. Contract, deployment, and mobile compatibility drift can be validated in one command chain.
2. Blockers are codified in ticket form, with owners and deadlines.
3. Phased-beta and store-readiness workflows consume the same source-of-truth artifacts used by production smoke and PR gate.
4. Existing known placeholders and drift risks are either removed or explicitly justified with evidence and owner.
