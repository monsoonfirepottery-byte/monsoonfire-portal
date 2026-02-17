# Monsoon Fire Portal — Agent Terms and Refund Policy (v2026-02-12.v1)

## Scope
- Applies to PAT/delegated agent traffic to `/apiV1/v1/agent.*`.
- Human member UI traffic remains governed by normal portal terms.

## Terms Acceptance
- Agents must accept the current terms version before calling protected agent routes.
- Acceptance is recorded in Firestore:
  - `agentTermsAcceptances/{id}`
  - Fields: `uid`, `mode`, `tokenId|agentClientId`, `version`, `acceptedAt`, `status`.
- Current version is read from `config/agentTerms.currentVersion`.

## Prohibited Commission Categories
- Weapons/explosives instruction.
- Counterfeit/fraud-related requests.
- Explicit copyright bypass or stolen design requests.
- Hate/harassment-targeted content.

## Rights Attestation
- Commission intake requires `rightsAttested=true`.
- Staff must provide a policy reason code when accepting/rejecting commission requests.

## Refund Matrix
- `quote_only` (no reservation): full refund by default.
- `reserved_not_started`: full refund minus explicit non-refundable platform fee (if configured).
- `in_progress` (physical work started): partial refund at staff discretion.
- `fulfilled_ready_pickup|shipped`: no automatic refund; manual case review.
- `rejected_by_policy`: full refund if payment already captured.

## Operational Rule
- No physical fulfillment starts before policy gates pass and required payment state is satisfied.
- All overrides require staff reason + audit entry.
