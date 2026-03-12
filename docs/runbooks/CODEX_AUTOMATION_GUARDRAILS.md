# Codex Automation Guardrails

Use this runbook when Codex or Spark automation starts spending quota unexpectedly.

## Commands

```bash
npm run codex:automation:audit
npm run codex:automation:status
npm run codex:automation:pause
npm run codex:automation:install-systemd
```

## Source of Truth

- Budget and pause defaults live in `config/codex-automation-budget.json`.
- Runtime tripwires and cooldowns persist in `output/codex-automation/control-state.json`.
- Historical model attribution comes from `output/intent/codex-procs/*.report.json`.
- `.codex/toolcalls.ndjson` is supplemental until model attribution is consistently populated there.

## Default Safety Posture

- Unattended Codex automation is paused by default.
- `gpt-5.3-codex-spark` is blocked for automation by default.
- The tracked `monsoonfire-overnight` systemd unit installs with `CODEX_PROC_ENABLED=0` and the timer disabled.

## Local Recovery

If the nightly systemd launcher is the culprit, disable it immediately:

```bash
systemctl --user disable --now monsoonfire-overnight.timer monsoonfire-overnight.service
```

Then reinstall the tracked paused unit files:

```bash
npm run codex:automation:install-systemd
```
