# P1: Marketing Swarm (Draft-only)

## Goal
Use StudioState and existing content sources to generate draft marketing artifacts without auto-publish.

## Non-goals
- No autonomous publishing.
- No website deployment changes in this ticket.

## Acceptance Criteria
- Draft pipeline stores proposed copy with source references and confidence notes.
- Drafts include explicit status (`draft`, `needs_review`, `approved_for_publish`).
- Human approval is required before any publish action.
- Audit entries created for draft generation and review decisions.

## Files/Dirs
- `studio-brain/src/swarm/marketing/**` (new)
- `tickets/v3/**`
- optional staff surface in `web/src/views/staff/**`

## Tests
- Unit tests for prompt/template assembly and deterministic draft metadata.
- Unit tests for approval gating.

## Security Notes
- No secrets exposed to generation workers.
- Draft storage excludes sensitive PII by default.

## Dependencies
- `P0-v3-studio-state-readonly-computation.md`
- `P1-v3-capability-registry-proposal-approval-audit.md`

## Estimate
- Size: M

## Telemetry / Audit Gates
- Draft generation logs include source snapshot date + prompt/template version IDs.
- Review decisions are fully attributable with before/after diff hashes.

## Rollback
- Disable marketing swarm job; existing website workflow unchanged.
