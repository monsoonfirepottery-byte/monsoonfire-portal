# P3: Hubitat Physical Control Pilot (Capability-gated, Write-Capable)

Status: Proposed
Priority: P3
Severity: Sev2
Component: studio-brain
Impact: high
Tags: studio-brain, connectors, hubitat, safety, write-path

## Problem
Studio Brain already has Hubitat reads and audit trail for connector health, but it is read-only by design. You already have Hubitat integrations working and want Smart Home communication from Studio Brain itself.

We need a controlled, auditable write-capable path that can execute only approved, low-risk commands (for example, lamp/fan/relay toggles for kiln-room environment support) without eroding safety guarantees.

## Scope
- `studio-brain/src/capabilities/**/*`
- `studio-brain/src/connectors/hubitatConnector.ts`
- `studio-brain/src/http/server.ts`
- `studio-brain/src/connectors/testing/*` (contract harness updates for write-capable dry-run paths)
- `web/src/views/staff/StudioBrainModule.tsx` (proposal review/approval UX if exposed)
- `functions/src/v3Execution/pilotFirestoreAction.ts`
- `functions/src/v3Execution/rollbackStudioBrainPilotAction.ts`

## Goals
1. Provide a narrow first pilot write capability for Hubitat with explicit "dry-run -> execute -> audit" lifecycle.
2. Keep write operations impossible without policy/approval and an explicit actor.
3. Keep read-only behavior unchanged for most environments.

## Tasks
1. Add a proposal-safe write capability family for Hubitat:
   - candidate IDs: `hubitat.devices.control`, `hubitat.device.action.execute`.
   - include explicit risk tier and explicit allowed action schema in registry.
2. Extend Hubitat connector execution path:
   - support write intent with an allowlist of command shapes.
   - enforce schema-level action validation and deterministic device id/type constraints.
   - include action output normalization for audit.
3. Add dry-run preview in `studio-brain` proposal/execution flow:
   - preview payload + predicted state changes.
   - reject unknown/unsupported actions before execution.
4. Add audit and security gates:
   - immutable audit row includes proposalId, approvalId, actorId, idempotency key, pre-hash, post-hash.
   - command redaction for secrets and auth material.
   - hard-fail in kill-switch mode or when policy kill-band is active.
5. Add rollback semantics for pilot actions when possible (e.g., explicit reverse command templates).
6. Add connector/driver tests:
   - allowed write payload validation,
   - deny-by-default when approvals missing,
   - audit completeness assertions.
7. Update staff UX to show write-capable capability actions only when approved/reviewed.

## Acceptance
- Read-only Hubitat behavior remains default and unchanged.
- No Hubitat write command can execute without:
  - valid actor,
  - explicit policy approval,
  - proposal execution path,
  - idempotency key.
- Dry-run output and final execution logs are emitted for every attempted write.
- Rollback command path exists and is gated by explicit action policy.
- No production automation of write actions occurs without approvals and kill-switch checks.

## Dependencies
- `tickets/v3/P1-v3-capability-registry-proposal-approval-audit.md`
- `tickets/v3/P1-v3-approval-ui-in-staff-console.md`
- `tickets/v3/P1-v3-policy-exemptions-and-kill-switch.md`
- `tickets/v3/P2-v3-write-path-pilot-firestore-approved-actions.md`
- `tickets/v3/P1-v3-connector-test-harness.md`

## Risks
- Misconfigured command allowlist causing unsafe device activation.
- Replay/race on idempotency key handling.
- Retry storms from transient device outages.
- Operator confusion if write capability is exposed before staff training docs are complete.
