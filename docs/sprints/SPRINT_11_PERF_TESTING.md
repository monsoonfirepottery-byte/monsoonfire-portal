# Sprint 11 - Performance + Testing Pass

Window: Post-alpha (after Sprint 10 closure)  
Goal: Lock performance budgets, pay down lint/test debt, and reduce operational risk from regressions.

## Ticket S11-01
- Title: Web perf budgets and Lighthouse baseline
- Swarm: `Swarm D`
- Owner: TBD
- State: `done`
- Dependencies: S10-04
- Deliverables:
  - run Lighthouse CI against the deployed (or preview) portal
  - set/confirm budgets in `web/lighthouserc.json`
  - record baseline scores and budget thresholds in release evidence
- Verification:
1. Lighthouse workflow is green and stable (no flaky failures).
2. Budget thresholds match the baseline and are realistic (not trivially passing).
3. Any failing audits have a linked remediation ticket or explicit waiver.

## Ticket S11-02
- Title: Bundle/chunk budget enforcement and route-level regressions
- Swarm: `Swarm B`
- Owner: TBD
- State: `done`
- Dependencies: S11-01
- Deliverables:
  - run `npm --prefix web run perf:chunks` and confirm budgets on CI
  - ensure route-level chunks exist for all major views (no monolithic initial bundle)
  - document the remediation playbook (what to do when a chunk budget fails)
- Verification:
1. Chunk budget script is green locally and in CI.
2. First-load bundles do not regress above baseline without explicit approval.
3. Route transitions remain functional with ErrorBoundary fallbacks.

## Ticket S11-03
- Title: Expand automated tests for alpha-critical flows
- Swarm: `Swarm A`
- Owner: TBD
- State: `done`
- Dependencies: S10-03
- Deliverables:
  - add/verify Vitest coverage for: auth gating, functions client auth headers, in-flight guards, troubleshooting capture
  - ensure `npm --prefix web run test:run` is reliable and fast enough for CI
- Verification:
1. Tests cover at least one happy-path and one failure-path for each critical flow.
2. No test relies on real network or real Firebase services.
3. CI runtime stays within acceptable bounds (no multi-minute drift).

## Ticket S11-04
- Title: Lint debt payoff and CI enforcement
- Swarm: `Swarm D`
- Owner: TBD
- State: `done`
- Dependencies: S10-03
- Deliverables:
  - run lint across root/web/functions and fix high-signal issues (unsafe async handlers, unused vars, unstable deps)
  - ensure lint is enforced in CI with a consistent config (`eslint.config.js` + `web/tsconfig.eslint.json`)
- Verification:
1. `npm --prefix web run lint` is clean (or has an explicit allowlist with rationale).
2. Lint failures block merges to the release branch.
3. No “fix” changes behavior without a corresponding test/update note.

## Ticket S11-05
- Title: Functions performance and cold-start risk review
- Swarm: `Swarm C`
- Owner: TBD
- State: `done`
- Dependencies: S10-06
- Deliverables:
  - identify heaviest functions and measure p95 latency (prod logs or synthetic)
  - reduce obvious cold-start cost (lazy imports, avoid module-scope heavy work)
  - document any remaining cold-start risks and mitigations
- Verification:
1. Measured latency numbers are recorded (before/after) with environment noted.
2. No increase in error rate or auth failures after changes.
3. Rollback plan exists for any perf-only changes.
