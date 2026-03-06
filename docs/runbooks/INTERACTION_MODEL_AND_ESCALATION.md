# Interaction Model and Escalation Playbook

Purpose: Prevent recurring protocol failure during operational support sessions and keep recovery deterministic under frustration or auth churn.

## Use this when: repeated auth/import failures, terminal sync breakage, or repeated command signature churn.

- Apply this model before action.
- Keep this runbook in the same scope as user session constraints.

## Operating assumptions

- Treat all credentials as `unknown` unless explicitly confirmed.
- Do not assume any value is available locally or in the terminal session.
- Do not assume copied values are complete if they are UUID-like without explicit context.
- Never ask for the same thing twice.
- If one command signature fails twice, do not run it again.
- Prefer one-command, scripted execution paths over hand-copied multi-line commands.

## Severity ladder

1. `S0` Blocker-critical
   - Wrong environment, wrong credentials model, wrong auth mode (confidential vs public), command targeting wrong host.
   - Action: stop current command path, update assumption map, switch branch with explicit fallback.

2. `S1` Repeated auth failure
   - Same OAuth flow fails with same signature.
   - Action: report root class once (`invalid_client`, tenant missing, callback mismatch), then move to alternate path.

3. `S2` Friction-only noise
   - copy/paste friction, quoting/line breaks, terminal mismatch, user fatigue.
   - Action: provide a wrapper command and a one-command fallback in the same response.

## Failure-class map

- **Auth: tenant/authority**
  - Symptom: tenant missing/invalid, AADSTS50059, AADSTS90059.
  - Next action: do not loop device/browser; validate tenant/client IDs in a single message and ask for one missing item only.

- **Auth: client type mismatch**
  - Symptom: AADSTS7000218 invalid_client.
  - Next action: classify as confidential-vs-public mismatch.
  - If no secret value is available, switch immediately to IMAP fallback or pause on explicit reconfigure path.

- **Auth: scope mismatch**
  - Symptom: AADSTS70011 invalid_scope.
  - Next action: verify flow expects `Mail.Read offline_access` and app permissions match delegated flow.

- **Transport/session**
  - Symptom: resets, auth code missing, callback never returns.
  - Next action: remove terminal assumptions, keep local host callback off-limits unless host is stable.

- **Copy/paste/context**
  - Symptom: command split/quoted, repeated “why didn’t that work?” with no code change.
  - Next action: collapse response to one script-driven command.

## Escalation protocol

For every failed signature:
- Capture in order: `command`, `failure class`, `exact blocker`.
- Provide exactly one unblock step.
- Provide one alternate execution path.
- Do not retry the same command signature.

## Default branches

### Branch A: OAuth path still possible
- Confirm credential assumptions explicitly:
  - tenant: known/unknown
  - client-id: known/unknown
  - secret requirement: unknown/public/confidential
- Run the SSH-safe OAuth flow command with `--run-import false` first.
- If token acquisition succeeds, execute import run with `--run-import true`.

### Branch B: OAuth blocked
- Immediately switch to IMAP fallback command path with stable defaults already defined in secrets.
- Keep burst limiter disabled for recovery and use explicit `--max-items` / `--chunk-size`.
- Do not continue OAuth retries in the same strategy.

## Mandatory response structure during blocked states

- `Status: blocked`
- `Blocker: ...`
- `Next Action: ...`
- `Fallback: ...`

## Quality gates (for this model)

- No repeated identical command signatures on the same failure class.
- No credential-type confusion (GUID vs secret confusion forbidden).
- No manual copy/paste dependency introduced into primary path.
- At least one fallback branch emitted when primary fails.

## One-command templates

### SMTP-like IMAP fallback
```bash
npm run mail:import:office-imap:ssh
```
When you want deterministic run IDs/sizes:
```bash
npm run mail:import:office-imap:ssh:fast
```
Optional override for the same branch:
```bash
npm run open-memory:mail:import:office-imap:ssh -- --run-id mail-office-imap-recovery --max-items 5000 --chunk-size 300
```

### OAuth device path with no secret assumption
```bash
npm run mail:oauth:outlook:device:ssh
```
Browser variant:
```bash
npm run mail:oauth:outlook:browser:ssh
```

## Review cadence

- This playbook is reviewed whenever a high-friction run occurs.
- Any new repeated blocker pattern should create a short postmortem runbook entry.
