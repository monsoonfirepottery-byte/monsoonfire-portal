# P2 — Agent Legal Terms, Refund Rules, and Incident Playbook

Status: Completed

## Problem
- Agent-only commerce requires explicit legal terms and operational response procedures.
- Refund/dispute ambiguity creates financial and reputational risk.

## Goals
- Publish agent-specific terms, acceptable-use policy, and refund/cancel rules.
- Define incident playbooks for abuse, legal takedowns, and payment fraud.

## Scope
- Terms versioning and acceptance requirement for agent access.
- Refund matrix by service type and fulfillment stage.
- Incident runbooks with severity ladder and kill-switch criteria.

## Security
- Enforce terms acceptance at API gateway.
- Preserve evidence logs for disputes and legal review.
- Restrict incident controls to staff roles.

## Acceptance
- Agent endpoints require current terms acceptance.
- Refund flows map to documented policy states.
- Incident response can be executed end-to-end by staff.

## Progress notes
- Implemented agent terms enforcement in `functions/src/apiV1.ts`:
  - Added `v1/agent.terms.get` and `v1/agent.terms.accept`.
  - Added PAT/delegated precondition gate for `v1/agent.*` routes (with exempt routes for terms + hello).
  - Added acceptance persistence in `agentTermsAcceptances`.
  - Added audit trail actions:
    - `agent_terms_accepted`
    - `agent_terms_required_block`
- Added policy docs:
  - `docs/AGENT_TERMS_AND_REFUND_POLICY.md` (terms + refund matrix)
  - `docs/AGENT_INCIDENT_PLAYBOOK.md` (incident controls and workflow)
- Updated contracts in `docs/API_CONTRACTS.md` for new terms endpoints and enforcement notes.
