# Agent Security Playbook

This runbook covers first-response actions for agent auth failures, PAT abuse, and endpoint overload in Monsoon Fire Portal.

## Scope
- PAT (`mf_pat_v1.*`) auth failures
- Delegated token auth failures
- Agent API traffic spikes and rate limiting
- Emergency controls in Staff Agent Ops

## Primary signals
- `securityAudit` (auth success/deny/error with request metadata)
- `integrationTokenAudit` (`created`, `used`, `revoked`, `failed_auth`)
- Staff Agent Ops audit panel (deny/error filters, source filters, date windows)

## Fast triage checklist
1. Confirm blast radius:
   - Is denial isolated to one token/client or broad?
   - Is endpoint-level rate limit triggered globally or per actor/IP?
2. Validate current controls:
   - `agentApiEnabled`
   - `agentPaymentsEnabled`
   - per-client status (`active`, `suspended`, `revoked`)
3. Confirm failure mode:
   - `PAT_TOKEN_NOT_FOUND`
   - `PAT_REVOKED_OR_INVALID`
   - `PAT_HASH_MISMATCH`
   - delegated signature/audience/nonce replay errors

## Incident actions
### A) Single token compromise suspected
1. Revoke token in Staff Integrations.
2. Rotate client key in Agent Ops if token is tied to a managed client.
3. Confirm no continued `used` events for revoked token in `integrationTokenAudit`.

### B) Coordinated abuse / high deny spike
1. Suspend affected client(s) from Agent Ops.
2. Raise strict allowlist posture (deny unknown clients).
3. If needed, disable `agentApiEnabled` temporarily (kill switch).
4. Continue monitoring `securityAudit` deny/error rates.

### C) Suspected pepper compromise
1. Generate new `INTEGRATION_TOKEN_PEPPER`.
2. Update runtime secret/config.
3. Revoke all active PATs and require re-issuance.
4. Validate new token creation/use path with smoke test.

## Pepper rotation procedure
1. Generate new random secret (minimum 32 bytes).
2. Update Functions secret/env for `INTEGRATION_TOKEN_PEPPER`.
3. Deploy functions.
4. Revoke existing tokens via Staff Integrations or scripted operation.
5. Ask integrators to mint new PATs.
6. Verify:
   - old tokens fail with `failed_auth`
   - new tokens succeed and log `used`.

## Post-incident
- Capture timeline:
  - detection time
  - controls toggled
  - tokens/clients revoked
  - recovery confirmation
- Add remediation tasks to tickets (policy/rate-limit/scope tightening).

## Verification commands
- Agent smoke:
  - `node functions/scripts/agent_smoke.js --pat "<TOKEN>"`
