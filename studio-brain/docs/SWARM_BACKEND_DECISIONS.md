# Design Decisions for Swarm Backend Scaffolding

This document captures why choices were made so the next agent can evolve the architecture intentionally.

## Why local-first Compose first

1. It guarantees reproducibility for developers without cloud dependencies.
1. It keeps onboarding friction low for swarm scaffolding work that mostly needs deterministic queues + storage + event logs.
1. It allows integration checks to be run in CI or laptop environments with predictable ports and health gates.

## Why Redis stream bus (vs NATS) for now

1. Redis is already a direct dependency of the existing app and can act as:
   - short-lived queue
   - durable-ish event buffer
   - lightweight pub/sub fallback
1. Stream support provides ordered event consumption and simple cursor semantics while keeping operational burden low.
1. NATS remains an easy swap point by preserving the bus abstraction in `src/swarm/bus/eventBus.ts`.

## Why MinIO vs filesystem for artifacts

1. MinIO mirrors object-store semantics used by real clusters (bucket lifecycle, API boundaries).
1. It keeps parity with cloud-like flows for blob-backed artifacts.
1. Filesystem path install is still available for skills via local registry path and install root, but object storage is explicit for runtime artifacts.

## Why pgvector with optional fallback

1. PostgreSQL is already present as the state store, so adding vector capability there avoids another infra service in dev.
1. pgvector can be enabled/disabled per deployment:
   - enabled: similarity search path
   - disabled: deterministic text fallback
1. This avoids hard dependency on external vector infra while preserving migration compatibility.

## Why stdio process boundary for skills

1. Execution boundary is explicit and low overhead to maintain.
1. It lets us add stronger security (process isolation, seccomp, user namespaces) incrementally.
1. It provides a narrow JSON RPC shape that naturally supports:
   - request timeout
   - structured deny checks (commands/egress)
   - easy transport substitution later (gRPC/mTLS/gRPC over Unix socket).

## Why checksum-first skill install policy

1. Supply-chain risk for public registries requires deterministic input validation.
1. Checksum checks are a lightweight first gate that can be enforced before richer signature infrastructure.
1. Keep install immutable by isolating to dedicated paths and writing audit trail entries.

## What is intentionally not solved yet (for explicit follow-up)

1. Full remote signature chain verification.
1. Enforced egress at OS/container layer (currently app-level guard).
1. Multi-process sandbox pool and cancellation/priority scheduling.
1. Durable event cursor checkpointing and replay exactly-once semantics.
1. End-to-end schema migration drift checks across all required tables.

## Forward migration path

1. Add bus provider interface for alternate backends (NATS, SQS, Kafka).
1. Replace app-level egress checks with dedicated sandbox runtime policy.
1. Add tenant-aware namespaces for artifacts, events, and tasks.
1. Introduce per-event payload versioning and schema registry.
