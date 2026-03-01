# P2 - Free/Public Real-Estate Data Ingestion Pipeline

Status: Completed
Date: 2026-02-17

## Problem
The intelligence stack needs durable free/public inputs that can be refreshed regularly, transformed into signal-ready schemas, and consumed by the parcel graph and agentic scanner.

## Objective
Implement a repeatable free/public data pipeline from source pull to staged signals to swarm-ready context.

## Scope
- Public-data pull script for machine-readable and portal sources
- Staging adapters from raw pulls into source-keyed CSV inputs
- Manual-drop template support for blocked or anti-bot sources
- Macro context pack from public macro datasets
- Integration with existing public-signal and agentic workflows

## Tasks
1. Pull public sources into timestamped run directories with manifest status.
2. Stage normalized source CSVs from pulled artifacts.
3. Generate manual-drop templates for Recorder/UCC/bankruptcy/court/utility/lease/CMBS sources.
4. Build macro context from FRED + Census pulls.
5. Feed staged signals into `run-real-estate-public-signals.ps1`.
6. Attach macro context to `run-real-estate-agentic-research.ps1`.

## Acceptance
- Public pull run produces a manifest with per-source status.
- Staging run outputs source-key CSV files under `output/real-estate/staging/public-signals`.
- Manual-drop templates exist under `output/real-estate/manual-drops`.
- Macro context outputs are produced and visible in agentic swarm context when present.

## Dependencies
- `scripts/fetch-real-estate-public-data.ps1`
- `scripts/build-real-estate-public-signal-staging.ps1`
- `scripts/run-real-estate-public-signals.ps1`
- `scripts/build-real-estate-macro-context.ps1`
- `scripts/run-real-estate-agentic-research.ps1`
- `docs/REAL_ESTATE_MARKET_WATCH.md`

## Completion evidence (2026-02-28)
1. Public pull pipeline is implemented in `scripts/fetch-real-estate-public-data.ps1` with manifest output and auth-adapter support.
2. Staging adapters and manual-drop template generation are implemented in `scripts/build-real-estate-public-signal-staging.ps1`.
3. Macro context generation is implemented in `scripts/build-real-estate-macro-context.ps1`.
4. Staged signals feed structured scoring (`scripts/run-real-estate-public-signals.ps1`) and downstream research (`scripts/run-real-estate-agentic-research.ps1`).
5. Existing artifacts show completed pipeline runs under `output/real-estate/public-data/`, `output/real-estate/staging/public-signals/`, and `output/real-estate/public-signals-*.json`.
