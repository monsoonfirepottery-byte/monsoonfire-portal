# Studio Brain Ops Tuning (Always-On Laptop)

These are practical defaults for running `studio-brain` continuously on a developer workstation.

## Recommended `.env` Baseline
```env
STUDIO_BRAIN_LOG_LEVEL=info
STUDIO_BRAIN_JOB_INTERVAL_MS=900000
STUDIO_BRAIN_JOB_INITIAL_DELAY_MS=0
STUDIO_BRAIN_JOB_JITTER_MS=1000
STUDIO_BRAIN_SCAN_LIMIT=2000
STUDIO_BRAIN_FIRESTORE_QUERY_TIMEOUT_MS=20000

STUDIO_BRAIN_REQUIRE_FRESH_SNAPSHOT_FOR_READY=true
STUDIO_BRAIN_READY_MAX_SNAPSHOT_AGE_MINUTES=240

STUDIO_BRAIN_ENABLE_RETENTION_PRUNE=true
STUDIO_BRAIN_RETENTION_DAYS=180

STUDIO_BRAIN_PG_POOL_MAX=10
STUDIO_BRAIN_PG_IDLE_TIMEOUT_MS=30000
STUDIO_BRAIN_PG_CONNECTION_TIMEOUT_MS=10000

STUDIO_BRAIN_BUDGET_WINDOW_MINUTES=60
STUDIO_BRAIN_BUDGET_MAX_FAILURES_PER_HOUR=3
STUDIO_BRAIN_BUDGET_MAX_CRITICAL_FAILURES_PER_HOUR=1
STUDIO_BRAIN_BUDGET_MAX_SLOW_RUNS_PER_HOUR=3
STUDIO_BRAIN_BUDGET_MAX_RUN_DURATION_MS=30000
```

## Operational Checks
- `GET /healthz` should stay `200`.
- `GET /readyz` should stay `200` except during cloud/DB outages.
- `GET /api/metrics` should show stable RSS/heap over time.
- `GET /api/status` should show progressing job runs without continuous failures.
- `npm run studio:check:safe -- --json` includes per-endpoint correlation IDs (`endpoints[].correlation`) for traceability.

## Correlation-ID Parsing Shortcuts

```bash
# show request/trace IDs captured by status probes
npm run studio:check:safe -- --json | jq '.endpoints[] | {name, correlation}'

# tail destructive action audit entries
tail -n 20 output/ops-audit/destructive-actions.log
```

## Soak Workflow
1. Run service: `npm start`
2. Run soak monitor: `npm run soak`
3. Watch:
   - `ready` availability
   - p95/p99 latency
   - max RSS / heap
   - recurring warning bursts in snapshots

## Failure Signals Worth Paging Yourself For
- `readyz` consistently `503` for > 5 minutes.
- `scheduler.consecutiveFailures` climbs and does not reset.
- `snapshot.warningCount` continuously rises.
- RSS trends upward for multiple hours without returning to baseline.

## Self-Healing Watch Loop

Use the reliability watcher as the default local heartbeat loop:

```bash
npm run reliability:watch -- --interval-ms 60000 --stop-on-failure
```

This gives:
- rolling status summaries in `output/stability/heartbeat-summary.json`
- append-only events in `output/stability/heartbeat-events.log`
- auto incident bundles in `output/incidents/` on critical failure
- rolling budget posture (`summary.stabilityBudget`) with auto-pause when budget is exceeded

## Restart and Escalation Playbook

| Fault pattern | Immediate action | Escalation threshold |
| --- | --- | --- |
| repeated `/readyz` failures | restart Studio Brain process, run `npm run studio:check:safe -- --json` | escalate if 5+ consecutive failures or > 5 minutes continuous red |
| dependency degraded (`postgres` / `redis` / `minio`) | run `npm run preflight`, restart affected container/service only | escalate if same dependency degrades 3 times in 30 minutes |
| container flapping (`otel-collector` or core deps) | run `docker compose -f studio-brain/docker-compose.yml ps` and inspect restart count + logs | escalate if 3+ restarts in 10 minutes for same service |
| host routing drift | run `npm run studio:stack:profile:snapshot:strict -- --json` | escalate if strict snapshot fails after one clean restart cycle |

When escalation is required, capture:
1. `npm run incident:bundle -- --json`
2. latest `output/stability/heartbeat-summary.json`
3. latest `output/studio-stack-profile/latest.json`

## Destructive Action Guardrails

Destructive reset commands require explicit acknowledgement and are audit-logged:

```bash
npm run studio:observability:reset -- --yes-i-know --reason "maintenance-window"
npm run ops:cockpit:reset -- --yes-i-know --reason "clear-local-state"
```

Audit trail:
- `output/ops-audit/destructive-actions.log`
