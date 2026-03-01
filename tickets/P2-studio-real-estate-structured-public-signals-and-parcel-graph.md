# P2 - Structured Public Signals + Parcel Graph for Real-Estate Swarm

Status: Completed
Date: 2026-02-17

## Problem
Search-only discovery is useful but not enough for durable opportunity detection. We need parcel-level structured distress and regulatory signals to prioritize outreach during market stress windows.

## Objective
Ingest structured government/market datasets, normalize to a shared schema, and build a parcel-centric graph that the agent swarm can use for proactive opportunity hunting.

## Scope
- Structured source config + ingestion pipeline for tax/legal/court/utility/permitting/finance/environment signals
- Normalized `signal` schema with explicit scoring and priority
- Parcel + owner graph rollup from latest signals
- Integration into agentic research output/context
- Runbook/TODO updates

## Tasks
1. Add source configuration file for structured feeds with per-source field maps and cadence.
2. Implement public-signal ingestion script with:
   - CSV/JSON support
   - URL env-var overrides + local file fallback
   - normalized signal records + scoring model
   - run artifacts (JSON + markdown + latest pointer files).
3. Implement parcel-graph builder script that groups signals by parcel and owner.
4. Integrate structured signal leads into `run-real-estate-agentic-research.ps1`.
5. Document operational flow and required env vars in runbook.

## Acceptance
- Public signals can be ingested from configured sources into a normalized output artifact.
- Parcel graph outputs ranked high-priority parcels from latest signals.
- Agentic research run consumes `public-signals-latest.json` when present.
- Operator docs list source setup and cadence.

## Dependencies
- `docs/REAL_ESTATE_MARKET_WATCH.md`
- `docs/real-estate/public-signal-sources.json`
- `scripts/run-real-estate-public-signals.ps1`
- `scripts/build-real-estate-parcel-graph.ps1`
- `scripts/run-real-estate-agentic-research.ps1`

## Completion evidence (2026-02-28)
1. Structured source config exists at `docs/real-estate/public-signal-sources.json`.
2. Public signal ingestion is implemented in `scripts/run-real-estate-public-signals.ps1` with scoring and prompt-injection guardrails.
3. Parcel-owner rollup graph is implemented in `scripts/build-real-estate-parcel-graph.ps1`.
4. Agentic research integrates structured signals in `scripts/run-real-estate-agentic-research.ps1`.
5. Outputs are present in `output/real-estate/public-signals-latest.json` and `output/real-estate/parcel-graph-latest.json`.
