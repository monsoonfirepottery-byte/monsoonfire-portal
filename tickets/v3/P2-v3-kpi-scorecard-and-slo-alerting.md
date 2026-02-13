# P2: KPI Scorecard + SLO Alerting for Studio OS

## Goal
Operationalize v3 with a scorecard and alert thresholds tied to safety and reliability objectives.

## Non-goals
- No external analytics vendor dependency required.
- No executive BI reporting suite.

## Acceptance Criteria
- Scorecard includes snapshot freshness, proposal decision latency, audit completeness, connector health.
- Thresholds define warning/critical states with owner on-call routing notes.
- Staff cockpit displays latest SLO status and last breach timestamp.
- Monthly review template added for trend analysis.

## Files/Dirs
- `docs/metrics/STUDIO_OS_V3_SCORECARD.md`
- `web/src/views/staff/**` (cockpit widget)
- `studio-brain/src/observability/**`

## Tests
- Unit tests for score computation logic.
- UI tests for warning/critical rendering and empty-state behavior.

## Security Notes
- KPI views must not leak sensitive identifiers.
- Alert payloads should include hashes/IDs, not raw personal data.

## Dependencies
- `P0-v3-observability-baseline.md`
- `P2-v3-os-cockpit-consolidation.md`

## Estimate
- Size: S

## Telemetry / Audit Gates
- Daily scorecard computation event stored in audit timeline.
- Threshold breach and recovery events with reason codes.

## Rollback
- Hide scorecard widgets while retaining raw observability events.
- Continue manual review using baseline logs.
