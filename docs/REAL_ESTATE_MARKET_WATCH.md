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

## Cadence
- Weekly while actively searching.
- Biweekly otherwise.

## Live Data Notes
- Pull listings from your preferred sources and export to CSV.
- Keep private/sensitive negotiation notes out of committed files.
- If needed, keep raw source exports local and only commit sanitized summaries.
