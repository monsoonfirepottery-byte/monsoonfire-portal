# EPIC: CODEX-CONTINUOUS-IMPROVEMENT

Status: Active  
Owner: Platform / DevEx  
Created: 2026-02-26

## Mission

Build a safe, autonomous continuous-improvement system that runs twice daily, reviews engineering activity plus Codex/tooling friction over the last 12-24 hours, and proposes targeted improvements through issues and bot-branch PRs.

## Why This Exists

- Repeated failures cost focus and cycle time.
- Small recurring paper cuts are often untracked.
- We need a predictable mechanism that proposes improvements with evidence, risk framing, and guardrails.

## Non-Goals

- Blame attribution or individual performance scoring.
- Unbounded autonomous refactors.
- Any direct push to `main`.
- Any behavior that can trigger automation loops.

## Scope

- Analyze repository signals:
  - Git commits/churn/reverts
  - PR activity
  - CI failure signatures
  - Config/metadata churn
  - Codex tool-call failures from `.codex/toolcalls.ndjson`
- Maintain run memory in `.codex/improvement-state.json`.
- Append human-readable run history to `.codex/improvement-log.md`.
- Open/refresh improvement tickets and one bot-branch PR per run when thresholds trigger.
- Keep a rolling GitHub issue updated each run.
- Produce a rubric scorecard artifact for agent performance:
  - reliability
  - speed/latency
  - token efficiency
  - throughput
  - outcome quality
- Run random telemetry audits to detect suspicious or incoherent toolcall stats before trusting trend reports.
- Operate a backlog autopilot loop that auto-queues prioritized tickets and opens/updates capped issue slices.

## Safety Guardrails

- PR-only automation: never push to `main`.
- One PR maximum per run ID (`YYYY-MM-DD-AM|PM`).
- Loop prevention:
  - ignore `.codex/improvement-log.md` and `.codex/improvement-state.json` as churn signals
  - skip when run ID already processed
  - avoid PR-trigger recursion by using schedule/dispatch only and ignoring `automation`-labeled PRs in analysis
- Secret hygiene:
  - redact tokens/passwords/secrets in tool logs
  - never persist bearer tokens or raw credential payloads

## Run Cadence (Phoenix Time)

- 06:10 AM America/Phoenix (MST)
- 03:10 PM America/Phoenix (MST)
- Primary analysis window: last 12h
- Secondary rollup: last 24h

## Detection Rules

Create/refresh improvement tickets when any are true:

- `errorType` appears >= 2 times in 24h
- repeated CI failure signature
- tool failure rate > 10%
- file touched in >= 4 commits (24h)
- unstable metadata/config churn

## Outputs Per Run

- Append section to `.codex/improvement-log.md` with:
  - Activity Summary
  - Failure Clusters
  - Tool Call Analysis
  - Metadata Changes
  - Impact Summary
  - Auto-Created Tickets
  - PRs Created
  - Next 12h Focus
- Update rolling issue: `Codex Continuous Improvement (Rolling)`.
- Create/update one automation PR (bot branch) when improvements are triggered.
- Emit rubric artifacts:
  - `output/qa/codex-agentic-rubric-scorecard.json`
  - `output/qa/codex-agentic-rubric-scorecard.md`
- Emit telemetry audit artifacts:
  - `output/qa/codex-telemetry-random-audit.json`
  - `output/qa/codex-telemetry-random-audit.md`

## Agentic Rubric v1

Weights:
- Reliability: 32%
- Speed: 23%
- Token Efficiency: 20%
- Throughput: 10%
- Outcome Quality: 15%

Primary targets:
- success rate >= 97%
- p95 duration <= 8000 ms
- MTTR <= 30 minutes
- token coverage >= 70%
- tokens per successful call <= 3000
- recommendation closure >= 75%

## Acceptance Criteria

- Twice-daily workflow runs at Phoenix-equivalent UTC schedules.
- Run IDs resolve correctly for AM/PM in `America/Phoenix`.
- Tool-call contract is append-only and redacts sensitive fields.
- State file is updated each run and used to compute impact deltas.
- Duplicate run IDs are skipped safely.
- Automation never pushes to `main`.
- Rubric scorecard is generated and archived on each `Codex Self Improvement` run.
- Random telemetry audit runs with strict anomaly threshold and fails when anomaly rate is above the configured limit.
- Backlog autopilot runs on schedule and maintains `Codex Backlog Autopilot (Rolling)` with capped issue fan-out.

## Risks

- Over-triggering tickets from noisy CI/tool logs.
- GitHub API availability/auth constraints in non-CI environments.
- Drift if state file is not merged regularly.

## Mitigations

- Conservative thresholds and de-duplication markers.
- Dry-run default for local execution.
- Graceful degradation when GitHub APIs are unavailable.
- Evidence-first PR/issue bodies with explicit risk and QA notes.
