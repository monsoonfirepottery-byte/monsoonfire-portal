# Swarm Backend Setup (Local Docker-first)

This repository includes a production-lean, developer-friendly backend stack for swarm orchestration:
- PostgreSQL (`postgres`) for state, events, and migrations.
- Redis (`redis`) for queue/buffer operations.
- MinIO (`minio`) for blob-style artifact storage.
- Optional OpenTelemetry collector (`otel-collector`) when `--profile observability` is enabled.

## Prerequisites

- Node.js 20+ (for local app build/run)
- Docker + Docker Compose v2

## 1) Prepare environment

```bash
cp .env.example .env
# Adjust values, especially:
#   PG*, REDIS_*, STUDIO_BRAIN_ARTIFACT_STORE_*
```

Recommended base values:

- `STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED=true` (to include Redis stream event bus checks)
- `STUDIO_BRAIN_SKILL_SANDBOX_ENABLED=true`
- `STUDIO_BRAIN_VECTOR_STORE_ENABLED=true` (uses pgvector extension)

## 2) Start stack

```bash
make dev-up            # starts postgres/redis/minio
npm run build          # compile once or whenever code changes
npm run dev            # starts Studio Brain app
```

Optional:

```bash
make dev-up -- -p observability  # start optional collector profile
```

## 3) Validate infrastructure

```bash
make infra-validate           # docker compose config + required service check
npm run infra:deps            # compose check + backend healthcheck
```

## 4) Architecture map for next contributors

Core files for the new backend plumbing:

1. `docker-compose.yml` -> services, ports, optional observability profile.
1. `src/config/env.ts` -> required env + connectivity validation.
1. `src/index.ts` -> startup order and dependency injection.
1. `src/connectivity/*.ts` -> factories and health checks.
1. `src/connectivity/healthcheck.ts` -> common status table format.
1. `src/swarm/models.ts`, `src/swarm/store.ts`, `src/swarm/bus/eventBus.ts` -> swarm primitives.
1. `src/swarm/orchestrator.ts` -> minimal loop + follow-up event emission.
1. `src/skills/registry.ts`, `src/skills/ingestion.ts`, `src/skills/sandbox.ts` -> registry + install + execution boundary.
1. `src/cli/healthcheck.ts` + `/health/dependencies` -> dependency visibility.
1. `src/infra/*` + `src/skills/*test.ts` -> validation hooks and integration checks.
1. `docs/ENVIRONMENT_REFERENCE.md` -> environment variable reference.
1. `docs/SWARM_BACKEND_EXTEND_GUIDE.md` -> extension playbook for next changes.

## 5) Healthcheck command and endpoint

1. CLI `npm run healthcheck` (table output)
1. CLI `npm run healthcheck:json` (JSON output)
1. HTTP `GET /health/dependencies`

`healthcheck` command and endpoint both report a table/object for:
- PostgreSQL
- Redis
- Event bus
- Artifact store
- Vector store (when enabled)
- Skill registry and sandbox

Health status is strict: any `error` or `degraded` dependency marks the dependency check as unhealthy and returns a non-zero exit from `npm run healthcheck`.

All HTTP responses include:
- `x-request-id`
- `x-trace-id`

If you pass `traceparent`, it is echoed back as provided so downstream services can correlate request flow.

## 6) Basic smoke path

From a running service:

```bash
curl -sS http://127.0.0.1:8787/health/dependencies | jq .
```

If you want to run an end-to-end stack check in a scriptable manner, use
`npm run test:infra` (requires docker services up and `STUDIO_BRAIN_INFRA_INTEGRATION=1`).

## 7) Reset and rerun

```bash
make dev-reset   # interactive, destructive
make dev-down
make dev-up
```

## 8) Safe defaults to keep in mind

1. Redis stream bus is available when `STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED=true`.
1. Vector store remains opt-in and uses pgvector when `STUDIO_BRAIN_VECTOR_STORE_ENABLED=true`.
1. Skill sandboxing starts with denied egress by default.
1. Skill installs are isolated under `STUDIO_BRAIN_SKILL_INSTALL_ROOT`.
1. `healthcheck` can be run while only required dependencies are up; optional dependencies report disabled status.

## Troubleshooting

- **`healthcheck` fails on Postgres**: ensure compose db is up and `.env` values match `PG*` entries.
- **Redis errors**: verify `REDIS_HOST`/`REDIS_PORT` and that Redis service is reachable.
- **Object store fails on bucket**: remove stale MinIO creds and re-run with:
  `STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY` / `STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY` matching compose values.
- **Skill sandbox unavailable**: check `lib/skills/sandboxWorker.js` exists (`npm run build`) and node can spawn child processes.

## 9) Additional references

1. `docs/ENVIRONMENT_REFERENCE.md` for exact env vars and defaults.
1. `docs/SWARM_BACKEND_EXTEND_GUIDE.md` for safe ways to add features.
1. `docs/SWARM_BACKEND_ARCHITECTURE.md` for component relationships and data flow.
1. `docs/SWARM_BACKEND_DECISIONS.md` for rationale and evolution options.
1. `docs/INDEX.md` for a quick doc navigation map.
