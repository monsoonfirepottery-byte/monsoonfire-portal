# P2 - Studio Expansion Real-Estate Market Watch and Fit Scoring

Status: Completed
Date: 2026-02-17

## Problem
Expansion timing is currently ad-hoc. We need a repeatable way to track West Valley/Phoenix warehouse and light-industrial opportunities while keeping the home studio as the default cost-effective baseline.

## Objective
Create a lightweight, repeatable market-watch workflow that turns listing snapshots into ranked expansion candidates with explicit fit notes and trend visibility.

## Scope
- Listing snapshot schema and data dictionary
- Local scoring/report script for expansion fit
- Weekly or biweekly cadence runbook
- Output artifacts for decision review (JSON + Markdown summary)

## Tasks
1. Define listing schema and minimum required fields:
   - geography (city/submarket)
   - cost (monthly rent and/or NNN psf)
   - suitability (sqft, zoning, power, clear height, doors)
   - listing link and notes.
2. Implement market-watch script:
   - parse CSV snapshots
   - compute fit score and fit tier
   - output ranked summary artifacts.
3. Add a runbook with command examples and scoring rubric.
4. Execute first live snapshot run and publish top watchlist.
5. Track trend metrics over time:
   - median ask rent
   - median ask psf
   - count of viable listings.

## Acceptance
- A script can process listing CSV input and emit a ranked summary.
- A runbook exists with the exact command to run and expected outputs.
- First live snapshot is captured and reviewable in one artifact.
- At least one trend comparison is possible between two snapshot runs.

## Dependencies
- `docs/ENGINEERING_TODOS.md`
- `docs/REAL_ESTATE_MARKET_WATCH.md`
- `scripts/run-real-estate-market-watch.ps1`

## Completion evidence (2026-02-28)
1. Listing schema, scoring model, and operator commands are documented in `docs/REAL_ESTATE_MARKET_WATCH.md`.
2. Market-watch processor is implemented in `scripts/run-real-estate-market-watch.ps1` with fit scoring/tiering and ranked outputs.
3. Historical artifacts exist in `output/real-estate/market-watch-*.json` and feed trend rollups via `output/real-estate/market-watch-history.csv`.
4. Quarterly trend handoff from market-watch snapshots is implemented (`scripts/build-real-estate-quarterly-context.ps1`).
