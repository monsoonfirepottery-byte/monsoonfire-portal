# Studio OS v3 Incident Drills (Security Chaos + Tabletop)

## Purpose
Validate safe-failure paths for auth, connectors, policy, and local state corruption without touching production data.

## Scenarios (Quarterly)
1. Token compromise
2. Connector outage
3. Policy bypass attempt
4. Local DB corruption

## Drill Checklist
- Scenario ID + start time
- Targeted systems + scope
- Expected safe-failure behavior
- Observed behavior + gaps
- Action items (owner + due date)
- End time + MTTR

## Staging Chaos Scripts
Run only in staging:
- `studio-brain/scripts/chaos/kill_switch_toggle.mjs`
- `studio-brain/scripts/chaos/connector_timeout_storm.mjs`
- `studio-brain/scripts/chaos/delegation_revocation_race.mjs`

Guards:
- `CHAOS_MODE=true`
- `NODE_ENV=staging`
- `STUDIO_BRAIN_ADMIN_TOKEN` set

## Tabletop Guidance
- Document assumptions and rollback steps.
- Verify audit trail: `studio_ops.*` and `capability.*` events recorded.
- Confirm portal stays usable when Studio Brain is offline.

## Metrics to Capture
- MTTR target
- Safety breach count
- Deny/allow error rates for privileged endpoints

## Drill Event Capture
Optionally log drill events in Studio Brain for audit trail:
```
POST /api/ops/drills
{
  "scenarioId": "connector_outage",
  "status": "started|completed",
  "outcome": "success|partial|failed",
  "notes": "short summary",
  "mttrMinutes": 42,
  "unresolvedRisks": ["follow-up action id"]
}
```

Log results in `docs/DRILL_EXECUTION_LOG.md`.
