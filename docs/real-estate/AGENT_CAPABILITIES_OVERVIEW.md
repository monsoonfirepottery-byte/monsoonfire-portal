# Real Estate Intelligence Agent Capabilities Overview

Date: 2026-02-17  
Scope: West Valley / Phoenix expansion intelligence system

## Purpose
Provide one high-level, operational map of what the real-estate intelligence stack can do today, what files each stage owns, and how humans steer agent execution.

## System capabilities (current)
1. Pulls free/public data and stages normalized source feeds.
2. Scores structured public signals with prompt-injection guardrails.
3. Builds macro context and parcel graph context layers.
4. Runs agentic research discovery for opportunity and distress signals.
5. Maintains time-aware studio needs context with profile versioning.
6. Produces deterministic, explainable intelligence ranking and task queues.
7. Produces a human review packet with fixed steering actions.
8. Persists steering decisions in a normalized log for agent consumption.
9. Scans local asset channels for heavy pottery equipment opportunities where local pickup matters.
10. Prioritizes opportunities using a maintained needed/wanted list and loose consumables status.
11. Provides local test harness scripts for contract validation and deterministic asset behavior checks.
12. Supports authenticated source adapters with credential rotation for gated feeds.
13. Adds parcel/entity resolution enrichment and recorder fallback staging for anti-bot resilience.
14. Produces StudioBrain channel command contracts for Discord/CLI/Portal adapters.

## Trust and safety boundaries
1. Community feeds are low-trust and corroboration-gated.
2. Prompt-injection screening runs on public/community signal text.
3. Flagged community prompt-injection rows are blocked before ranking.
4. High-score suspicious rows are excluded from downstream lead merge.

## End-to-end pipeline order
1. `scripts/fetch-real-estate-public-data.ps1`
2. `scripts/seed-real-estate-manual-drops.ps1`
3. `scripts/build-real-estate-public-signal-staging.ps1`
4. `scripts/run-real-estate-public-signals.ps1`
5. `scripts/build-real-estate-macro-context.ps1`
6. `scripts/build-real-estate-parcel-graph.ps1`
7. `scripts/run-real-estate-agentic-research.ps1`
8. `scripts/run-recorder-fallback-adapter.ps1`
9. `scripts/seed-studio-asset-manual-drops.ps1`
10. `scripts/fetch-studio-asset-community-data.ps1`
11. `scripts/run-studio-asset-intelligence.ps1`
12. `scripts/build-real-estate-needs-context.ps1`
13. `scripts/run-real-estate-intelligence-analysis.ps1`
14. `scripts/run-real-estate-review-packet.ps1`
15. `scripts/build-studiobrain-coordinator-adapters.ps1`
16. Orchestrator: `scripts/run-real-estate-weekly-cadence.ps1`
17. Test suite: `scripts/run-real-estate-test-suite.ps1`

## Primary output contracts
1. Structured signals:
   - `output/real-estate/public-signals-latest.json`
2. Agentic discovery:
   - `output/real-estate/agentic-research-<timestamp>.json`
   - `output/real-estate/agent-swarm-research-context-<timestamp>.json`
3. Needs context:
   - `output/real-estate/needs-context-latest.json`
4. Intelligence analysis:
   - `output/real-estate/intelligence-analysis-latest.json`
   - `output/real-estate/intelligence-task-queue-latest.json`
   - `output/real-estate/intelligence-entity-state-latest.json`
5. Human review:
   - `output/real-estate/intelligence-review-packet-latest.json`
6. Human steering:
   - `output/real-estate/intelligence-steering-log.jsonl`
   - `output/real-estate/intelligence-steering-log-latest.json`
7. Weekly health:
   - `output/real-estate/weekly-cadence-latest.json`
8. Studio asset opportunities:
   - `output/real-estate/studio-asset-intelligence-latest.json`
   - `output/real-estate/studio-asset-watchlist-latest.json`
9. Entity resolution:
   - `output/real-estate/entity-resolution-latest.json`
10. Coordinator contracts:
   - `output/real-estate/studiobrain-coordinator-latest.json`

## Human steering contract
Required steering fields:
1. `opportunityId`
2. `action`
3. `reasonCode`
4. `timestampUtc`

Optional steering fields:
1. `constraintsPatch`
2. `riskMode`
3. `notes`

Allowed actions:
1. `approve_next_step`
2. `hold`
3. `reject`
4. `request_more_evidence`
5. `change_constraints`
6. `change_risk_mode`

Entry script:
`scripts/add-intelligence-steering-entry.ps1`

## Studio needs and scoring controls
Versioned requirements source:
`docs/real-estate/studio-needs-profile.json`

Deterministic intelligence weights and thresholds:
`docs/real-estate/intelligence-weights.json`

Asset needed/wanted + consumables source:
`docs/real-estate/studio-needed-wanted-list.json`

## Agent role intent (current)
1. `scout_verifier_agent`: fill missing utility/facility evidence.
2. `distress_verifier_agent`: corroborate legal/tax/distress posture.
3. `negotiation_agent`: prepare outreach and negotiation posture on high-confidence pursue candidates.
4. `grant_funding_agent`: map grant/funding options to capex/upgrade paths.
5. `asset_scout_agent`: validate local equipment opportunity quality, condition proof, and pickup logistics.

## What this system does not do yet
1. No dedicated frontend review UI yet (artifact-first model).
2. No authenticated/gated source adapters yet.
3. No advanced LLC/entity resolution confidence model yet.
4. No native Discord/Portal command adapter layer yet (contracts are ready).

## Minimum operator workflow
1. Run `scripts/run-real-estate-weekly-cadence.ps1`.
2. Review `output/real-estate/intelligence-review-packet-latest.json` or `.md`.
3. Log steering decisions with `scripts/add-intelligence-steering-entry.ps1`.
4. Let next cadence run consume updated steering context.

## Validation workflow
1. Run contract checks: `scripts/test-real-estate-contracts.ps1`.
2. Run deterministic asset harness: `scripts/test-studio-asset-intel-harness.ps1`.
3. Run unified suite: `scripts/run-real-estate-test-suite.ps1`.
