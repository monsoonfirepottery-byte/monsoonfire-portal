# Intent Control Plane (P0)

## Purpose
Define human intent in machine-readable contracts so autonomous execution can stay bounded, resumable, and low-drift.

Current operating note:
- During `ingestion` phase, database pressure is expected; DB-specific retry/runtime thresholds are relaxed while non-DB rails remain strict.

## Components
1. Contract schema: `contracts/intent.schema.json`
2. Intent files: `intents/*.intent.json`
3. Hardening registry: `config/intent-hardening-opportunities.json`
4. Validator: `npm run intent:validate`
5. Compiler: `npm run intent:compile`
6. Drift gate: `npm run intent:drift:strict`
7. Simulation runner: `npm run intent:sim`
8. Evaluation runner: `npm run intent:eval`
9. Policy/budget/memory gates:
   - `npm run intent:policy:gate`
   - `npm run intent:policy:decision-table`
   - `npm run intent:budget:preflight`
   - `npm run intent:safety:rails:preflight`
   - `npm run intent:memory:govern`
   - `npm run intent:safety:rails:postflight`
   - `npm run intent:replay:determinism`
   - `npm run intent:error-budget:gate`
10. Mission timeline builder: `npm run intent:timeline`
11. Runner (plan/execute + resume ledger + scored hooks): `npm run intent:run`

## Default artifact
- Compiled plan: `artifacts/intent-plan.generated.json`
- Reports:
  - `output/intent/intent-validate-report.json`
  - `output/intent/intent-compile-report.json`
  - `output/intent/intent-drift-report.json`
  - `output/intent/intent-run-report.json`
  - `output/intent/intent-run-ledger.jsonl`
  - `output/intent/safety-rails-report.json`
  - `output/intent/replay-determinism-report.json`
  - `output/intent/error-budget-gate-report.json`
  - `output/intent/rathole-snapshot.json`
- Run-scoped artifacts:
  - `artifacts/runs/<run-id>/policy-gate.json`
  - `artifacts/runs/<run-id>/policy-decision-table.json`
  - `artifacts/runs/<run-id>/budget-preflight.json`
  - `artifacts/runs/<run-id>/safety-rails-preflight.json`
  - `artifacts/runs/<run-id>/sim-result.<intentId>.json`
  - `artifacts/runs/<run-id>/eval-result.<intentId>.json`
  - `artifacts/runs/<run-id>/eval-summary.{json,md}`
  - `artifacts/runs/<run-id>/memory-governance.json`
  - `artifacts/runs/<run-id>/safety-rails-postflight.json`
  - `artifacts/runs/<run-id>/rathole-snapshot-postflight.json`
  - `artifacts/runs/<run-id>/replay-determinism.json`
  - `artifacts/runs/<run-id>/error-budget-gate.json`
  - `artifacts/runs/<run-id>/mission-timeline.ndjson`

## Typical workflow
```bash
npm run intent:validate:strict
npm run intent:compile
npm run intent:drift:strict
npm run intent:policy:decision-table
npm run intent:safety:rails:preflight
npm run test:intent:runner
npm run intent:run
```

## Execute mode (opt-in)
```bash
npm run intent:run:execute
```

## Scored execute mode (recommended for autonomous loops)
```bash
npm run intent:run:scored -- --run-id intent-run-manual-2026-03-03
```

This mode enables:
- policy gate + budget preflight/postflight
- policy decision-table verification
- safety rails preflight/postflight + rathole snapshot output
- simulation profiles per intent
- eval suite scoring + quality thresholds
- memory governance report
- replay determinism scoring
- error-budget SLO gate tracking
- mission timeline export
- dead-letter capture (`output/intent/intent-dead-letter.jsonl`)

## Resume a partially completed run
Use a stable run id so the runner can skip already-succeeded tasks and enforce plan-digest safety.

```bash
npm run intent:run:execute -- --run-id intent-run-manual-2026-03-03 --resume
```

Optional selectors:
- `--intent <intentId>` run one intent and include task dependencies.
- `--task <taskId>` run one task and include task dependencies.
- `--continue-on-error` continue scheduling independent tasks after failures.
- `--environment <local|staging|production>` enforce environment isolation policy.
- `--infra-phase <normal|ingestion>` apply ingestion-phase budget/drift overrides.

## CI gate
- Workflow: `.github/workflows/intent-drift.yml`
- Fails when:
  - any intent contract is invalid,
  - schema is missing,
  - compiled intent artifact drifts from source intent/epic state.
- Also enforces eval contract coverage for changed intents (`npm run intent:eval:gate`).
- Smoke workflow coverage: `.github/workflows/ci-smoke.yml` runs strict validate, strict drift, `test:intent:runner`, and runner plan smoke.
- Daily automation: `.github/workflows/intent-runner-daily.yml` runs validate/compile/drift/tests and executes runner plan mode on a schedule, with optional manual execute mode.

## Starter intent
- `intents/EPIC-CODEX-CONTINUOUS-IMPROVEMENT.intent.json`

## Current active intent set
- `intents/EPIC-CODEX-CONTINUOUS-IMPROVEMENT.intent.json`
- `intents/EPIC-CODEX-INTERACTION-INTERROGATION.intent.json`
- `intents/EPIC-CODEX-PR-GREEN-DAILY.intent.json`
- `intents/EPIC-EVENTS-PAGE-INDUSTRY-EVENTS-LOCAL-REMOTE.intent.json`
- `intents/EPIC-PORTAL-QA-AUTOMATION-COVERAGE.intent.json`
- `intents/EPIC-STAFF-CONSOLE-USABILITY-AND-SIGNAL-HARDENING.intent.json`
- `intents/EPIC-STAFF-PORTAL-MODULE-CONSOLIDATION.intent.json`
- `intents/EPIC-WORKSHOPS-EXPERIENCE-AND-COMMUNITY-SIGNALS.intent.json`
