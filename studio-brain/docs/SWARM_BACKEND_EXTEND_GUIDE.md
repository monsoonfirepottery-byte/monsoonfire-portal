# Swarm Backend Extension Guide

Use this when adding new behavior without breaking the current minimal contracts.

## 1) Add a new dependency check

1. Add config + validation:
   - Add any required env keys in `src/config/env.ts`.
   - Add redact-safe output in `redactEnvForLogs`.
2. Add constructor:
   - Put connection logic in `src/connectivity/<name>.ts`.
   - Return a `{ healthcheck }` function with `{ ok, latencyMs, error? }`.
3. Wire health visibility:
   - Add to `checks` in `src/cli/healthcheck.ts`.
   - Add matching entry in app callback (`backendHealth`) in `src/index.ts`.
4. Add API check:
   - Confirm in `/health/dependencies` when available.
5. Cover by tests:
   - Add connectivity unit tests in `src/infra/*` as required.

## 2) Extend event types / orchestration behavior

1. Update domain model:
   - Add to `SwarmEventType` in `src/swarm/models.ts`.
2. Harden validation:
   - Add shape checks in `src/swarm/bus/eventBus.ts` parsing (`parseEventPayload`).
3. Store event:
   - Ensure `appendSwarmEvent` in `src/swarm/store.ts` has matching columns.
4. Handle in orchestrator:
   - Add branch in `SwarmOrchestrator.createEventHandler()` and keep handling idempotent.
5. Add durable test:
   - Use a temporary event + asserted persisted row in `src/infra/backend.integration.test.ts`.

## 3) Add new skill registry source

1. Add a new client method to `SkillRegistryClient` in `src/skills/registry.ts`.
2. Implement the new source under `create*RegistryClient`.
3. Reuse existing `resolveSkill` contract:
   - return `{ manifest, sourcePath }`
   - validate manifest name/version parity with requested ref.
4. Add healthcheck for source reachability and local fallback behavior.
5. Add tests:
   - add to `src/skills/ingestion.test.ts` for install with this source.

## 4) Add stronger sandbox policy controls

1. Registry level:
   - Extend manifest schema in `src/skills/registry.ts`.
2. Install-time policy:
   - Add fields in `SkillManifest.permissions` and persist to installed manifest.
3. Runtime:
   - Add enforcement logic in `src/skills/sandboxWorker.ts` (before module load / execute).
4. Add telemetry:
   - Emit policy decision in worker response for denied actions where possible.
5. Add tests:
   - add to `src/skills/sandbox.test.ts` with deny/allow assertions.

## 5) Add persistent cursor for bus replay

1. Add a cursor table (e.g., `swarm_bus_state`) and migration.
2. Record cursor updates in event loop after each consumed event.
3. On startup, read cursor and pass as `startId` to `createRedisStreamEventBus`.
4. On stop, ensure cursor is flushed before exit.
5. Keep replays bounded and idempotent.

## 6) Extend vector memory model

1. Update schema in `migrations/005_swarm_infra.sql`:
   - new dimensions or metadata fields.
2. Update store adapter contract in `src/connectivity/vectorStore.ts`.
3. Keep pgvector and fallback SQL search behavior aligned.
4. Add test for:
   - fallback text search still works without pgvector extension.

## 7) Add auditability for skill operations

1. Define immutable audit shape and include:
   - `requestedBy`, `actorId` (if available), `runId`, install source URL, checksum diff.
2. Write records to `.install-audit.jsonl` and optionally forward to app event log.
3. Emit an event in orchestrator when installation is blocked or completed.
4. Add incident-oriented assertions in `src/skills/ingestion.test.ts`.

## 8) Code review boundaries (recommended)

1. Keep `src/connectivity/*`, `src/swarm/*`, and `src/skills/*` scoped and composable.
2. Avoid hardcoding secrets; read from env and never include them in structured logs.
3. Preserve existing startup path in `src/index.ts`; add feature flags in env when introducing behavior.
4. Add tests alongside any new code path before wiring into app runtime.
5. Prefer incremental migration: add nullable columns and migration tests before changing existing writes.
