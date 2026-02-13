# Capability / Connector ADR Template

Use this template for any new capability or connector that can affect Studio OS behavior.

## 1. Summary
- Change type: capability | connector
- ID:
- Owner:
- Date:

## 2. Scope
- Target system:
- Read-only or write-capable:
- Risk tier: low | medium | high | critical
- Approval mode: required | exempt

## 3. Policy + Safety
- Rationale:
- Rollback plan:
- Escalation path for exemption requests:
- Abuse/rate-limit considerations:

## 4. Contracts
- Input shape:
- Output shape:
- Failure modes:
- Audit event(s) emitted:

## 5. Verification
- Unit tests:
- Integration tests:
- Smoke/soak checks:

## 6. Rollout
- Feature flag / staged rollout:
- On-call owner:
- Backout trigger:
