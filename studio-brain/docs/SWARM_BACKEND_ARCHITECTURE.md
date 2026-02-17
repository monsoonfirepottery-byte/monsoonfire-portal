# Studio Brain Swarm Backend Architecture (Handoff Guide)

## Purpose

This document explains how the swarm backend skeleton is organized so the next agent can safely extend it.
The current implementation is intentionally minimal, production-lean, and local-first.

## Runtime layers and responsibilities

1) HTTP/API layer
1. `startHttpServer` in `src/http/server.ts` exposes standard service endpoints plus `/health/dependencies`.
1. It wires capability endpoints, readiness checks, dashboard endpoints, and the dependency health command callback.
1. Observability here is request/response ID + trace ID propagation and structured JSON logs.

2) Bootstrap and lifecycle layer
1. `src/index.ts` is the single place where dependencies are constructed.
1. It creates DB, Redis, vector store, artifact store, bus, and optional sandbox before starting background workers and HTTP server.
1. It also defines a reusable `backendHealth` function that powers both CLI healthcheck and `/health/dependencies`.

3) Connectivity layer
1. `src/connectivity/database.ts` performs migration + DB healthcheck.
1. `src/connectivity/redis.ts` creates a Redis client with retry strategy and timeout-wrapped commands.
1. `src/connectivity/artifactStore.ts` wires MinIO bucket lifecycle and object operations.
1. `src/connectivity/vectorStore.ts` provides memory APIs with pgvector fallback.
1. `src/connectivity/healthcheck.ts` standardizes dependency check result shape and report rendering.

4) Swarm domain layer
1. `src/swarm/models.ts` defines agent identity, task, and event contracts.
1. `src/swarm/store.ts` persists tasks/events/agents to Postgres tables.
1. `src/swarm/bus/eventBus.ts` publishes and subscribes via Redis Streams.
1. `src/swarm/orchestrator.ts` subscribes, stores events durably, and emits follow-up events.

5) Skill plane layer
1. `src/skills/registry.ts` defines a registry abstraction and local/remote implementations.
1. `src/skills/ingestion.ts` implements pinned install policy, allow/deny logic, checksum/signature verification hooks, and audit logging.
1. `src/skills/sandbox.ts` plus `src/skills/sandboxWorker.ts` run skill code in a dedicated process over stdio RPC.

6) Validation layer
1. `src/config/env.ts` validates required configuration and prints only safe values via `redactEnvForLogs`.
1. `src/infra/dockerComposeConfig.test.ts` checks compose has required services.
1. `src/infra/backend.integration.test.ts` provides minimal end-to-end connectivity smoke path.
1. `src/skills/*test.ts` exercises registry/ingestion/sandbox behavior.
1. `docs/ENVIRONMENT_REFERENCE.md` and `docs/SWARM_BACKEND_EXTEND_GUIDE.md` capture operational contracts and extension patterns.

## Data flow (minimal happy path)

1. `npm run dev` starts bootstrap in `src/index.ts`.
1. `createDatabaseConnection()` runs migrations and DB healthcheck.
1. Redis client and event bus are initialized if orchestrator mode is enabled.
1. Health checks can be queried at `/health/dependencies` or via `npm run healthcheck`.
1. A published event enters Redis Streams, subscriber loop in `SwarmOrchestrator` stores it, and may emit a derived event.
1. Tasks/events are persisted in `swarm_tasks` and `swarm_events`.

## Storage schema

1. `migrations/005_swarm_infra.sql` adds:
1. `swarm_agents(agent_id, swarm_id, run_id, role, last_seen_at)`
1. `swarm_tasks(task_id, status, assigned_agent_id, inputs, outputs, timestamps)`
1. `swarm_events(event_id, event_type, swarm_id, run_id, actor_id, payload, created_at)`
1. `swarm_memory(memory_id, agent_id, run_id, tenant_id, content, metadata, embedding)`
1. `brain_migrations` is maintained by existing migration runner in `src/db/migrate.ts`.

## Configuration map

1. Shared backend and health vars are in `src/config/env.ts`.
1. Default example values are in `.env.example`.
1. The required runtime services are `postgres`, `redis`, and `minio` in `docker-compose.yml`.

## Operational runbook

1. Start dependencies: `make dev-up`
1. Start app: `npm run dev`
1. Validate: `npm run infra:deps` and `npm run healthcheck`
1. Reset data: `make dev-reset` (destructive, interactive)

## What to improve next

1. Add durable event cursor/state table so orchestrator resumes from last offset.
1. Add structured runbook IDs and correlation IDs per event bus message.
1. Introduce schema validation at API boundary for inbound swarm/event payloads.
1. Extend skill verifier with actual signature chain / trust store lookup.
1. Enforce process-level sandbox hardening (non-root user, seccomp/syscall policy, dedicated cgroup).
1. Add a small migration status check test for each required table column/constraint.

## Quick file map for future edits

1. `src/index.ts` - bootstrap and dependency initialization.
1. `src/http/server.ts` - transport surface + health route.
1. `src/connectivity/*` - all external connectivity constructors.
1. `src/swarm/*` - agent/task/event state + orchestrator.
1. `src/skills/*` - registry, install policy, sandbox.
1. `src/infra/*` - config and integration tests.
1. `scripts/validateCompose.mjs`, `Makefile` - local infra lifecycle.
1. `docs/ENVIRONMENT_REFERENCE.md` - variable-level behavior and defaults.
1. `docs/SWARM_BACKEND_EXTEND_GUIDE.md` - safe extension workflows.
1. `docs/SWARM_BACKEND_DECISIONS.md` - rationale, tradeoffs, and forward migration path.
1. `docs/INDEX.md` - quick map to other backend docs.
