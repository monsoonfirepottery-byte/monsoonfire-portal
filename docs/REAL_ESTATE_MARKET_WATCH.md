# Real Estate Market Watch (West Valley / Phoenix)

Date: 2026-02-17
Owner: Studio Ops
Status: Active

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
- scores leads by expansion fit + distress signal intensity
- emits a swarm-ready context package with prioritized leads and recommended next actions.

Outputs:
- `output/real-estate/agentic-research-<timestamp>.json`
- `output/real-estate/agentic-research-<timestamp>.md`
- `output/real-estate/agent-swarm-research-context-<timestamp>.json`

## Cadence
- Weekly while actively searching.
- Biweekly otherwise.
- Quarterly: generate trend + swarm context pack.
- Weekly or faster during market stress: run agentic research scan.

## Live Data Notes
- Pull listings from your preferred sources and export to CSV.
- Keep private/sensitive negotiation notes out of committed files.
- If needed, keep raw source exports local and only commit sanitized summaries.
