# P2 — Functions Cold-Start Performance Profiling

Status: Completed
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

## Execution Notes
1. Added reproducible cold-start profiling command and artifact pipeline:
   - `scripts/functions-coldstart-profile.mjs`
   - `npm run functions:profile:coldstart -- --runs 9`
   - artifact: `output/functions-coldstart-profile/latest.json`
2. Optimization candidate executed:
   - moved `apiV1` load in `functions/src/index.ts` from eager module import to lazy dynamic import (`dispatchApiV1`)
   - compatibility wrappers (`apiV1`, legacy reservation routes) now resolve handler at request time
3. Current local profiling snapshot (`generatedAt: 2026-02-22T07:09:24.471Z`, Linux x64, Node v25.6.1):
   - `index` p95: `266.89ms`
   - `apiV1` p95: `181.50ms`
   - `events` p95: `205.96ms`
   - `stripeConfig` p95: `194.62ms`
   - `reports` p95: `167.06ms`
   - composite reference (`index_plus_apiV1`) p95: `275.54ms`
4. Regression checks after performance change:
   - `npm --prefix functions run lint`
   - `npm --prefix functions run test` (`118` tests passing)
5. Rollback plan:
   - revert `dispatchApiV1` lazy-loading in `functions/src/index.ts` to static import if any runtime route issue is observed.

## References
- `functions/src`
- `docs/sprints/SPRINT_11_PERF_TESTING.md`
- `docs/RELEASE_CANDIDATE_EVIDENCE.md`
