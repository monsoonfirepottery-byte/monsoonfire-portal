# EPIC: CODEX-INTERACTION-INTERROGATION

Status: Active  
Owner: Platform / DevEx  
Created: 2026-02-26

## Mission

Continuously interrogate recent interaction patterns (Codex + human collaboration) and apply structural improvements to `.codex/user.md` and `.codex/agents.md` that reduce ambiguity, friction loops, and workflow drift.

## Non-Goals

- Personality rewriting
- Cosmetic wording churn
- High-frequency micro-edits without structural impact

## Cadence (Phoenix Time)

- 06:40 AM America/Phoenix (MST year-round)
- 03:40 PM America/Phoenix (MST year-round)
- Primary window: last 12h
- Secondary rollup: last 24h

## Signals

- Git commit messages
- PR comments and review discussions
- Issues opened/closed
- Reverts
- Clarification loop patterns
- File churn hotspots
- Automation-created tickets/PR metadata
- Tool-call retry/confusion clusters
- Metadata/workflow edits linked to misunderstanding

## Trigger Thresholds

Automation proposes structural updates only when at least one threshold is crossed:

- Same misunderstanding pattern appears >= 2 times in 24h
- Clarification loop exceeds 3 back-and-forth comments
- Same workflow rule is restated multiple times
- Repeated structurally-similar automation misinterpretation
- Repeated tool misuse cluster

## Improvement Targets

- `.codex/user.md`
  - expectation clarity
  - constraints + scope boundaries
  - output format non-negotiables
- `.codex/agents.md`
  - role guardrails
  - ask-vs-decide decision policy
  - tool usage + retry boundaries
  - branch protection + delivery behavior

## Safety Guardrails

- PR-only automation, never direct push to `main`
- At most one interaction-improvement PR per run ID
- Existing run PR must be updated, not duplicated
- Shared state with continuous-improvement loop via `.codex/improvement-state.json`
- Never open more than one automation PR per run across enabled loops
- Loop prevention:
  - ignore `.codex/user.md`, `.codex/agents.md`, and this epic file in churn detection
  - skip already-processed run IDs
  - ignore automation-labeled PRs in interaction signal analysis

## Required Outputs

- Append run record to `.codex/interaction-log.md`
- Update rolling issue: `Codex Interaction Interrogation (Rolling)`
- When triggered, open/update PR from:
  - `codex/interaction-improve/YYYY-MM-DD-AM`
  - `codex/interaction-improve/YYYY-MM-DD-PM`

## Acceptance Criteria

- Twice-daily workflow executes on Phoenix-equivalent UTC cron
- Threshold-driven batching prevents cosmetic churn
- Structural improvements are auditable and evidence-based
- PR body includes analysis, before/after, risk assessment, and QA guidance
- Branch protection expectations are preserved in all automation paths
