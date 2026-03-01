# Codex Agentic Rubric And Backlog Autopilot

## Purpose

Define a measurable, repeatable operating loop for Codex automation that optimizes:
- correctness and reliability
- speed
- token efficiency
- delivery throughput
- backlog flow with minimal manual prompts

## Environment Autonomy Policy

- Portal (construction phase): default to autonomous apply-mode loops on schedule.
- Website (production-grade): keep stricter release gating and human review expectations.
- This policy should be revisited when portal reaches production readiness.

## In-Repo Implementation

### Scripts
- `scripts/codex/rubric-scorecard.mjs`
  - Builds weighted rubric scorecards from `.codex/toolcalls.ndjson` + `.codex/improvement-state.json`.
- `scripts/codex/telemetry-random-audit.mjs`
  - Random-sample audit to sanity-check logged telemetry and detect suspicious stats.
- `scripts/codex/backlog-autopilot.mjs`
  - Pulls prioritized backlog queue from `epic-hub-runner`, applies policy filters, and opens/updates capped issue slices plus rolling summary.
- `scripts/codex/log-toolcall.mjs`
  - Supports optional token usage fields for richer efficiency scoring.

### NPM commands
- `npm run codex:rubric:daily`
- `npm run codex:rubric:daily:write`
- `npm run codex:rubric:strict`
- `npm run codex:telemetry:audit`
- `npm run codex:telemetry:audit:write`
- `npm run codex:telemetry:audit:strict`
- `npm run codex:backlog:autopilot`
- `npm run codex:backlog:autopilot:apply`

### Workflows
- `.github/workflows/codex-self-improvement.yml`
  - Runs daily-improvement + rubric scorecard + strict telemetry random audit.
- `.github/workflows/codex-backlog-autopilot.yml`
  - Scheduled backlog dispatch loop with capped issue fan-out and telemetry audit artifact.
- `.github/workflows/codex-automation-findings-summary.yml`
  - Includes Backlog Autopilot in rolling digest sources.

## Rubric Definition (v1)

Weights:
- Reliability: 32%
- Speed: 23%
- Token Efficiency: 20%
- Throughput: 10%
- Outcome Quality: 15%

Targets:
- success rate >= 97%
- repeat failure bursts <= 2
- p95 latency <= 8000 ms
- MTTR <= 30 minutes
- token telemetry coverage >= 70%
- tokens per successful call <= 3000
- successful calls/hour >= 0.25
- recommendation closure >= 75%
- PR health >= 90

Outputs:
- `output/qa/codex-agentic-rubric-scorecard.json`
- `output/qa/codex-agentic-rubric-scorecard.md`

## Trust-But-Verify Guardrail

Random telemetry audit checks:
- contract shape (`tsIso`, `actor`, `tool`, `action`, `ok`)
- duration sanity (non-negative, bounded outliers)
- error coherence (`ok=false` should include failure context)
- usage coherence (for entries with usage)
- duplicate cluster detection

Strict failure condition:
- anomaly rate > configured threshold (`--max-anomaly-rate`, default 0.15 in strict loop)

Outputs:
- `output/qa/codex-telemetry-random-audit.json`
- `output/qa/codex-telemetry-random-audit.md`

## Backlog Autopilot Policy

Default behavior:
- pulls queue via `scripts/epic-hub-runner.mjs`
- falls back to standalone open tickets in `tickets/` when epic-linked queue is empty/incomplete
- applies lending-library exclusion regex by default
- caps issue creation per run (`--max-issues`, default 8)
- updates rolling issue: `Codex Backlog Autopilot (Rolling)`
- never pushes code to `main`

Default schedule:
- 07:30 America/Phoenix (14:30 UTC)
- 16:30 America/Phoenix (23:30 UTC)

## Preflight Checklist

Fast local checks:
```bash
npm run codex:rubric:daily
npm run codex:telemetry:audit
npm run codex:backlog:autopilot
```

Artifact-producing checks:
```bash
npm run codex:rubric:daily:write
npm run codex:telemetry:audit:write
node ./scripts/codex/backlog-autopilot.mjs --dry-run --write --json
```

Strict verification:
```bash
npm run codex:rubric:strict
npm run codex:telemetry:audit:strict
```

Note:
- `codex:rubric:strict` currently requires token telemetry coverage >= 50%.

## Success Criteria

- rubric artifacts generated each self-improvement cycle
- telemetry audit remains below anomaly threshold
- backlog autopilot creates/updates backlog issues without operator prompts
- findings summary includes backlog-autopilot health

## Rollback Plan

If loops are noisy or over-trigger:
1. Disable apply mode by running manual dispatch with `apply=false`.
2. Temporarily disable scheduled loop in:
   - `.github/workflows/codex-backlog-autopilot.yml`
3. Reduce fan-out:
   - lower `--max-issues`
   - tighten `--epic` selector
4. Keep telemetry/rubric loops active in dry-run while tuning thresholds.

## External Framework References

Benchmarks and standards used to shape rubric design:
- SWE-bench Verified leaderboard: https://www.swebench.com/
- SWE-bench contamination update: https://openai.com/index/why-we-stopped-using-swe-bench/
- GAIA benchmark paper: https://arxiv.org/abs/2311.12983
- AgentBench paper: https://arxiv.org/abs/2308.03688
- MCP-Bench paper: https://arxiv.org/abs/2504.11018
- OpenTelemetry GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- DORA metrics overview: https://cloud.google.com/architecture/devops/devops-measurement
