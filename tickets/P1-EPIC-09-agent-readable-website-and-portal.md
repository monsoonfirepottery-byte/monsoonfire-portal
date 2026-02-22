# Epic: P1 — Agent-readable Website + Portal

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Platform + Security Review
Type: Epic

## Problem

Humans can navigate `monsoonfire.com` and `portal.monsoonfire.com` through visual UX and page context, but agent workflows (single-agent and swarm) still require high-friction discovery and manual link hunting.
Without curated, token-efficient, publicly safe discovery surfaces, agents waste context budget, miss authoritative contracts, and increase implementation drift risk.

## Objective

Ship a safe, incremental "agent-readable surfaces" baseline across website and portal so AI agents can quickly discover authoritative docs and workflows without expanding privilege boundaries or weakening security posture.

## Tickets

- `tickets/P1-agent-surfaces-website-llms-and-ai-txt.md`
- `tickets/P1-agent-surfaces-portal-llms-and-ai-txt.md`
- `tickets/P1-agent-surfaces-robots-and-sitemap-regression.md`
- `tickets/P1-agent-surfaces-agent-docs-page-and-policy.md`
- `tickets/P1-agent-surfaces-contract-discovery-linkage.md`
- `tickets/P1-agent-surfaces-continue-journey-agent-quickstart.md`
- `tickets/P2-agent-surfaces-portal-contracts-static-artifact.md`
- `tickets/P2-agent-surfaces-jsonld-key-pages-alignment.md`
- `tickets/P2-agent-surfaces-ci-gate-and-secret-scan.md`
- `tickets/P2-agent-surfaces-link-validation-nonflaky-check.md`
- `tickets/P2-agent-surfaces-runbook-and-maintenance-cadence.md`
- `tickets/P2-agent-surfaces-ios-docs-translation-bridge.md`

## Scope

### Phase 1 — Discovery surfaces (low risk)

1. Add `/llms.txt` at root of both website and portal deploy outputs.
2. Add `/ai.txt` at root of both website and portal deploy outputs.
3. Confirm and preserve `robots.txt` + `sitemap.xml` behavior for both products.
4. Add an "Agent Docs" page/section that explains what these surfaces are and what is authoritative.

### Phase 2 — Authoritative contracts and workflows

1. Ensure agent discovery files explicitly point to:
   - `docs/API_CONTRACTS.md`
   - `docs/DEEP_LINK_CONTRACT.md`
   - `docs/SOURCE_OF_TRUTH_INDEX.md`
2. Publish a stable, read-only portal contracts artifact or endpoint and link it from discovery files.
3. Add a short, agent-optimized workflow page for Continue Journey / batch progression.

### Phase 3 — Maintainability and gates

1. Add deterministic CI checks for existence of website/portal `llms.txt` and `ai.txt`.
2. Add deterministic secret-scan checks for agent-facing files.
3. Add deterministic link-shape validation (no flaky live network dependency).
4. Add/maintain `docs/runbooks/AGENT_SURFACES.md`.

## Non-goals

1. No privileged or authenticated API bypasses.
2. No internal hostnames, tokens, secrets, or operator-only endpoints in public discovery files.
3. No claim that emerging standards are universally adopted; treat `llms.txt` and `ai.txt` as incremental compatibility aids.
4. No runtime dependency on external network checks in CI for pass/fail.

## Milestones

1. M1 (Phase 1): website + portal serve `llms.txt` and `ai.txt`; SEO surfaces unchanged.
2. M2 (Phase 2): contract/workflow references are explicit and authoritative.
3. M3 (Phase 3): CI and runbook guardrails keep surfaces current and safe.

## Initial Task Breakdown (Owner-tagged)

1. Create website `llms.txt` with curated start-here links and authority labels.  
   Owner: Website + Platform (`tickets/P1-agent-surfaces-website-llms-and-ai-txt.md`)
2. Create website `ai.txt` with concise resource narrative and safe scope notes.  
   Owner: Website + Platform (`tickets/P1-agent-surfaces-website-llms-and-ai-txt.md`)
3. Create portal `llms.txt` with portal-first workflow and contract links.  
   Owner: Portal + Platform (`tickets/P1-agent-surfaces-portal-llms-and-ai-txt.md`)
4. Create portal `ai.txt` with public-safe API/docs routing context.  
   Owner: Portal + Platform (`tickets/P1-agent-surfaces-portal-llms-and-ai-txt.md`)
5. Validate website/portal `robots.txt` and `sitemap.xml` parity before and after changes.  
   Owner: Website + Platform (`tickets/P1-agent-surfaces-robots-and-sitemap-regression.md`)
6. Publish Agent Docs page/section and cross-link all discovery surfaces.  
   Owner: Docs + Website + Portal (`tickets/P1-agent-surfaces-agent-docs-page-and-policy.md`)
7. Wire `API_CONTRACTS`, deep-link contract, and source-of-truth index into discovery lists.  
   Owner: Platform + API (`tickets/P1-agent-surfaces-contract-discovery-linkage.md`)
8. Publish agent-optimized Continue Journey workflow reference.  
   Owner: Portal + Docs (`tickets/P1-agent-surfaces-continue-journey-agent-quickstart.md`)
9. Add/ship stable portal contracts artifact or generated public contract file.  
   Owner: Portal + Functions (`tickets/P2-agent-surfaces-portal-contracts-static-artifact.md`)
10. Add JSON-LD alignment for key pages where it improves machine readability.  
    Owner: Website + SEO + Platform (`tickets/P2-agent-surfaces-jsonld-key-pages-alignment.md`)
11. Add CI guard for `llms.txt`/`ai.txt` presence and secret leak pattern checks.  
    Owner: Platform + Security (`tickets/P2-agent-surfaces-ci-gate-and-secret-scan.md`)
12. Add deterministic link-shape validation for discovery files (non-flaky).  
    Owner: Platform + QA (`tickets/P2-agent-surfaces-link-validation-nonflaky-check.md`)
13. Add runbook ownership/cadence for maintaining agent surfaces.  
    Owner: Docs + Platform (`tickets/P2-agent-surfaces-runbook-and-maintenance-cadence.md`)
14. Document iOS-docs tooling translation path for these discovery artifacts.  
    Owner: Mobile + Platform (`tickets/P2-agent-surfaces-ios-docs-translation-bridge.md`)

## Dependencies

- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `docs/API_CONTRACTS.md`
- `docs/DEEP_LINK_CONTRACT.md`
- `scripts/epic-hub.mjs`
- `scripts/epic-hub-runner.mjs`
- `docs/README.md`
- `website/robots.txt`
- `website/sitemap.xml`
- `website/ncsitebuilder/robots.txt`
- `website/ncsitebuilder/sitemap.xml`
- `web/public/`
- `firebase.json`

## Acceptance Criteria

1. Website deploy serves:
   - `GET /llms.txt` returns `200` with `text/plain` or `text/markdown`
   - `GET /ai.txt` returns `200` with `text/plain`
2. Portal deploy serves:
   - `GET /llms.txt` returns `200` with `text/plain` or `text/markdown`
   - `GET /ai.txt` returns `200` with `text/plain`
3. Existing SEO surfaces do not regress:
   - website `robots.txt` and `sitemap.xml` still resolve and keep intended directives
   - portal `robots.txt` and `sitemap` behavior remains explicitly defined
4. `llms.txt` content quality:
   - includes an 8-15 link start-here list
   - labels authoritative vs advisory docs
   - links to API/deep-link contracts and runbooks
5. CI gate is deterministic and green on PRs:
   - validates existence of website/portal `llms.txt` + `ai.txt`
   - validates no obvious secrets in agent-facing public files
   - performs non-flaky link-shape checks for discovery file entries
6. Documentation updates are merged and reference all new agent surfaces, including maintenance ownership.

## Definition of Done

1. Epic has child tickets with owners and acceptance criteria, and appears in `node ./scripts/epic-hub.mjs list`.
2. Public discovery surfaces are shipped with zero privileged data exposure.
3. CI and runbook guardrails prevent silent drift as new features ship.
