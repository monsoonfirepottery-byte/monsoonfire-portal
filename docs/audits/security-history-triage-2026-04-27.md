# Security History Scan Triage - 2026-04-27

Scope: audit findings AH-P1-006 and AH-P2-005.

Raw secret values were not printed, copied, or committed during this triage.

## Specific Discord/Clawbot Markers

Command:

```bash
npm run security:history:scan
```

Result:

- total matches: 4
- Discord webhook literal matches: 0
- Discord token literal matches: 0
- Discord/clawbot token variable-assignment markers: 2
- clawbot/clawdbot text markers: 2

Sampled commits:

- `bd95c75b1998481d532ddf46b55e537634c1c5cf`
- `3709a1c8bfe2bafc3ab602321a4518312869aaa2`

Path/line triage, redacted:

- `scripts/security-history-scan.mjs`: scanner pattern definitions for Discord/clawbot tokens and marker text.
- `docs/runbooks/SECURITY_HISTORY_REWRITE_PLAYBOOK.md`: rewrite playbook text and redaction examples.

Classification: non-secret scanner/playbook references. No webhook literal or Discord token literal was detected by the specific scan. No rotation action is indicated by this sampled evidence.

## Generic Secret-Assignment Markers

Command:

```bash
node ./scripts/security-history-scan.mjs --json --include-generic --max-per-pattern 10
```

Result:

- total matches: 50
- specific Discord/clawbot matches: 4, classified above
- generic secret-assignment matches: 46
- sampled generic commits: 10

Sampled path families, redacted:

- `functions/.env.local.example`
- `functions/src/stripeSecrets.ts`
- `scripts/*`
- `scripts/lib/*`
- `scripts/codex/*`
- `studio-brain/*`
- `docs/agent-troubleshooting-history.md`

Classification: noisy generic pattern over env-var names, placeholder/test fixtures, secret-loader code, deploy/config constants, and documentation references. The sampled evidence did not identify a confirmed raw credential exposure.

Operational decision:

- Keep `npm run security:history:scan` as the specific Discord/clawbot gate.
- Keep `security:history:scan:broad` as a manual triage tool, not a strict routine gate, unless the generic pattern is split into lower-noise families.
- Rotate only on confirmed exposure evidence; none was confirmed in this sampled triage.

Follow-up:

- If future broad scans need to become strict, tune `generic_secret_assignment` into narrower families with fixture and docs-aware classifications rather than one broad regex.
