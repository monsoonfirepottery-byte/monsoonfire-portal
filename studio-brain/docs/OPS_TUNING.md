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
```

## Operational Checks
- `GET /healthz` should stay `200`.
- `GET /readyz` should stay `200` except during cloud/DB outages.
- `GET /api/metrics` should show stable RSS/heap over time.
- `GET /api/status` should show progressing job runs without continuous failures.

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
