# Governance Triangle Control Plane

This directory defines the repository-native governance system for:

- `Strategist` (intent authoring and risk framing)
- `Executor` (bounded implementation and evidence collection)
- `Supervisor` (trust-but-verify auditing and intervention)

The system is designed as a gyroscope, not a leash:

- It does not micromanage every step.
- It audits on cadence and triggers.
- Early intervention is `pause for verification + documentation`.

## Directory layout

- `schemas/`
  - Versioned schema contracts for intent, plan step, evidence, audit event, run ledger, and capability manifest.
- `intents/`
  - Example intent contracts for common operating modes.
- `config/`
  - Supervisor thresholds, intervention ladder settings, and authority mapping.
- `audit/`
  - Append-only audit chain location for local runs.

## Evidence trust order (highest to lowest)

1. Human feedback from verified identity
2. Direct tool outputs (CI, tests, git/rg, command outputs)
3. Repo docs with commit hash
4. Memory entries with provenance pointer
5. Agent statements

Rule: Tier-5 evidence is never sufficient on its own.

## Initial operating posture

- Higher false-positive tolerance while tuning.
- Default intervention: verification hold with focused questions.
- Destructive corrective action is future-gated behind stronger thresholds.

