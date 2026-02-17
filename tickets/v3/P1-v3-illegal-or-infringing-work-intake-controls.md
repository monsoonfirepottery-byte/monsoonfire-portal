# P1: Illegal / Infringing Work Intake Controls

## Goal
Prevent agent-driven workflows from progressing when requests appear illegal, unsafe, or likely to infringe IP/copyright/trademark policy.

## Non-goals
- No fully automated legal adjudication.
- No hard-coded country-specific legal engine in first release.

## Acceptance Criteria
- Intake classifier supports rule categories: `illegal_content`, `weaponization`, `ip_infringement`, `fraud_risk`, `unknown`.
- High-risk categories are auto-routed to manual-review queue and cannot auto-execute.
- Staff decisions require reason codes and are auditable.
- Proposal UI displays risk banner and blocked capability rationale.

## Files/Dirs
- `functions/src/trustSafety/**`
- `functions/src/agentPolicy/**`
- `web/src/views/StaffView.tsx`
- `docs/policies/AGENT_WORK_INTAKE_POLICY.md`

## Tests
- Unit tests for category mapping and thresholding behavior.
- Integration tests ensuring high-risk requests are blocked from execution.
- Regression tests for false-positive override flow by staff.

## Security Notes
- Minimize payload retention; store hashes/summaries where possible.
- Never expose private reports or moderation metadata to non-staff users.

## Dependencies
- `P1-v3-capability-registry-proposal-approval-audit.md`
- `P1-v3-agent-identity-bridge-and-delegation-enforcement.md`

## Estimate
- Size: M

## Telemetry / Audit Gates
- Events: intake classified, routed_to_review, override_granted, override_denied.
- Category-level weekly counts and decision consistency metrics.

## Rollback
- Force all flagged categories to manual review only.
- Disable automated category scoring while preserving hard blocklists.
