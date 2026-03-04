# Agent Governance Triangle Runbook

## Purpose

Run a repository-native 3-agent governance loop with PR + CI artifacts as the primary control surface.

Agents:

- Strategist / Intent Author
- Executor / Builder
- Supervisor / Trust-But-Verify

Default philosophy:

- Gyroscope not leash.
- Intervene on cadence or triggers, not continuously.
- Early intervention = verification hold + documentation.

## Core operating rules

- Supervisor distrusts agent statements unless independently evidenced.
- Tier-5 (agent statements) can never stand alone.
- Audit event is written before hold/escalation action.
- Human decisions are first-class Tier-1 evidence and must be linked.

## Evidence trust tiers

1. Human feedback from verified identity
2. Direct tool output (CI, tests, git/rg, command output)
3. Repo docs with commit hash
4. Memory entries with provenance pointer
5. Agent statements

## Control-plane artifacts

- Intent schemas and examples: `.governance/intents/`
- Validation script: `scripts/governance/validate-governance-artifacts.mjs`
- Supervisor script: `scripts/governance/supervisor-audit.mjs`
- Validation workflow: `.github/workflows/governance-intent-contract-validate.yml`
- Supervisor workflow: `.github/workflows/governance-supervisor.yml`
- Decision templates: `.github/ISSUE_TEMPLATE/decision-request.yml`

## Supervisor cadence and triggers

Cadence default:

- Audit every 3 execution steps or 20 minutes.

Trigger conditions:

- Repeated CI failure signature (>=3)
- No success-criteria progress after 3 steps
- Scope breach (any out-of-scope file)
- Budget warn (>80%) or hard stop (>=100%)

## Intervention ladder

Level 0 Observe:

- Post scorecard comment.
- No hold label.

Level 1 Verify Hold:

- Apply `verification-hold` label (active mode).
- Post what is verified/unverified.
- Ask up to 3 focused questions.

Level 2 Escalate Human:

- Open `Audit Escalation` issue.
- Present proceed / re-scope / abandon options.

Level 3 Corrective Action (future-gated):

- Corrective PR allowed only with strong evidence and authority gate.

## Verification hold playbook

1. Supervisor posts `Audit Findings` and applies hold (active mode).
2. Human responds through PR comment or Decision Request issue.
3. Strategist updates intent contract when scope/constraints change.
4. Executor executes smallest evidence-producing step.
5. Supervisor re-audits and either releases hold or escalates.

## Repeated CI failure loop playbook

1. Mark pattern as loop when same signature repeats.
2. Hold for verification.
3. Require focused root-cause evidence for one failing check.
4. Escalate if loop repeats after intervention.

## Suspected memory poisoning playbook

1. Flag suspicious memory entries.
2. Exclude from evidence tiering until corroborated.
3. Require tier 1-3 corroboration.
4. Record integrity-related audit event.

## False-positive triage playbook

1. Human applies dismissal reason in PR/issue.
2. Capture dismissal as tuning evidence.
3. Tune thresholds weekly by intent risk class.

## Urgent release valve

1. Authorized human applies urgent override decision.
2. Supervisor records override with risk summary.
3. Post-merge follow-up audit issue is required.

## Configuration

- Thresholds: `.governance/config/supervisor-thresholds.json`
- Authority mapping: `.governance/config/authority-map.json`
- Supervisor mode:
  - `passive` (default): comment-only
  - `active`: holds + escalation actions

## Operator quickstart (SSH friendly)

Use these short commands for routine governance operations:

```bash
npm run governance:validate
npm run governance:weekly:tune
npm run governance:remote:sync:check
npm run governance:execute:until-blocked
```

Notes:

- `governance:weekly:tune` auto-resolves repo owner/name from CI env first, then from `.git/config` (`origin` remote).
- It also auto-resolves auth from `GITHUB_TOKEN`/`GH_TOKEN`, then falls back to `gh auth token` when available.
