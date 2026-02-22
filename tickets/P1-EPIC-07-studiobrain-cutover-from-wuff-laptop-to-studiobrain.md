# Epic: P1 — Studiobrain Cutover from wuff-laptop to Studiobrain

Status: Completed
Date: 2026-02-18
Priority: P1
Owner: Platform + Portal + Studio Brain
Type: Epic

## Problem
Development and smoke workflows still assume a mixed local setup path rooted in `wuff-laptop` conventions, which increases environment drift and makes reproducibility on new machines brittle.

## Objective
Cut over all current local/service dependencies used by portal, functions, and studio-brain workflows to a studiobrain-first model with reproducible startup, shared environment contracts, and cross-platform tooling.

## Tickets
- `tickets/P1-studiobrain-static-network-resilience-hardening.md`
- `tickets/P1-studiobrain-cross-platform-toolchain-hardening.md`
- `tickets/P1-studiobrain-observability-baseline-tooling-for-home-host.md`
- `tickets/P2-studiobrain-legacy-host-detection-and-cutover-validation.md`
- `tickets/P2-studiobrain-postgres-redis-minio-stack-portability.md`
- `tickets/P2-studiobrain-vite-local-hosting-and-proxy-migration.md`
- `tickets/P2-studiobrain-firebase-emulator-hosting-and-urls.md`
- `tickets/P2-studiobrain-static-network-binding-and-lan-stability.md`
- `tickets/P2-studiobrain-cross-platform-tooling-and-script-replacements.md`
- `tickets/P2-studiobrain-remove-nonessential-ps1-windows-wuff-references.md`
- `tickets/P2-studiobrain-env-secret-and-config-hygiene.md`
- `tickets/P2-studiobrain-cutover-smoke-and-dependency-gates.md`
- `tickets/P2-studiobrain-observability-and-self-healing-tools.md`
- `tickets/P2-studiobrain-site-reliability-hub-and-heartbeats.md`
- `tickets/P2-studiobrain-home-ops-cockpit-and-tooling.md`
- `tickets/P2-studiobrain-firebase-emulator-cleanup-and-docs.md`
- `tickets/P2-studiobrain-website-dev-target-and-cutover-hosting.md`
- `tickets/P2-studiobrain-host-and-url-contract-matrix.md`
- `tickets/P2-studiobrain-env-contract-schema-and-runtime-validation.md`
- `tickets/P2-studiobrain-platform-reference-automation-and-exemptions.md`
- `tickets/P2-studiobrain-host-network-profile-contract.md`
- `tickets/P2-studiobrain-status-command-and-health-card.md`
- `tickets/P2-studiobrain-structured-logs-and-correlation-ids.md`
- `tickets/P2-studiobrain-backup-and-restore-drills.md`
- `tickets/P2-studiobrain-resource-and-disk-guardrails.md`
- `tickets/P2-studiobrain-incident-bundle-automation.md`
- `tickets/P2-studiobrain-reverse-proxy-and-local-dns.md`
- `tickets/P2-studiobrain-script-and-infra-integrity-checks.md`
- `tickets/P2-studiobrain-smoke-first-pr-gate.md`
- `tickets/P2-studiobrain-destructive-action-controls-and-audit.md`
- `tickets/P2-studiobrain-stability-budget-and-failure-thresholds.md`
- `tickets/P2-studiobrain-docs-generation-from-runtime-contracts.md`
- `tickets/P2-studiobrain-lan-discovery-and-dhcp-fallback.md`
- `tickets/P2-studiobrain-windows-script-elimination-and-shims.md`

## Scope
1. Centralize all service startup and health checks under studio-brain-first workflows (`studio-brain/Makefile`, compose profiles, preflight).
2. Migrate developer dependency set for local studio runtime to standardized services:
   - PostgreSQL
   - Redis
   - MinIO
   - Firebase emulators used by portal/functions paths (`firestore`, `auth`, `functions`)
3. Move Vite + local Firebase emulator workflows to studiobrain-compatible patterns:
   - Replace mixed local assumptions with reproducible `web` and functions launch paths.
   - Standardize emulator host/port contracts (`127.0.0.1` vs `localhost`) and smoke coverage for local UI/backend coupling.
   - Ensure `npm run test:automation:bundle` and portal Playwright checks consume the same studiobrain-friendly local endpoint model.
4. Remove or de-emphasize platform-specific launch assumptions in favor of stable docs and shell/node entrypoints.
5. Standardize local endpoint/env contracts (`STUDIO_BRAIN_BASE_URL`, emulator URLs, token wiring, service ports).
6. Define a definitive onboarding + smoke runbook for Linux/macOS (studiobrain) and remove non-portable manual steps from the path.
7. Add a stable website development/preview target path for legacy marketing-site deployment workflows that can run independently of a specific developer machine.
8. Define a Studio Brain network policy for:
   - Local loopback-only defaults (`127.0.0.1` + `localhost`).
   - Optional LAN-facing identity (`studiobrain.local`) with documented static IP fallback for DHCP environments.
9. Define the long-term operations experience for Studiobrain as a permanent home:
   - status dashboard, logs, and health cockpit
   - recovery/runbook support, and optional low-friction incident routing
10. Implement operational hardening for long-lived host residency:
   - config schema enforcement, status command surface, and incident-grade diagnostics
   - resource guardrails, immutable artifacts, and recovery workflows

## Dependencies
- `studio-brain/docker-compose.yml`
- `studio-brain/Makefile`
- `studio-brain/.env.example`
- `studio-brain/src/config/env.ts`
- `studio-brain/scripts/preflight.mjs`
- `studio-brain/docs/SWARM_BACKEND_SETUP.md`
- `docs/EMULATOR_RUNBOOK.md`
- `functions/package.json`
- `functions/.env.local.example`
- `web/.env.local`
- `web/vite.config.js`
- `scripts/start-emulators.mjs`
- `website/deploy.ps1`
- `website/serve.ps1`
- `website/ncsitebuilder/serve.ps1`
- `AGENTS.md`
- `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`
- `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`
- `studio-brain/README.md`
- `studio-brain/docker-compose.observability.yml`
- `studio-brain/docker-compose.ops.yml`
- `scripts/reliability-hub.mjs`
- `studio-brain/.env.contract.schema.json`
- `studio-brain/.env.integrity.json`
- `studio-brain/docs/OPS_DASHBOARD.md`
- `scripts/studiobrain-status.mjs`
- `scripts/studiobrain-incident-bundle.mjs`
- `studio-brain/docker-compose.proxy.yml`

## Acceptance Criteria
1. A new studiobrain host can boot the full local stack with documented commands in a clean checkout.
2. PostgreSQL, Redis, MinIO, and Firebase emulator services pass automated dependency checks as part of smoke flow.
3. Vite dev server and portal-local Firebase emulator wiring are migrated to studiobrain-first, cross-platform commands.
4. New website development/preview deploy target is stable and documented for non-production cutover checks.
5. Cutover workflow includes explicit strategy for Studiobrain IP/hostname stability when running on DHCP-backed networking.
6. No service-critical step requires Windows-only execution paths.
7. Environment migration runbook documents authoritative host/port values and avoids ambiguity around local defaults.
8. Optional ops tooling stack is documented and can be started independently without blocking core dev tasks.
9. The platform has operational hardening artifacts: schema validation, health/status command, backup restore checks, and auditable recovery evidence.

## Definition of Done
1. Epic split into executable follow-up tickets and linked to the relevant docs.
2. Local cutover instructions verify a working end-to-end smoke path from clean environment.
3. Legacy wuff-laptop-specific assumptions are replaced with studio-brain-first defaults where feasible.
4. Team acknowledges migration readiness and updates sprint board ordering for next-step execution.
5. Team has a documented, low-friction operations baseline for uptime, logs, and incident recovery.
