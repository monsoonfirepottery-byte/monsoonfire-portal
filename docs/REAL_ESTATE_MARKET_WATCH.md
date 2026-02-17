# Real Estate Market Watch (West Valley / Phoenix)

Date: 2026-02-17
Owner: Studio Ops
Status: Active

## Capability map
- `docs/real-estate/AGENT_CAPABILITIES_OVERVIEW.md` (authoritative high-level system map for agent/human operations)

## Goal
Track warehouse/light-industrial options for a future studio expansion with a repeatable, low-friction workflow.

Home studio remains the default baseline. This workflow is for visibility and timing, not immediate relocation.

## Inputs
Use a CSV snapshot with one row per listing.

Template:
- `docs/real-estate/market-watch-template.csv`

Minimum fields:
- `snapshotDate`
- `source`
- `listingId`
- `title`
- `city`
- `propertyType`
- `sqft`
- `askingRentMonthly` or `askingRentPsfNnn`
- `zoning`
- `clearHeightFt`
- `powerAmps`
- `gradeDoors`
- `url`

## Scoring Model (0-100)
- City in preferred set: 5
- Property type fit (`warehouse` / `industrial`): 20
- Size fit to target sqft range: 15
- Rent fit to target monthly cap: 25
- Zoning fit (`industrial`/`I-1`/`I-2`/`M-1`): 10
- Power fit (>= 200 amps): 10
- Clear height fit (>= 14 ft): 10
- Grade-door fit (>= 1): 5

Fit tiers:
- `strong_fit` (>= 80)
- `viable` (>= 60)
- `stretch` (>= 40)
- `weak` (< 40)

## Run
```powershell
pwsh -File scripts/run-real-estate-market-watch.ps1 `
  -ListingsCsv "docs/real-estate/market-watch-template.csv" `
  -OutDir "output/real-estate"
```

Useful overrides:
```powershell
pwsh -File scripts/run-real-estate-market-watch.ps1 `
  -ListingsCsv "C:\\path\\to\\live-listings.csv" `
  -TargetMinSqFt 1500 `
  -TargetMaxSqFt 7000 `
  -TargetMaxMonthlyRent 7000 `
  -Top 15
```

## Outputs
Per run:
- `output/real-estate/market-watch-<timestamp>.json`
- `output/real-estate/market-watch-<timestamp>.md`

The markdown output includes:
- snapshot overview
- market medians
- fit-tier counts
- ranked top candidates

## Quarterly Trends + Agent Swarm Context
Build quarterly trend context from all historical snapshot JSON artifacts:

```powershell
pwsh -File scripts/build-real-estate-quarterly-context.ps1 `
  -InputDir "output/real-estate" `
  -OutputDir "output/real-estate"
```

Outputs:
- `output/real-estate/market-watch-history.csv`
- `output/real-estate/real-estate-quarterly-report-YYYY-QX.md`
- `output/real-estate/agent-swarm-context-YYYY-QX.json`

The context JSON is designed as direct input to a real-estate agent swarm:
- quarter-over-quarter pricing trend signals
- recent run history tail
- latest ranked candidates with fit metadata
- concise baseline notes (home studio remains default baseline)

## Agentic Research Scan (Proactive + Distress Signals)
Run autonomous search-based discovery to find new opportunities and distressed-market leads:

```powershell
pwsh -File scripts/run-real-estate-agentic-research.ps1 `
  -OutputDir "output/real-estate" `
  -Top 30 `
  -MaxResultsPerQuery 25
```

What it does:
- runs location-specific industrial/warehouse search queries
- runs distress-oriented queries (price reduced, foreclosure, auction, motivated seller, sublease, vacant)
- runs government distress and civic signal queries across Maricopa Treasurer, tax-deeded land sales, Recorder notices, MCSO sheriff sales, Assessor parcel signals, county auction/lease pages, and Phoenix/West Valley planning + permitting updates
- runs listing marketplace scans across LoopNet, CREXi, Auction.com, and CommercialCafe
- runs broker/industry research scans across CBRE, Colliers, Avison Young, and NAIOP reports
- merges structured public-signal feeds (when configured) for tax/legal/court/utilities/permitting/CMBS/environmental distress context
- includes government auction signals (state/local/federal) and grant/funding opportunity signals for capital support paths
- includes community-market signals (Reddit and Meta Marketplace) as low-trust early indicators requiring corroboration
- applies prompt-injection screening to community/public-signal text; flagged community rows are blocked before ranking and swarm ingestion
- scores leads by expansion fit + distress signal intensity
- emits a swarm-ready context package with prioritized leads, per-source coverage summary, and recommended next actions.

Outputs:
- `output/real-estate/agentic-research-<timestamp>.json`
- `output/real-estate/agentic-research-<timestamp>.md`
- `output/real-estate/agent-swarm-research-context-<timestamp>.json`

Source coverage now included in each run:
- configured source count
- sources with hits
- per-source query count, raw items, unique leads, ranked leads

## Studio Asset Intelligence (Local Equipment + Grey Market)
Run localized asset discovery for pottery gear where shipping friction is high and local pickup dominates:

```powershell
pwsh -File scripts/seed-studio-asset-manual-drops.ps1 `
  -ConfigPath "docs/real-estate/studio-asset-intel-config.json" `
  -ManualDropDir "output/real-estate/manual-drops/studio-assets"
```

```powershell
pwsh -File scripts/fetch-studio-asset-community-data.ps1 `
  -ConfigPath "docs/real-estate/studio-asset-intel-config.json" `
  -OutDir "output/real-estate/asset-community-data" `
  -StagingDir "output/real-estate/staging/studio-assets"
```

```powershell
pwsh -File scripts/run-studio-asset-intelligence.ps1 `
  -ConfigPath "docs/real-estate/studio-asset-intel-config.json" `
  -PriorityListPath "docs/real-estate/studio-needed-wanted-list.json" `
  -OutputDir "output/real-estate" `
  -AutoFeedDir "output/real-estate/staging/studio-assets" `
  -ManualDropDir "output/real-estate/manual-drops/studio-assets" `
  -Top 30 `
  -MaxResultsPerQuery 20
```

Primary channel emphasis:
- Meta Marketplace and Reddit local sell signals
- local Craigslist listings (explicit high-signal weighting)
- local ceramic organization newsletters/feeds and community classifieds
- trusted auction channels: `localauctions.com`, `sierraauctions.com`
- secondary channels: OfferUp, school/university surplus, manufacturer demo/test signals

Outputs:
- `output/real-estate/studio-asset-intelligence-<timestamp>.json`
- `output/real-estate/studio-asset-intelligence-<timestamp>.md`
- `output/real-estate/studio-asset-intelligence-latest.json`
- `output/real-estate/studio-asset-watchlist-latest.json`

Config:
- `docs/real-estate/studio-asset-intel-config.json`
- `docs/real-estate/studio-needed-wanted-list.json`

Behavior notes:
- uses direct-feed staged CSVs plus manual-drop CSVs for hard-to-index channels
- applies needed/wanted priority boosts to asset ranking
- tracks consumable pressure from the needed/wanted list for loose day-to-day monitoring
- enables carry-forward fallback so the watchlist is not blank when live indexing drops to zero

Asset feed environment variables (optional, but recommended):
- `STUDIO_ASSET_META_FEED_URL`
- `STUDIO_ASSET_REDDIT_FEED_URL`
- `STUDIO_ASSET_CERAMIC_ORG_FEED_1_URL`
- `STUDIO_ASSET_CERAMIC_ORG_FEED_2_URL`
- `STUDIO_ASSET_CERAMIC_ORG_FEED_3_URL`

Asset feed auth adapter + rotation environment variables:
- `STUDIO_ASSET_META_COOKIE_PRIMARY`
- `STUDIO_ASSET_META_COOKIE_SECONDARY`
- `STUDIO_ASSET_META_COOKIE_ROTATION` (comma/semicolon-separated)
- `STUDIO_ASSET_REDDIT_TOKEN_PRIMARY`
- `STUDIO_ASSET_REDDIT_TOKEN_SECONDARY`
- `STUDIO_ASSET_REDDIT_TOKEN_ROTATION` (comma/semicolon-separated)
- `STUDIO_ASSET_CERAMIC_ORG_FEED_1_KEY_PRIMARY`
- `STUDIO_ASSET_CERAMIC_ORG_FEED_1_KEY_SECONDARY`
- `STUDIO_ASSET_CERAMIC_ORG_FEED_1_KEY_ROTATION` (comma/semicolon-separated)
- `STUDIO_ASSET_CERAMIC_ORG_FEED_2_KEY_PRIMARY`
- `STUDIO_ASSET_CERAMIC_ORG_FEED_2_KEY_SECONDARY`
- `STUDIO_ASSET_CERAMIC_ORG_FEED_2_KEY_ROTATION` (comma/semicolon-separated)
- `STUDIO_ASSET_CERAMIC_ORG_FEED_3_KEY_PRIMARY`
- `STUDIO_ASSET_CERAMIC_ORG_FEED_3_KEY_SECONDARY`
- `STUDIO_ASSET_CERAMIC_ORG_FEED_3_KEY_ROTATION` (comma/semicolon-separated)

## Structured Public Signals (Parcel + Owner Distress Context)
Pull free/public datasets first:

```powershell
pwsh -File scripts/fetch-real-estate-public-data.ps1 `
  -OutDir "output/real-estate/public-data"
```

Stage normalized source-key CSV files from the pull (and create manual-drop templates for blocked sources):

```powershell
pwsh -File scripts/build-real-estate-public-signal-staging.ps1 `
  -PublicDataManifestPath "output/real-estate/public-data/latest-manifest.json" `
  -StagingDir "output/real-estate/staging/public-signals" `
  -ManualDropDir "output/real-estate/manual-drops"
```

Configure and ingest structured feeds:
- config: `docs/real-estate/public-signal-sources.json`
- ingestor: `scripts/run-real-estate-public-signals.ps1`

```powershell
pwsh -File scripts/run-real-estate-public-signals.ps1 `
  -ConfigPath "docs/real-estate/public-signal-sources.json" `
  -OutputDir "output/real-estate" `
  -AutoStagingDir "output/real-estate/staging/public-signals" `
  -ManualDropDir "output/real-estate/manual-drops"
```

Outputs:
- `output/real-estate/public-signals-<timestamp>.json`
- `output/real-estate/public-signals-<timestamp>.md`
- `output/real-estate/public-signals-latest.json`

Prompt-injection guardrail fields in public-signal JSON:
- `promptInjectionScore`
- `promptInjectionFlags`
- `isSuspectedPromptInjection`

Configured source families include:
- community-market sources (Reddit local signals, Meta Marketplace listings via manual/accessible feeds)
- government auctions (Arizona state surplus, Maricopa local surplus, federal disposals/GSA)
- grants/funding programs (Grants.gov, Arizona Commerce, Phoenix business programs, SBA funding pages)
- small-business financing/rate context (SBA loan program pages and macro-rate context)
- government procurement/buildout signals (SAM opportunities, Arizona procurement portal, Phoenix/Maricopa bid pages)
- federal/state assistance datasets (USASpending explorer, Data.gov assistance catalog, HUD/EDA/DOE funding pages)
- community assistance demand signals (Craigslist + Reddit pottery/studio assistance watches)
- Maricopa Treasurer delinquent roll
- Maricopa Recorder trustee/legal notices
- Arizona UCC + bankruptcy filings
- Maricopa civil court foreclosure/receivership
- Maricopa assessor ownership-history signals
- utility capacity constraints
- code enforcement + permitting pipeline
- lease-comps/vacancy feeds
- CMBS distress feeds
- environmental/land-use constraints

Environment variables expected for remote URLs (set what you have now, add more over time):
- `REAL_ESTATE_SRC_AZ_STATE_AUCTIONS_URL`
- `REAL_ESTATE_SRC_MARICOPA_LOCAL_AUCTIONS_URL`
- `REAL_ESTATE_SRC_FEDERAL_AUCTIONS_URL`
- `REAL_ESTATE_SRC_REDDIT_COMMUNITY_URL`
- `REAL_ESTATE_SRC_META_MARKETPLACE_URL`
- `REAL_ESTATE_SRC_GRANTS_GOV_URL`
- `REAL_ESTATE_SRC_AZ_COMMERCE_GRANTS_URL`
- `REAL_ESTATE_SRC_PHOENIX_GRANTS_URL`
- `REAL_ESTATE_SRC_SBA_GRANTS_URL`
- `REAL_ESTATE_SRC_SBA_LOAN_PROGRAMS_URL`
- `REAL_ESTATE_SRC_HUD_GRANTS_URL`
- `REAL_ESTATE_SRC_EDA_GRANTS_URL`
- `REAL_ESTATE_SRC_DOE_FUNDING_URL`
- `REAL_ESTATE_SRC_DATA_GOV_BUSINESS_ASSISTANCE_URL`
- `REAL_ESTATE_SRC_USASPENDING_ASSISTANCE_URL`
- `REAL_ESTATE_SRC_SAM_GOV_CONTRACT_OPPORTUNITIES_URL`
- `REAL_ESTATE_SRC_AZ_STATE_PROCUREMENT_PORTAL_URL`
- `REAL_ESTATE_SRC_CITY_PHOENIX_PROCUREMENT_BIDS_URL`
- `REAL_ESTATE_SRC_MARICOPA_COUNTY_PROCUREMENT_URL`
- `REAL_ESTATE_SRC_CRAIGSLIST_POTTERY_ASSISTANCE_SIGNALS_URL`
- `REAL_ESTATE_SRC_REDDIT_POTTERY_ASSISTANCE_SIGNALS_URL`
- `REAL_ESTATE_SRC_MARICOPA_TREASURER_URL`
- `REAL_ESTATE_SRC_MARICOPA_RECORDER_URL`
- `REAL_ESTATE_SRC_AZ_UCC_URL`
- `REAL_ESTATE_SRC_AZ_BANKRUPTCY_URL`
- `REAL_ESTATE_SRC_MARICOPA_COURT_URL`
- `REAL_ESTATE_SRC_MARICOPA_ASSESSOR_URL`
- `REAL_ESTATE_SRC_UTILITY_CAPACITY_URL`
- `REAL_ESTATE_SRC_CODE_ENFORCEMENT_URL`
- `REAL_ESTATE_SRC_PERMIT_PIPELINE_URL`
- `REAL_ESTATE_SRC_LEASE_COMPS_URL`
- `REAL_ESTATE_SRC_CMBS_URL`
- `REAL_ESTATE_SRC_ENVIRONMENTAL_URL`

Public-data auth adapter support:
- fetch layer now supports per-source auth modes: `bearer`, `header`, `cookie`, `query`.
- credential rotation is supported via primary/secondary env vars or a packed rotation env var (`*_ROTATION`) with comma/semicolon-separated values.
- URL overrides can be provided via explicit source `urlEnv` or derived key convention:
  - `REAL_ESTATE_SRC_<SOURCE_KEY_UPPER_SNAKE>_URL`

You can also set per-source `localPath` in the config for local CSV/JSON drops.
Blocked endpoints can be fed through manual CSV drops in:
- `output/real-estate/manual-drops`
- includes dedicated templates for blocked grant, community-market, and government-auction sources (state, local, federal).

## Macro Context Pack (Rates + CRE Trend + ACS Baseline)
Build macro context from free/public pull artifacts:

```powershell
pwsh -File scripts/build-real-estate-macro-context.ps1 `
  -PublicDataManifestPath "output/real-estate/public-data/latest-manifest.json" `
  -OutputDir "output/real-estate"
```

Outputs:
- `output/real-estate/macro-context-<timestamp>.json`
- `output/real-estate/macro-context-<timestamp>.md`
- `output/real-estate/macro-context-latest.json`

`run-real-estate-agentic-research.ps1` attaches this macro context when present.

## Studio Needs Context (Versioned + Time Aware)
Maintain a versioned profile of current and future studio expansion requirements:

- `docs/real-estate/studio-needs-profile.json`
- `docs/real-estate/intelligence-weights.json`

Build the deterministic needs context:

```powershell
pwsh -File scripts/build-real-estate-needs-context.ps1 `
  -NeedsProfilePath "docs/real-estate/studio-needs-profile.json" `
  -OutputDir "output/real-estate" `
  -PublicSignalsPath "output/real-estate/public-signals-latest.json"
```

Outputs:
- `output/real-estate/needs-context-<timestamp>.json`
- `output/real-estate/needs-context-<timestamp>.md`
- `output/real-estate/needs-context-latest.json`

This context computes:
- active vs next profile
- demand pressure triggers from studio operational signals
- escalation recommendation for when growth requirements should be treated as current

## Intelligence Analysis Layer (Model-Free, Agent-Aware)
Compile all available context into deterministic opportunity intelligence and task planning:

```powershell
pwsh -File scripts/run-real-estate-intelligence-analysis.ps1 `
  -OutputDir "output/real-estate" `
  -PublicSignalsPath "output/real-estate/public-signals-latest.json" `
  -ParcelGraphPath "output/real-estate/parcel-graph-latest.json" `
  -MacroContextPath "output/real-estate/macro-context-latest.json" `
  -NeedsContextPath "output/real-estate/needs-context-latest.json" `
  -WeightsPath "docs/real-estate/intelligence-weights.json"
```

Outputs:
- `output/real-estate/intelligence-analysis-<timestamp>.json`
- `output/real-estate/intelligence-analysis-<timestamp>.md`
- `output/real-estate/intelligence-analysis-latest.json`
- `output/real-estate/intelligence-task-queue-latest.json`
- `output/real-estate/intelligence-entity-state-latest.json`

The analysis layer is deterministic and avoids per-run model calls while still producing:
- explainable opportunity scores
- confidence and urgency scoring
- capability-fit checks against changing studio requirements
- agent-ready task queue with acceptance criteria

## Opportunities Research Layer (Wide-Net, Skepticism-First)
Track long-effort, low-risk, high-upside opportunities across grants, programs, rates, procurement/buildout requests, and community assistance asks.

```powershell
pwsh -File scripts/run-real-estate-opportunity-research.ps1 `
  -OutputDir "output/real-estate" `
  -ConfigPath "docs/real-estate/opportunity-research-config.json" `
  -PublicSignalsPath "output/real-estate/public-signals-latest.json" `
  -AgenticResearchPath "output/real-estate/agentic-research-latest.json" `
  -PublicDataManifestPath "output/real-estate/public-data/latest-manifest.json" `
  -MacroContextPath "output/real-estate/macro-context-latest.json"
```

Outputs:
- `output/real-estate/opportunity-research-<timestamp>.json`
- `output/real-estate/opportunity-research-<timestamp>.md`
- `output/real-estate/opportunity-research-latest.json`
- `output/real-estate/opportunity-research-task-queue-latest.json`

Safety posture:
- every record is treated as suspect until verified
- each opportunity includes `skepticismScore` and `verificationStatus`
- high-skepticism items are forced into manual verification before action

## Human Review Packet + Steering Log
Build a human-review packet from latest intelligence outputs:

```powershell
pwsh -File scripts/run-real-estate-review-packet.ps1 `
  -OutputDir "output/real-estate" `
  -IntelligencePath "output/real-estate/intelligence-analysis-latest.json" `
  -NeedsContextPath "output/real-estate/needs-context-latest.json"
```

Outputs:
- `output/real-estate/intelligence-review-packet-<timestamp>.json`
- `output/real-estate/intelligence-review-packet-<timestamp>.md`
- `output/real-estate/intelligence-review-packet-latest.json`

This packet is channel-agnostic for Portal/Discord/CLI and includes:
- easy opportunity cards with score/confidence/urgency and fit-now/fit-future
- fixed human action set for steering (`approve_next_step`, `hold`, `reject`, `request_more_evidence`, `change_constraints`, `change_risk_mode`)
- `whatChangedSinceLastRun` deltas for fast triage

Append a steering decision:

```powershell
pwsh -File scripts/add-intelligence-steering-entry.ps1 `
  -OutputDir "output/real-estate" `
  -OpportunityId "opp-..." `
  -Action "request_more_evidence" `
  -ReasonCode "missing_power_specs" `
  -Notes "Need verified amp service before outreach."
```

Steering log outputs:
- `output/real-estate/intelligence-steering-log.jsonl`
- `output/real-estate/intelligence-steering-log-latest.json`

## Future Coordination Interfaces (Design Constraint)
These outputs are designed to be consumed by a StudioBrain-style coordinator that routes work between humans and autonomous agents via:
- Discord
- CLI
- Portal UI

Keep output contracts stable (`*-latest.json` files and source/score fields) so channel adapters can be added without rewriting research logic.

## Parcel Graph Foundation
Build a parcel/owner graph from the latest structured signal run:

```powershell
pwsh -File scripts/build-real-estate-parcel-graph.ps1 `
  -PublicSignalsPath "output/real-estate/public-signals-latest.json" `
  -OutputDir "output/real-estate"
```

Outputs:
- `output/real-estate/parcel-graph-<timestamp>.json`
- `output/real-estate/parcel-graph-<timestamp>.md`
- `output/real-estate/parcel-graph-latest.json`

This provides a parcel-centric ranking layer for agent-swarm targeting and negotiation sequencing.

## Entity Resolution Enrichment (LLC + Link Confidence)
Build normalized entity resolution from signals + parcel graph:

```powershell
pwsh -File scripts/build-real-estate-entity-resolution.ps1 `
  -PublicSignalsPath "output/real-estate/public-signals-latest.json" `
  -ParcelGraphPath "output/real-estate/parcel-graph-latest.json" `
  -OutputDir "output/real-estate"
```

Outputs:
- `output/real-estate/entity-resolution-latest.json`
- `output/real-estate/entity-resolution-latest.md`

## Recorder Anti-Bot Fallback Adapter
Maintain a manual recorder export template and stage it into canonical signal ingestion:

```powershell
pwsh -File scripts/run-recorder-fallback-adapter.ps1 `
  -ManualDir "output/real-estate/manual-drops/recorder-fallback" `
  -StagingDir "output/real-estate/staging/public-signals" `
  -OutputDir "output/real-estate"
```

Outputs:
- `output/real-estate/recorder-fallback-latest.json`
- template: `output/real-estate/manual-drops/recorder-fallback/recorder-export.csv`
- staged adapter file: `output/real-estate/staging/public-signals/maricopa_recorder_document_feed.csv`

## StudioBrain Coordinator Contracts
Build channel command contracts + execution queue for Discord/CLI/Portal:

```powershell
pwsh -File scripts/build-studiobrain-coordinator-adapters.ps1 `
  -OutputDir "output/real-estate" `
  -ReviewPacketPath "output/real-estate/intelligence-review-packet-latest.json" `
  -IntelligencePath "output/real-estate/intelligence-analysis-latest.json" `
  -AssetWatchlistPath "output/real-estate/studio-asset-watchlist-latest.json"
```

Output:
- `output/real-estate/studiobrain-coordinator-latest.json`

## Cadence
- Weekly while actively searching.
- Biweekly otherwise.
- Quarterly: generate trend + swarm context pack.
- Weekly: refresh free/public data pulls and staged adapters.
- Weekly or faster during market stress: run agentic research scan.
- Weekly (or daily during stress): refresh structured public signals.
- Weekly: refresh parcel graph for swarm context.
- Weekly: refresh entity-resolution enrichment for parcel/owner linkage confidence.
- Weekly: refresh local studio asset intelligence (meta/reddit/newsletter feed weighted).
- Weekly: seed/check studio-asset manual-drop templates and pull direct community/newsletter feeds to staging.
- Weekly: refresh needs context from versioned studio requirements and ops pressure signals.
- Weekly: run skepticism-first opportunities research (grants/programs/rates/procurement/community asks).
- Weekly: run model-free intelligence analysis and publish latest task queue/entity state.
- Weekly: build human review packet for decisioning and steering.
- Weekly: refresh StudioBrain coordinator contracts.

Single-command weekly run:

```powershell
pwsh -File scripts/run-real-estate-weekly-cadence.ps1 `
  -OutputDir "output/real-estate" `
  -PublicDataDir "output/real-estate/public-data" `
  -StagingDir "output/real-estate/staging/public-signals" `
  -ManualDropDir "output/real-estate/manual-drops"
```

Weekly run manifests:
- `output/real-estate/weekly-cadence-<timestamp>.json`
- `output/real-estate/weekly-cadence-latest.json`

## Live Data Notes
- Pull listings from your preferred sources and export to CSV.
- Keep private/sensitive negotiation notes out of committed files.
- If needed, keep raw source exports local and only commit sanitized summaries.

## Testing Harness and Validation Workflow
Fast contract checks on latest artifacts:

```powershell
pwsh -File scripts/test-real-estate-contracts.ps1 `
  -OutputDir "output/real-estate"
```

Deterministic studio-asset harness (needed/wanted boosts + carry-forward continuity):

```powershell
pwsh -File scripts/test-studio-asset-intel-harness.ps1 `
  -ConfigPath "docs/real-estate/studio-asset-intel-config.json" `
  -PriorityListPath "docs/real-estate/studio-needed-wanted-list.json"
```

Unified suite runner:

```powershell
pwsh -File scripts/run-real-estate-test-suite.ps1 `
  -OutputDir "output/real-estate"
```

Optional full-run + tests:

```powershell
pwsh -File scripts/run-real-estate-test-suite.ps1 `
  -OutputDir "output/real-estate" `
  -RunCadence
```

Suite reports:
- `output/real-estate/test-suite-<timestamp>.json`
- `output/real-estate/test-suite-latest.json`
