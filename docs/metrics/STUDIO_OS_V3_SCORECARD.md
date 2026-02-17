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
| Proposal decision latency (avg) | >= 60 minutes | >= 240 minutes | Policy Desk | governance-primary |
| Audit completeness | <= 98% | <= 90% | Compliance | trust-safety-primary |
| Tenant context completeness | <= 99% | <= 95% | Platform | platform-primary |
| Connector health | <= 99% healthy | <= 80% healthy | Integrations | platform-primary |

## Events
- `studio_ops.scorecard_computed`
- `studio_ops.scorecard_breach`
- `studio_ops.scorecard_recovered`

These events are emitted through the Studio Brain scorecard endpoint and stored in the audit timeline.

## Monthly Review Template
1. Review metric trend for previous month and current month.
2. List every breach and recovery with timestamp and reason code.
3. Capture top three causes and prevention actions.
4. Record owner updates and on-call routing changes.
5. Publish follow-up action items with due dates.
