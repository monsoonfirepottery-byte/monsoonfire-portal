# Engineering TODOs

Date: 2026-02-04
Owner: TBD
Status: Active

## Pinned (Website First-Visit Review — 2026-02-16)
- [x] Website first-time onboarding path + primary CTA clarity.
  - Ticket: `tickets/P2-website-new-user-primary-cta-and-start-path.md`
- [x] Website mobile navigation affordance and tap-target clarity.
  - Ticket: `tickets/P2-website-mobile-nav-clarity-and-tap-targets.md`
- [x] Website contact page conversion flow (intake-first, not mailto-only).
  - Ticket: `tickets/P2-website-contact-page-conversion-intake.md`
- [x] Website services page decision-support density and trust cues.
  - Ticket: `tickets/P3-website-services-page-decision-support-density.md`
- [x] Website support/FAQ progressive disclosure for first-time visitors.
  - Ticket: `tickets/P3-website-support-faq-progressive-disclosure.md`

## Next up
- [x] Deploy website changes to production and clear strict prod smoke parity.
  - Ticket: `tickets/P2-website-prod-smoke-parity-deploy.md`
- [x] Investigate and remediate `npm audit` high severity vulnerability in `web/` dependencies.
  - As of 2026-02-18, `npm audit --prefix web --json` reports 10 moderate vulnerabilities and 0 high/critical, with no current `vite-plugin-pwa` chain.
  - Fix target remains: monitor or apply a coordinated eslint/TypeScript ESLint upgrade path in a low-risk maintenance window.
- [x] Replace the sample glaze matrix with the real CSV matrix data for `importGlazeMatrix`.
- [x] Stand up West Valley/Phoenix real-estate market-watch foundation (ticket + schema + scoring script + runbook).
  - Ticket: `tickets/P2-studio-real-estate-market-watch-and-expansion-fit.md`
- [x] Run first live listing snapshot and publish top candidate watchlist with expansion fit scores.
  - Runbook: `docs/REAL_ESTATE_MARKET_WATCH.md`
  - Script: `scripts/run-real-estate-market-watch.ps1`
  - Artifacts: `output/real-estate/market-watch-20260217T183648Z.json`, `output/real-estate/market-watch-20260217T183648Z.md`
- [x] Normalize listing import quality gates (required URL field, monthly-vs-annual rate flag, and per-source parser adapters).
- [x] Generate quarterly price-trend rollup and agent-swarm context pack from historical snapshots.
  - Ticket: `tickets/P2-studio-real-estate-quarterly-trends-and-agent-context.md`
  - Script: `scripts/build-real-estate-quarterly-context.ps1`
  - Outputs: `output/real-estate/market-watch-history.csv`, `output/real-estate/real-estate-quarterly-report-YYYY-QX.md`, `output/real-estate/agent-swarm-context-YYYY-QX.json`
- [x] Automate quarterly context generation cadence (scheduled run + memory ingest handoff for swarm prompts).
  - Script: `scripts/run-real-estate-quarterly-cadence.ps1`
  - Outputs: `output/real-estate/quarterly-cadence-<timestamp>.json`, `output/real-estate/quarterly-cadence-latest.json`, `output/real-estate/quarterly-context-memory-latest.json`
- [x] Add agentic local real-estate research scanner for proactive opportunity discovery and distress-signal hunting.
  - Ticket: `tickets/P2-studio-real-estate-agentic-research-and-distress-scanner.md`
  - Script: `scripts/run-real-estate-agentic-research.ps1`
  - Outputs: `output/real-estate/agentic-research-<timestamp>.json`, `output/real-estate/agentic-research-<timestamp>.md`, `output/real-estate/agent-swarm-research-context-<timestamp>.json`
- [x] Wire full opportunity-source matrix into agentic scanner (government distress feeds, marketplaces, broker/industry reports).
  - Integrated sources: Maricopa Treasurer, tax-deeded land sales, Recorder notices, MCSO sheriff sales, Assessor parcel signals, county auctions/leases, Phoenix/West Valley permitting + planning, LoopNet, CREXi, Auction.com, CommercialCafe, CBRE, Colliers, Avison Young, NAIOP.
  - Script: `scripts/run-real-estate-agentic-research.ps1`
- [x] Add structured public-signal ingest layer and parcel graph foundation for agent-swarm context.
  - Ticket: `tickets/P2-studio-real-estate-structured-public-signals-and-parcel-graph.md`
  - Config: `docs/real-estate/public-signal-sources.json`
  - Scripts: `scripts/run-real-estate-public-signals.ps1`, `scripts/build-real-estate-parcel-graph.ps1`
  - Agentic integration: `scripts/run-real-estate-agentic-research.ps1` now merges `output/real-estate/public-signals-latest.json` when present.
- [x] Add free/public data pull + staging adapters feeding structured signals.
  - Ticket: `tickets/P2-studio-real-estate-free-public-data-ingestion-pipeline.md`
  - Scripts: `scripts/fetch-real-estate-public-data.ps1`, `scripts/build-real-estate-public-signal-staging.ps1`
  - Output roots: `output/real-estate/public-data`, `output/real-estate/staging/public-signals`, `output/real-estate/manual-drops`
  - Coverage: community-market signals (Reddit + Meta Marketplace), government auctions (state/local/federal), grants/funding pages, Maricopa Assessor ArcGIS, Maricopa Open Data, Treasurer/tax-deed/tax-sale portals, Census ACS, FRED, EPA ECHO, FEMA NFHL, USGS TNM
- [x] Add macro context pack from free/public sources and attach to agentic research context.
  - Script: `scripts/build-real-estate-macro-context.ps1`
  - Output: `output/real-estate/macro-context-<timestamp>.json`, `output/real-estate/macro-context-latest.json`
- [x] Wire daily/weekly autonomous research cadence and handoff into swarm execution queue.
  - Script: `scripts/run-real-estate-weekly-cadence.ps1`
  - Manifest: `output/real-estate/weekly-cadence-<timestamp>.json`, `output/real-estate/weekly-cadence-latest.json`
- [x] Add prompt-injection guardrail layer for community/public signals before agentic lead merge.
  - Script: `scripts/run-real-estate-public-signals.ps1` now scores/flags potential injection content and blocks flagged community rows.
  - Script: `scripts/run-real-estate-agentic-research.ps1` now excludes flagged community signals and hard-blocks high-score injection candidates.
- [x] Add versioned studio-needs profile + deterministic needs-context layer for time-varying expansion requirements.
  - Config: `docs/real-estate/studio-needs-profile.json`
  - Script: `scripts/build-real-estate-needs-context.ps1`
  - Outputs: `output/real-estate/needs-context-<timestamp>.json`, `output/real-estate/needs-context-latest.json`
- [x] Add model-free intelligence analysis layer with agent-ready queue (no per-run LLM dependency).
  - Config: `docs/real-estate/intelligence-weights.json`
  - Script: `scripts/run-real-estate-intelligence-analysis.ps1`
  - Outputs: `output/real-estate/intelligence-analysis-latest.json`, `output/real-estate/intelligence-task-queue-latest.json`, `output/real-estate/intelligence-entity-state-latest.json`
- [x] Wire needs-context + intelligence-analysis into weekly autonomous cadence.
  - Script: `scripts/run-real-estate-weekly-cadence.ps1`
- [x] Add channel-agnostic human review packet + deterministic steering log contract.
  - Scripts: `scripts/run-real-estate-review-packet.ps1`, `scripts/add-intelligence-steering-entry.ps1`
  - Outputs: `output/real-estate/intelligence-review-packet-latest.json`, `output/real-estate/intelligence-steering-log.jsonl`
- [x] Wire review packet generation into weekly autonomous cadence.
  - Script: `scripts/run-real-estate-weekly-cadence.ps1`
- [x] Add localized studio asset intelligence scanner (equipment-heavy, pickup-first market dynamics).
  - Config: `docs/real-estate/studio-asset-intel-config.json`
  - Script: `scripts/run-studio-asset-intelligence.ps1`
  - Outputs: `output/real-estate/studio-asset-intelligence-latest.json`, `output/real-estate/studio-asset-watchlist-latest.json`
  - Channel emphasis: Meta Marketplace, Reddit local signals, and local ceramic org newsletters/feeds.
- [x] Wire studio asset intelligence into weekly autonomous cadence.
  - Script: `scripts/run-real-estate-weekly-cadence.ps1`
- [x] Add studio asset manual-drop and direct-feed adapters to reduce index-blind spots.
  - Scripts: `scripts/seed-studio-asset-manual-drops.ps1`, `scripts/fetch-studio-asset-community-data.ps1`
  - Paths: `output/real-estate/manual-drops/studio-assets`, `output/real-estate/staging/studio-assets`
- [x] Add carry-forward fallback for studio asset watchlist continuity when live channel pulls return zero.
  - Script: `scripts/run-studio-asset-intelligence.ps1`
- [x] Add maintained studio needed/wanted + consumables list for asset prioritization and loose usage monitoring.
  - Config: `docs/real-estate/studio-needed-wanted-list.json`
  - Integration: `scripts/run-studio-asset-intelligence.ps1`
- [x] Add trusted local auction channel coverage for discounted studio gear.
  - Sources: `localauctions.com`, `sierraauctions.com`
  - Config: `docs/real-estate/studio-asset-intel-config.json`
- [x] Add testing harness/workflows for real-estate intelligence stability as system complexity increases.
  - Scripts: `scripts/test-real-estate-contracts.ps1`, `scripts/test-studio-asset-intel-harness.ps1`, `scripts/run-real-estate-test-suite.ps1`
  - Outputs: `output/real-estate/test-suite-latest.json`
- [x] Add authenticated source adapters + credential rotation for feeds that require API keys or gated exports.
  - Public-data fetch auth modes: `bearer`, `header`, `cookie`, `query` via `scripts/fetch-real-estate-public-data.ps1`
  - Studio-asset direct-feed auth + rotation via `scripts/fetch-studio-asset-community-data.ps1` and `docs/real-estate/studio-asset-intel-config.json`
- [x] Add parcel-level entity resolution enrichment (LLC normalization + recorder/assessor linkage confidence scoring).
  - Script: `scripts/build-real-estate-entity-resolution.ps1`
  - Outputs: `output/real-estate/entity-resolution-latest.json`, `output/real-estate/entity-resolution-latest.md`
- [x] Add Recorder anti-bot fallback adapter (headful/manual export helper) until direct HTTP access is reliable.
  - Script: `scripts/run-recorder-fallback-adapter.ps1`
  - Paths: `output/real-estate/manual-drops/recorder-fallback/recorder-export.csv`, `output/real-estate/staging/public-signals/maricopa_recorder_document_feed.csv`
- [x] Add StudioBrain coordinator adapters so swarm outputs can be actioned from Discord, CLI, and Portal UI with consistent command contracts.
  - Script: `scripts/build-studiobrain-coordinator-adapters.ps1`
  - Output: `output/real-estate/studiobrain-coordinator-latest.json`
- [x] Add skepticism-first opportunities research layer for grants/programs/rates/procurement/community requests.
  - Script: `scripts/run-real-estate-opportunity-research.ps1`
  - Config: `docs/real-estate/opportunity-research-config.json`
  - Outputs: `output/real-estate/opportunity-research-latest.json`, `output/real-estate/opportunity-research-task-queue-latest.json`
  - Weekly integration: `scripts/run-real-estate-weekly-cadence.ps1`
- [x] Prepopulate opportunity intelligence coverage across free/public federal/state/local databases.
  - Added source adapters: SAM.gov, USASpending explorer, Data.gov assistance catalog, HUD, EDA, DOE, SBA loans, ProcureAZ, Phoenix/Maricopa procurement, Craigslist/Reddit assistance signals.
  - Scripts: `scripts/fetch-real-estate-public-data.ps1`, `scripts/build-real-estate-public-signal-staging.ps1`, `scripts/seed-real-estate-manual-drops.ps1`
  - Config: `docs/real-estate/public-signal-sources.json`

## Later
- [x] Add a single-glaze tiles board (photos/notes per glaze, not just combos).
- [x] Refresh Community view recommended YouTube links quarterly (favor high-signal, beginner-safe pottery workflow videos and replace stale links).

## Notes
- Vite + Vitest dev flow now uses `web/scripts/dev.mjs` (no `concurrently`).
