# Swarm Backend Setup (Portable Stack Contract)

This guide defines the stable local contract for Studio Brain backend dependencies. The goal is reproducible startup from a clean checkout without machine-specific host edits.

## Stable stack contract

| Service | Purpose | Host port -> container port | Health signal | Runtime env override |
|---|---|---|---|---|
| `postgres` | primary shared state | `${PGPORT:-5433}` -> `5432` | `pg_isready -U ${PGUSER:-postgres} -d ${PGDATABASE:-monsoonfire_studio_os}` | `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` |
| `redis` | event bus + queue primitives | `${REDIS_PORT:-6379}` -> `6379` | `redis-cli ping` -> `PONG` | `REDIS_HOST`, `REDIS_PORT`, optional `REDIS_USERNAME` / `REDIS_PASSWORD` |
| `minio` | artifact/object storage | `${MINIO_API_PORT:-9010}` -> `9000`, `${MINIO_CONSOLE_PORT:-9011}` -> `9001` | `GET /minio/health/live` (HTTP 200) | `STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT`, `STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY`, `STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY`, optional `MINIO_API_PORT`, `MINIO_CONSOLE_PORT` |
| `otel-collector` (optional) | local telemetry sink | `4317`, `4318`, `8889` | collector process up | enable via compose profile `observability` |

### Startup order (expected)

1. `postgres`
2. `redis`
3. `minio`
4. Studio Brain app (`npm run dev` / `npm start`)
5. Optional `otel-collector` profile

## From-zero sequence (clean checkout)

1. Create local env file (recommended):

```bash
cd studio-brain
cp .env.example .env
```

`make dev-up` auto-falls back to `.env.example` if `.env` is missing, but `.env` is recommended for local overrides.

2. Boot dependencies:

```bash
make dev-up
```

3. Validate compose and dependencies:

```bash
make infra-validate
npm run infra:deps
```

4. Run preflight (env contract + Postgres + Redis + MinIO probes + guardrails):

```bash
npm run preflight
```

5. Start the app:

```bash
npm run dev
```

## Observability bundle (optional)

Use this when the host is running for long sessions and you want one-command local visibility.

```bash
# from repo root
npm run studio:observability:up
npm run studio:observability:status
npm run studio:observability:down
npm run studio:observability:reset -- --yes-i-know --reason "maintenance-window"
```

From `studio-brain/` you can use Make targets:

```bash
make ops-up
make ops-status
make ops-down
make ops-reset
```

What `ops-up` does:
1. starts `otel-collector` with compose profile `observability`
2. runs one reliability heartbeat snapshot
3. writes fresh artifacts under `output/stability` and `output/otel`

Expected runtime:
- `ops-up`/`studio:observability:up`: usually 20-90 seconds when dependencies are already running
- `ops-status`: usually under 5 seconds
- `ops-reset`: usually under 20 seconds

## Reverse proxy bundle (optional)

Use this when you want route-based access from one local endpoint:

```bash
npm run studio:proxy:up
npm run studio:proxy:status -- --json
npm run studio:proxy:down
```

Default proxy URL: `http://<resolved-host>:8788`

Route map:
- `/studio/*` -> Studio Brain (`:8787`)
- `/functions/*` -> Functions emulator (`:5001`)
- `/portal/*` -> Vite portal dev server (`:5173`)

## Host mapping for local vs LAN workflows

Do not edit scripts for host changes. Use env values only.

| Workflow | `PGHOST` | `REDIS_HOST` | `STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT` | Notes |
|---|---|---|---|---|
| Local on same machine | `127.0.0.1` | `127.0.0.1` | `http://127.0.0.1:9010` | default and recommended for single-host dev |
| LAN to Studiobrain hostname | `studiobrain.local` | `studiobrain.local` | `http://studiobrain.local:9010` | requires LAN/DNS resolution to studiobrain host |
| LAN to static IP | `<static-ip>` | `<static-ip>` | `http://<static-ip>:9010` | use when DNS hostname is unavailable |

When hostname or DHCP context changes, update `.env` host values and re-run `npm run preflight`. No code edits should be required.

## Health endpoints and checks

1. Compose health checks:
   - Postgres: `pg_isready`
   - Redis: `redis-cli ping`
   - MinIO: `http://127.0.0.1:9010/minio/health/live`
2. Studio Brain checks:
   - `npm run healthcheck`
   - `GET /health/dependencies`
3. Preflight quick diagnosis:
   - `npm run preflight`
   - shows PASS/FAIL per dependency with remediation steps

## Routing contract checks

Use these checks to verify portal + functions + website routing posture from the same host contract:

```bash
# strict host/profile + proxy alignment
npm run studio:stack:profile:snapshot:strict -- --json --artifact output/studio-stack-profile/latest.json

# single-shot reliability summary (status + contracts + endpoints)
npm run reliability:once -- --json
```

## Recovery notes (migration and portability failures)

### 1) Stale volumes

Symptom:
- service starts but auth/database state is inconsistent with current env values.

Recovery:

```bash
make dev-down
make dev-reset
make dev-up
```

Then run `npm run preflight`.

### 2) Credential mismatch

Symptom:
- Postgres or MinIO is reachable but app/auth checks fail.

Recovery:
1. Align `.env` with compose-backed values (`PG*`, `STUDIO_BRAIN_ARTIFACT_STORE_*`).
2. Restart dependencies:

```bash
make dev-down
make dev-up
```

3. Re-run `npm run preflight` and `npm run healthcheck`.

### 3) Port collision

Symptom:
- compose fails to bind ports (`5433`, `6379`, `9010`, `9011`).

Recovery:
1. Identify occupying process/service.
2. Free the port, or remap host-side port in `docker-compose.yml` and matching env var (`PGPORT`, `REDIS_PORT`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`).
3. If MinIO port changes, also update `STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT`.
4. Re-run:

```bash
make infra-validate
make dev-up
npm run preflight
```

### 4) Hostname or LAN drift

Symptom:
- local machine works but remote/LAN callers fail.

Recovery:
1. Update `.env` host values to current LAN hostname or static IP.
2. Verify network profile in root tooling if needed.
3. Re-run `npm run preflight` from `studio-brain`.

## Operator quick commands

```bash
# dependencies only
make dev-up

# full dependency contract checks
make infra-validate
npm run infra:deps
npm run preflight

# app-level dependency report
npm run healthcheck:json
```

## Backup And Contract Maintenance

```bash
# backup verification + restore drill
npm run backup:verify
npm run backup:restore:drill

# generated contract docs
npm run docs:contract
npm run docs:contract:check
```

Artifacts:
- `output/backups/<timestamp>/manifest.json`
- `output/backups/<timestamp>/restore-drill-summary.json`
- `docs/generated/studiobrain-runtime-contract.generated.md`

## Related references

1. `docs/ENVIRONMENT_REFERENCE.md`
2. `docs/SWARM_BACKEND_ARCHITECTURE.md`
3. `docs/SWARM_BACKEND_EXTEND_GUIDE.md`
4. `docs/SWARM_BACKEND_DECISIONS.md`
5. `docs/OPS_DASHBOARD.md`
