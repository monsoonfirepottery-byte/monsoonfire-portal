# P2 — Studiobrain Stability Tooling and Monitoring Baseline for Epic-08

Status: Completed
Date: 2026-02-19
Priority: P2
Owner: Platform + Operations
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

Stability of the Studiobrain host path is now a top-level release concern, yet we don’t have a single documented, source-of-truth baseline for local monitoring, watchdog tooling, and recovery primitives expected during cutover and phased deployments.

## Objective

Define and baseline a minimal stability tooling stack (checks, logs, alerts, and on-call signals) so that failures in a stable home-hosted control plane are visible and actionable by the team and automation.

## Scope

- `scripts/reliability-hub.mjs`
- `scripts/studio-brain-network-check.mjs`
- `scripts/studio-cutover-gate.mjs`
- `scripts/pr-gate.mjs`
- `scripts/site-ops` and any local watcher scripts under repo
- `docs/SOURCE_OF_TRUTH_INDEX.md`
- `tickets/P1-studiobrain-observability-baseline-tooling-for-home-host.md`
- `scripts/cutover-watchdog.mjs`

## Tasks

1. Add an Epic-08 evidence row in `docs/SOURCE_OF_TRUTH_INDEX.md` for stability tooling and monitoring contracts.
2. Ensure reliability/watchdog scripts expose a deterministic signal contract (status, timestamp, latency thresholds, failure counts) that can be diffed in CI/release checks.
3. Add a short readiness step to confirm the baseline monitoring command set is runnable before release smoke.
4. Add an explicit recovery path for host-loss/unstable DNS/network and failed watch loops in docs and runbooks.
5. Link non-recommended ad-hoc utilities to a documented exception policy with owners and removal criteria.

## Acceptance Criteria

1. Stability-tooling sources are explicitly listed in Epic-08 source-of-truth registry.
2. A standard command verifies monitoring baseline presence and freshness.
3. Recovery paths include owner, escalation, and expected recovery time targets.
4. Release smoke/gate fails early if monitoring baselines are unavailable or stale.

## Definition of Done

- Monitoring/stability tooling is treated as source-of-truth evidence for Epic-08.
- A failure in baseline monitoring can be reproduced and diagnosed from documented runbook steps.
- Owners and tooling contracts are traceable from one registry entry to one gate check.
