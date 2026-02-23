# Studio OS v3 Scorecard + SLO Alerting

## Scope
- Snapshot freshness
- Proposal decision latency
- Audit completeness
- Tenant context completeness
- Connector health

## Thresholds
| Metric | Warning | Critical | Owner | On-call |
| --- | --- | --- | --- | --- |
| Snapshot freshness | >= 30 minutes | >= 120 minutes | Studio Ops | ops-primary |
| Readiness ratio (5m window) | < 99% | < 95% | Platform | platform-primary |
| Core dependency health (postgres/redis/minio) | any `degraded` | any `error` for > 5 minutes | Platform | platform-primary |
| Proposal decision latency (avg) | >= 60 minutes | >= 240 minutes | Policy Desk | governance-primary |
| Audit completeness | <= 98% | <= 90% | Compliance | trust-safety-primary |
| Tenant context completeness | <= 99% | <= 95% | Platform | platform-primary |
| Connector health | <= 99% healthy | <= 80% healthy | Integrations | platform-primary |

## Events
- `studio_ops.scorecard_computed`
- `studio_ops.scorecard_breach`
- `studio_ops.scorecard_recovered`

These events are emitted through the Studio Brain scorecard endpoint and stored in the audit timeline.

## Local Observability Contract Checks

Use these deterministic checks before operator handoff:

1. `npm run studio:observability:up`
2. `npm run studio:stack:profile:snapshot:strict -- --json --artifact output/studio-stack-profile/latest.json`
3. `npm run reliability:once -- --json`
4. `npm run studio:observability:status -- --json`

Expected artifacts:
- `output/stability/heartbeat-summary.json`
- `output/stability/heartbeat-events.log`
- `output/studio-stack-profile/latest.json`
- `output/otel/traces.jsonl`

## Monthly Review Template
1. Review metric trend for previous month and current month.
2. List every breach and recovery with timestamp and reason code.
3. Capture top three causes and prevention actions.
4. Record owner updates and on-call routing changes.
5. Publish follow-up action items with due dates.
