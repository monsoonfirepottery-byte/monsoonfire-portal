# P2 - Studio Real-Estate Quarterly Trends and Agent Context Pack

Status: Open
Date: 2026-02-17

## Problem
We have snapshot artifacts but no consistent quarterly rollup to guide strategy, and no normalized context package for agent swarms.

## Objective
Turn historical market-watch snapshots into quarterly trend reports and a machine-readable context pack for real-estate agent swarm planning.

## Scope
- Build history CSV from snapshot JSON artifacts
- Compute quarter-over-quarter trend deltas
- Publish quarterly markdown report
- Emit agent-context JSON designed for autonomous swarm prompts

## Tasks
1. Build trend script over `output/real-estate/market-watch-*.json`.
2. Produce `market-watch-history.csv` with one row per run.
3. Produce `real-estate-quarterly-report-YYYY-QX.md` with:
   - listing volume trend
   - median monthly rent trend
   - median $/sf trend
   - viable fit trend.
4. Produce `agent-swarm-context-YYYY-QX.json`:
   - latest snapshot summary
   - quarter summary array
   - QoQ deltas
   - top candidates and links.
5. Add runbook docs and TODO pin updates.

## Acceptance
- Quarterly report and context JSON generate successfully from historical snapshots.
- QoQ deltas are explicit for pricing and viable supply.
- Agent swarm can use context JSON directly without manual cleanup.
- Workflow is documented and repeatable.

## Dependencies
- `tickets/P2-studio-real-estate-market-watch-and-expansion-fit.md`
- `docs/REAL_ESTATE_MARKET_WATCH.md`
- `scripts/build-real-estate-quarterly-context.ps1`
