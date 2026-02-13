# Studio OS v3 Definition of Done

Cloud remains authoritative; local computes and proposes; irreversible actions require approval; everything is auditable; system fails safe.

## Global DoD (applies to every v3 ticket)
- Functional:
  - Acceptance criteria are demonstrably met in local/staging environment.
  - No regression to portal/website/function production behavior.
- Security:
  - Server-side authorization enforced for privileged actions.
  - No new secret exposure path in client logs/UI.
  - Abuse controls and denial reason codes present where relevant.
- Auditability:
  - Action path emits structured events with actor, action, target, outcome.
  - Input/output hashes captured for privileged operations.
- Reliability:
  - Explicit degraded mode and rollback path documented and tested.
  - Error states are visible; no blank-screen failures.
- Quality:
  - Unit/integration tests added or updated.
  - Documentation/runbook updated for behavior change.

## Write-Path DoD (for any capability enabling external writes)
- Requires valid capability mapping and policy evaluation.
- Requires approval state unless explicit, time-bounded exemption exists.
- Includes idempotency keys and replay-safe behavior.
- Includes kill-switch compatibility test.

## Release Readiness DoD (milestone-level)
- P0: Runtime + snapshot + drift guardrails + observability all green.
- P1: Approval, policy, identity delegation, and connector harness all green.
- P2: Pilot write flow + DR drill + scorecard + governance lint all green.
