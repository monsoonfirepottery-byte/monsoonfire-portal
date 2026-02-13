# P2: Trust & Safety Assistive Triage

## Goal
Add assistive triage suggestions to community reporting workflows without automatic enforcement actions.

## Non-goals
- No autonomous bans/unpublish decisions.
- No replacement of policy-aware staff review.

## Acceptance Criteria
- Triage assistant suggests severity/category/reason codes for reports.
- Suggestions remain editable and require staff confirmation.
- Suggestion provenance and model/version metadata are logged.
- Existing report actions still require explicit staff action.

## Files/Dirs
- `studio-brain/src/swarm/trustSafety/**` (new)
- `web/src/views/staff/ReportsModule.tsx` (integration point)

## Tests
- Unit tests for suggestion ranking and policy mapping.
- Negative tests for disallowed auto-action paths.

## Security Notes
- Suggestion-only mode is enforced.
- Policy alignment and auditability are mandatory.

## Dependencies
- Existing community report pipeline (`functions/src/reports.ts`, `web/src/views/staff/ReportsModule.tsx`)
- `P1-v3-capability-registry-proposal-approval-audit.md` for proposal linkage

## Estimate
- Size: M

## Telemetry / Audit Gates
- Suggestion acceptance/rejection rates tracked by category.
- Policy drift monitor: mismatch rate between suggestion and final staff action.

## Rollback
- Disable assistant suggestion feed; keep current manual triage.
