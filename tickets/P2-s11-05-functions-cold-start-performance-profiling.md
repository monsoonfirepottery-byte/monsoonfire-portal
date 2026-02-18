# P2 — Functions Cold-Start Performance Profiling

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Portal Team
Type: Ticket
Parent Epic: tickets/P1-portal-performance-readiness-and-smoke-hardening.md

## Problem
Potential cold-start and heavy-init behavior in Cloud Functions lacks documented p95 baselines and prioritized follow-up.

## Objective
Identify top cold-start contributors and produce an evidence-based mitigation plan before further optimization.

## Scope
1. Measure representative function latency and identify top heavy functions.
2. Evaluate lazy initialization and module-scope startup cost in high-volume handlers.
3. Document mitigation options and risk tradeoffs.

## Tasks
1. Identify heaviest functions via logs, traces, or synthetic runs and record current p95s.
2. Profile initialization hotspots and reduce avoidable import/module side-effects.
3. Capture before/after comparison results (or "no-change with reason" notes) in ticket evidence.

## Acceptance Criteria
1. Function latency snapshots include environment, timestamp, and reproducible query/run command.
2. At least one optimization candidate is executed or explicitly deferred with rollback plan.
3. No increase in auth failures or function error rate after the performance change set.

## References
- `functions/src`
- `docs/sprints/SPRINT_11_PERF_TESTING.md`
- `docs/RELEASE_CANDIDATE_EVIDENCE.md`
