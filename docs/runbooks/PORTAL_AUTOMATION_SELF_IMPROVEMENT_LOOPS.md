# Portal Automation Self-Improvement Loops

Purpose: define how portal automation now self-observes, opens remediation work, and publishes trend-aware tuning guidance.

## Scope

This runbook covers the loops added around:
- Daily authenticated canary
- Firestore index contract guard
- Post-deploy promotion gate
- Production smoke
- PR functional gate

## Architecture

1. Daily health dashboard (`.github/workflows/portal-automation-health-daily.yml`)
- Aggregates the most recent 24-48h run history (default 48h).
- Downloads workflow artifacts and parses loop outputs.
- Emits:
  - `output/qa/portal-automation-health-dashboard.json`
  - `output/qa/portal-automation-health-dashboard.md`
  - `output/qa/portal-loop-threshold-tuning.json`

2. Repeated-signature issue loop (`scripts/portal-automation-issue-loop.mjs`)
- Reads the daily dashboard.
- Detects repeated failure signatures (count >= 2 by default).
- Applies noise controls before opening work:
  - global cap (`--max-issues`, default 6)
  - per-workflow cap (`--max-per-workflow`, default 2)
  - dedupe by normalized signature family
  - generic placeholder signature suppression unless explicitly enabled
- Creates/updates focused GitHub issues with evidence and remediation guidance.
- Updates rolling tuning threads, including canary feedback directives.

3. Weekly digest (`.github/workflows/portal-automation-weekly-digest.yml`)
- Pulls recent daily dashboard artifacts.
- Computes trend deltas:
  - pass-rate movement
  - top flaky signatures
  - newly-emerged remediation candidates
- Posts a rolling weekly digest comment when apply mode is enabled.

## Decision Log (Why This Shape)

1. Window choice: 48h default
- We need enough run density to separate one-off flakes from recurring patterns.
- 48h captures multiple schedule cycles without overfitting to stale behavior.

2. Signature-first escalation
- Issues open only for repeated signatures, not isolated single failures.
- This keeps the issue queue actionable and reduces noise.

3. Markdown + JSON dual output
- JSON is stable machine input for other loops.
- Markdown gives operators and future agents readable context quickly.

4. Tuning recommendations stay explicit
- Dashboard recommends threshold changes and documents rationale.
- Canary directive lines are posted as explicit comment-based controls for traceability.

## Operating Modes

1. Dry run (safe audit)
```bash
npm run portal:automation:dashboard
npm run portal:automation:issues
npm run portal:automation:weekly-digest
```

2. Apply mode (write actions)
```bash
npm run portal:automation:issues:apply
npm run portal:automation:weekly-digest:apply
```

3. CI scheduled operation
- Daily: `Portal Automation Health Daily` every 6 hours.
- Weekly: `Portal Automation Weekly Digest` every Monday.

## Agent Handoff Notes

- Treat `portal-automation-health-dashboard.json` as the canonical signal snapshot.
- Prefer fixing deterministic root causes over increasing retries.
- If a signature appears in 2+ consecutive weekly digests, escalate severity and require a specific prevention change.
