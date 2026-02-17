# Studio OS v3 Epic Scorecard

Cloud remains authoritative; local computes and proposes; irreversible actions require approval; everything is auditable; system fails safe.

## Scoring Legend
- Value: 1 (low) to 5 (high)
- Risk: 1 (low) to 5 (high)
- Confidence: 1 (low) to 5 (high)

## E01 Studio Brain Control Plane
- Value: 5
- Risk: 3
- Confidence: 4
- Primary KPI: runtime availability, migration success rate
- Go/No-Go: no coupling to cloud runtime paths

## E02 StudioState Model
- Value: 5
- Risk: 3
- Confidence: 4
- Primary KPI: snapshot freshness + drift mismatch rate
- Go/No-Go: derived-state labeling and staleness controls in place

## E03 Capability + Approval Engine
- Value: 5
- Risk: 5
- Confidence: 3
- Primary KPI: approval latency + denied unauthorized attempts
- Go/No-Go: no external write path without policy and audit

## E04 Connector Framework
- Value: 4
- Risk: 4
- Confidence: 3
- Primary KPI: connector health pass rate + error classification quality
- Go/No-Go: read-only enforcement for physical connectors

## E05 Ops Autopilot (Draft)
- Value: 4
- Risk: 2
- Confidence: 4
- Primary KPI: recommendation acceptance rate
- Go/No-Go: throttling and confidence thresholds tuned

## E06 Marketing Swarm (Draft)
- Value: 3
- Risk: 2
- Confidence: 4
- Primary KPI: draft-to-publish cycle time (human approved)
- Go/No-Go: no auto-publish path

## E07 Finance Reconciliation
- Value: 4
- Risk: 3
- Confidence: 3
- Primary KPI: discrepancy detection lead time
- Go/No-Go: read-only data fetch + staff validation loop

## E08 Trust & Safety Assistive
- Value: 4
- Risk: 4
- Confidence: 3
- Primary KPI: triage time reduction, override rates
- Go/No-Go: high-risk categories hard-routed to manual review

## E09 Spec Governance
- Value: 4
- Risk: 2
- Confidence: 5
- Primary KPI: policy lint pass rate
- Go/No-Go: CI enforces metadata for high-risk capabilities

## E10 Cockpit Consolidation
- Value: 5
- Risk: 3
- Confidence: 3
- Primary KPI: staff task completion from single cockpit
- Go/No-Go: fallback surfaces remain available
