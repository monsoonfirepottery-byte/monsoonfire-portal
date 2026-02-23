# Studio Brain (Studio OS v3 P0)

Local-first orchestration runtime for Monsoon Fire Studio OS v3.

## Anchor Mode
- Cloud remains authoritative for identity, payments, and user-facing records.
- Studio Brain computes local snapshots, drafts proposals, and monitors systems.
- External writes require explicit approval unless policy exemption says otherwise.
- Local state is rebuildable from cloud reads + append-only local audit logs.

## Run
1. `cd studio-brain`
2. `npm install`
3. Copy `.env.example` to `.env` and adjust values for your machine.
3. `npm run build`
4. `npm start`

## Endpoints
- `GET /healthz`
- `GET /readyz`
- `GET /dashboard`
- `GET /api/studio-state/latest`
- `GET /api/status`
- `GET /api/metrics`
- `GET /api/capabilities`
- `GET /api/connectors/health`
- `GET /api/capabilities/policy`
- `GET /api/capabilities/policy-lint`
- `GET /api/capabilities/quotas`
- `GET /api/capabilities/audit`
- `GET /api/capabilities/audit/export`
- `GET /api/capabilities/delegation/traces`
- `GET /api/capabilities/rate-limits/events`
- `POST /api/capabilities/proposals`
- `POST /api/capabilities/proposals/:id/approve`
- `POST /api/capabilities/proposals/:id/reject`
- `POST /api/capabilities/proposals/:id/reopen`
- `POST /api/capabilities/proposals/:id/dry-run`
- `POST /api/capabilities/proposals/:id/execute`
- `POST /api/capabilities/proposals/:id/rollback`
- `POST /api/capabilities/policy/kill-switch`
- `POST /api/capabilities/policy/exemptions`
- `POST /api/capabilities/policy/exemptions/:id/revoke`
- `POST /api/capabilities/quotas/:bucket/reset`
- `GET /api/ops/scorecard`
- `GET /api/ops/recommendations/drafts`
- `GET /api/ops/audit`
- `GET /api/ops/drills`
- `POST /api/ops/drills`
- `POST /api/ops/degraded`
- `GET /api/finance/reconciliation/drafts`
- `GET /api/marketing/drafts`
- `POST /api/marketing/drafts/:draftId/review`
- `GET /api/intake/review-queue`
- `POST /api/intake/review-queue/:intakeId/override`
- `POST /api/trust-safety/triage/suggest`
- `POST /api/trust-safety/triage/feedback`
- `GET /api/trust-safety/triage/stats`

## Config
See `src/config/env.ts` for required and optional env vars.
Default local Docker setup in this repo uses `PGPORT=5433` to avoid collision with host Postgres on `5432`.
For direct browser access from Portal dev server, set:
- `STUDIO_BRAIN_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173`
- `STUDIO_BRAIN_ADMIN_TOKEN=<shared-dev-token>` (optional but recommended)
For swarm backend scaffolding, use:
- `STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED=true`
- `STUDIO_BRAIN_VECTOR_STORE_ENABLED=true` (optional)
- `STUDIO_BRAIN_SKILL_SANDBOX_ENABLED=true` (recommended for skill execution)

## Swarm backend docs

1. `docs/SWARM_BACKEND_ARCHITECTURE.md` - component map and handoff notes.
1. `docs/SWARM_BACKEND_SETUP.md` - local compose startup and diagnostics.
1. `docs/SKILL_SECURITY_MODEL.md` - installation, sandbox, and supply-chain controls.
1. `docs/ENVIRONMENT_REFERENCE.md` - backend env reference and defaults.
1. `docs/SWARM_BACKEND_EXTEND_GUIDE.md` - extension patterns for adding checks, events, skills, and policies.
1. `docs/SWARM_BACKEND_DECISIONS.md` - why these design choices were made and what to evolve first.
1. `docs/INDEX.md` - quick documentation routing for next contributors.

Capability endpoints require header:
- `Authorization: Bearer <firebase-id-token>` (must resolve to staff/admin claim)
- `x-studio-brain-admin-token: <token>` when `STUDIO_BRAIN_ADMIN_TOKEN` is configured.
- `x-studio-brain-admin-token` alone is not accepted for `GET /api/capabilities`.

Auth probe for local verification:
- `node ../scripts/test-studio-brain-auth.mjs`
- Optional env vars:
  - `STUDIO_BRAIN_BASE_URL` (default `http://127.0.0.1:8787`)
  - `STUDIO_BRAIN_ID_TOKEN`
  - `STUDIO_BRAIN_ADMIN_TOKEN`

Notes:
- `POST /api/capabilities/proposals/:id/reject` accepts optional body `{ "reason": "..." }`.
- `POST /api/capabilities/quotas/:bucket/reset` requires body `{ "reason": "..." }`.
- `GET /api/capabilities/audit` supports query params:
  - `limit` (default `100`, max `500`)
  - `actionPrefix`
  - `actorId`
  - `approvalState`

## Ops Defaults (v3 hardening)
- Scheduler is non-overlapping: a long-running snapshot job will be skipped rather than stacked.
- Optional scheduler jitter avoids synchronized spikes across multiple nodes:
  - `STUDIO_BRAIN_JOB_JITTER_MS=1000`
- Readiness can enforce snapshot freshness:
  - `STUDIO_BRAIN_REQUIRE_FRESH_SNAPSHOT_FOR_READY=true`
  - `STUDIO_BRAIN_READY_MAX_SNAPSHOT_AGE_MINUTES=240`
- Optional retention pruning (off by default):
  - `STUDIO_BRAIN_ENABLE_RETENTION_PRUNE=true`
  - `STUDIO_BRAIN_RETENTION_DAYS=180`
- Firestore sampling scan limit:
  - `STUDIO_BRAIN_SCAN_LIMIT=2000`
- Firestore query timeout:
  - `STUDIO_BRAIN_FIRESTORE_QUERY_TIMEOUT_MS=20000`
- All logs are JSON and redact common secret/token keys.

## Tests
- `npm test`

## Preflight
- Run dependency check before starting:
  - `npm run preflight`

## Observability Bundle (Optional)
- Start optional local observability profile + heartbeat snapshot:
  - `npm run studio:observability:up`
- Check current observability state:
  - `npm run studio:observability:status`
- Stop observability profile:
  - `npm run studio:observability:down`
- Reset local observability artifacts (destructive; requires acknowledgement):
  - `npm run studio:observability:reset -- --yes-i-know --reason "maintenance-window"`

## Local Proxy Bundle (Optional)
- Start optional reverse proxy profile:
  - `npm run studio:proxy:up`
- Check proxy status and route map:
  - `npm run studio:proxy:status`
- Stop proxy profile:
  - `npm run studio:proxy:down`

Equivalent `studio-brain` local targets:
- `make ops-up`
- `make ops-status`
- `make ops-down`
- `make ops-reset`

Primary artifacts:
- `output/stability/heartbeat-summary.json`
- `output/stability/heartbeat-events.log`
- `output/incidents/latest.json` (when critical failures occur)
- `output/otel/traces.jsonl` (OTEL collector file export)

## Soak / Perf
- Start service: `npm start`
- In another shell: `npm run soak`
- Optional env overrides:
  - `SOAK_BASE_URL=http://127.0.0.1:8787`
  - `SOAK_DURATION_MINUTES=60`
  - `SOAK_POLL_SECONDS=30`
- Tuned always-on recommendations: `docs/OPS_TUNING.md`
