# P2 - Studio Real-Estate Agentic Research and Distress Scanner

Status: Open
Date: 2026-02-17

## Problem
Manual snapshot collection is useful but reactive. We need an autonomous research layer that proactively scans for local property opportunities and flags distressed-market conditions.

## Objective
Add a local agentic research workflow that continuously searches West Valley/Phoenix industrial inventory, scores potential opportunities, and emits a swarm-ready context payload.

## Scope
- Automated web search query orchestration
- Distress keyword and opportunity signal scoring
- Prioritized lead outputs for human and agent review
- Context payload designed for real-estate agent swarm planning

## Tasks
1. Implement research script with configurable city/query strategy.
2. Add distress signal model:
   - price reduced
   - foreclosure or auction
   - motivated seller
   - sublease and vacancy pressure
   - urgent timeline phrases.
3. Add fit scoring model aligned with studio expansion priorities.
4. Emit machine and human artifacts:
   - JSON full lead set
   - markdown summary
   - swarm context pack.
5. Link this workflow in runbook and TODO pinned list.

## Acceptance
- Script can run locally and produce ranked local leads.
- Distress and fit scores are explicit and explainable per lead.
- Swarm context JSON can be used directly as input for downstream autonomous agent work.
- Workflow is documented and repeatable.

## Dependencies
- `docs/REAL_ESTATE_MARKET_WATCH.md`
- `scripts/run-real-estate-agentic-research.ps1`
- `tickets/P2-studio-real-estate-market-watch-and-expansion-fit.md`
