# Environment Reference (Swarm Backing Stack)

Use this as the single source for runtime vars introduced by the backend-orchestration workstream.

## Core service runtime

| Variable | Description | Required | Default |
|---|---|---|---|
| `STUDIO_BRAIN_HOST` | HTTP bind host | No | `127.0.0.1` |
| `STUDIO_BRAIN_PORT` | HTTP bind port | No | `8787` |
| `STUDIO_BRAIN_LOG_LEVEL` | Structured logger level | No | `info` |
| `STUDIO_BRAIN_ALLOWED_ORIGINS` | Comma list for CORS allowlist | No | `http://127.0.0.1:5173,http://localhost:5173` |
| `STUDIO_BRAIN_ADMIN_TOKEN` | Optional extra token gate for capability endpoints | No | empty |

## Database connectivity

| Variable | Description | Required | Default |
|---|---|---|---|
| `PGHOST` | Postgres host | No | `127.0.0.1` |
| `PGPORT` | Postgres port | No | `5433` |
| `PGDATABASE` | Postgres database | No | `monsoonfire_studio_os` |
| `PGUSER` | Postgres user | No | `postgres` |
| `PGPASSWORD` | Postgres password | No | `postgres` |
| `PGSSLMODE` | TLS mode (`disable` \| `prefer` \| `require`) | No | `disable` |
| `STUDIO_BRAIN_PG_POOL_MAX` | Max pool size | No | `10` |
| `STUDIO_BRAIN_PG_IDLE_TIMEOUT_MS` | Pool idle timeout | No | `30000` |
| `STUDIO_BRAIN_PG_CONNECTION_TIMEOUT_MS` | Initial connect timeout | No | `10000` |
| `STUDIO_BRAIN_PG_QUERY_TIMEOUT_MS` | Default DB query timeout | No | `5000` |

## Redis and message bus

| Variable | Description | Required | Default |
|---|---|---|---|
| `REDIS_HOST` | Redis host | No | `127.0.0.1` |
| `REDIS_PORT` | Redis port | No | `6379` |
| `REDIS_USERNAME` | Redis username (optional, for ACL mode) | No | empty |
| `REDIS_PASSWORD` | Redis password (optional, for ACL mode) | No | empty |
| `REDIS_CONNECT_TIMEOUT_MS` | Redis connect timeout | No | `5000` |
| `REDIS_COMMAND_TIMEOUT_MS` | Redis command timeout/retry boundary | No | `5000` |
| `STUDIO_BRAIN_REDIS_STREAM_NAME` | Redis stream bus name | No | `studiobrain.events` |
| `STUDIO_BRAIN_EVENT_BUS_POLL_INTERVAL_MS` | Subscriber poll/block interval | No | `750` |
| `STUDIO_BRAIN_EVENT_BUS_BATCH_SIZE` | Max events per poll | No | `32` |
| `STUDIO_BRAIN_EVENT_BUS_START_ID` | Initial stream cursor | No | `$` |

## Artifact/object store

| Variable | Description | Required | Default |
|---|---|---|---|
| `STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT` | MinIO endpoint URL | No | `http://127.0.0.1:9010` |
| `STUDIO_BRAIN_ARTIFACT_STORE_BUCKET` | Bucket name | No | `studiobrain-artifacts` |
| `STUDIO_BRAIN_ARTIFACT_STORE_ACCESS_KEY` | MinIO access key | No | `minioadmin` |
| `STUDIO_BRAIN_ARTIFACT_STORE_SECRET_KEY` | MinIO secret key | No | `minioadmin` |
| `STUDIO_BRAIN_ARTIFACT_STORE_USE_SSL` | Use HTTPS for MinIO | No | `false` |
| `STUDIO_BRAIN_ARTIFACT_STORE_TIMEOUT_MS` | Object operation timeout | No | `5000` |

## Vector store

| Variable | Description | Required | Default |
|---|---|---|---|
| `STUDIO_BRAIN_VECTOR_STORE_ENABLED` | Enable swarm memory table hooks | No | `false` |
| `STUDIO_BRAIN_VECTOR_STORE_TABLE` | Memory table name | No | `swarm_memory` |

## Swarm orchestration behavior

| Variable | Description | Required | Default |
|---|---|---|---|
| `STUDIO_BRAIN_SWARM_ORCHESTRATOR_ENABLED` | Enable Redis stream orchestrator scaffolding | No | `false` |
| `STUDIO_BRAIN_SWARM_ID` | Swarm identifier used in event/task rows | No | `default-swarm` |
| `STUDIO_BRAIN_SWARM_RUN_ID` | Optional explicit run id (otherwise generated) | No | empty |
| `STUDIO_BRAIN_SWARM_EVENT_POLL_MS` | Health/loop cadence for future loop consumers | No | `1000` |

## Skill registry and installation

| Variable | Description | Required | Default |
|---|---|---|---|
| `STUDIO_BRAIN_SKILL_REGISTRY_LOCAL_PATH` | Local registry root path | No | `./skills-registry` |
| `STUDIO_BRAIN_SKILL_REGISTRY_REMOTE_BASE_URL` | Base URL for remote registry client | No | empty |
| `STUDIO_BRAIN_SKILL_INSTALL_ROOT` | Isolated install destination | No | `/var/lib/studiobrain/skills` |
| `STUDIO_BRAIN_SKILL_REQUIRE_PINNING` | Enforce `name@version` references | No | `true` |
| `STUDIO_BRAIN_SKILL_REQUIRE_CHECKSUM` | Enforce manifest checksum check | No | `true` |
| `STUDIO_BRAIN_SKILL_REQUIRE_SIGNATURE` | Enforce signature hook result | No | `false` |
| `STUDIO_BRAIN_SKILL_SIGNATURE_TRUST_KEYS` | Signature trust anchors (`keyId=secret` CSV or JSON map); required when signature enforcement is on | No | empty |
| `STUDIO_BRAIN_SKILL_ALLOWLIST` | Comma list of allowed skill refs | No | empty |
| `STUDIO_BRAIN_SKILL_DENYLIST` | Comma list of blocked skill refs | No | empty |

## Sandbox execution policy

| Variable | Description | Required | Default |
|---|---|---|---|
| `STUDIO_BRAIN_SKILL_SANDBOX_ENABLED` | Enable separate process execution boundary | No | `true` |
| `STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_DENY` | Default deny outbound connections | No | `true` |
| `STUDIO_BRAIN_SKILL_SANDBOX_EGRESS_ALLOWLIST` | Allowed outbound hosts when egress deny is on | No | empty |
| `STUDIO_BRAIN_SKILL_SANDBOX_ENTRY_TIMEOUT_MS` | Per-rpc execution timeout | No | `15000` |
| `STUDIO_BRAIN_SKILL_RUNTIME_ALLOWLIST` | Command allowlist passed into skill context | No | empty |

## Observability

| Variable | Description | Required | Default |
|---|---|---|---|
| `STUDIO_BRAIN_OTEL_ENABLED` | Enable OTEL wiring (optional) | No | `false` |
| `STUDIO_BRAIN_OTEL_ENDPOINT` | OTEL collector endpoint | No | empty |
| `STUDIO_BRAIN_OTEL_SERVICE_NAME` | OTEL service name | No | `studiobrain` |

## Runtime scheduling (existing app controls)

| Variable | Description | Required | Default |
|---|---|---|---|
| `STUDIO_BRAIN_JOB_INTERVAL_MS` | Scheduled compute interval | No | `900000` |
| `STUDIO_BRAIN_JOB_INITIAL_DELAY_MS` | Startup job delay | No | `0` |
| `STUDIO_BRAIN_JOB_JITTER_MS` | Randomized jitter window | No | `0` |
| `STUDIO_BRAIN_ENABLE_STARTUP_COMPUTE` | Run compute at boot | No | `true` |
| `STUDIO_BRAIN_ENABLE_RETENTION_PRUNE` | Enable retention cleanup | No | `false` |
| `STUDIO_BRAIN_ENABLE_WRITE_EXECUTION` | Allow write execution hooks | No | `false` |

## Validation notes

1. `readEnv()` validates:
   - required non-empty strings for critical connectivity keys
   - URL-formats for artifact endpoint, OTEL endpoint, optional remote registry base URL
   - bounded numeric ranges for timeouts and poll settings
2. `redactEnvForLogs()` intentionally masks sensitive fields before logging.

## Precedence and onboarding

1. Runtime precedence for local tooling should be treated as:
   - CLI args
   - existing process environment
   - `.env` / `.env.local` file values
2. Recommended copy/update/verify flow before startup:
   - `cp .env.example .env`
   - update local secrets/tokens
   - `npm run studio:env:verify` (from repo root)
3. Redaction policy:
   - logs and status surfaces should use redacted fields (`[set]`/`[redacted]`) for token/secret/password variables.
