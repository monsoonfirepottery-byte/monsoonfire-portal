# Agent policy action layer

This layer is purpose-built for agents (human or AI-assisted) to act on policy
cases directly or on behalf of another person.

## Where it lives

- Canonical source: policy frontmatter in each `docs/policies/*.md`
- Generated source-of-truth index: `docs/policies/policies-index.json`
- Policy body source: individual Markdown files in `docs/policies/*.md`

## What "agent-readable" means

Each policy file frontmatter includes an `agent` object with:

- `canActForSelf` — can respond/actions for the asking user.
- `canActForOthers` — can act on another person’s behalf when authorized.
- `decisionDomain` — what this policy controls.
- `defaultActions` — the first actions an agent should perform.
- `requiredSignals` — data required before an action is finalized.
- `escalateWhen` — conditions that must hand off to a human lead.
- `replyTemplate` — the minimum consistent response shape.

## Agent behavior defaults

- Always collect required signals before confirming any outcome.
- Use escalation whenever an item appears in `escalateWhen`.
- For third-party requests, require explicit identity and permission context before applying
  `canActForOthers` actions.

## Safety rule for delegated actions

When acting for another user, keep all communication and changes auditable:

- capture who requested it,
- capture authorization,
- record evidence and timestamps.

## Usage pattern

1. Find policy slug from the request.
2. Read the policy markdown for full legal/business language.
3. Read the policy `agent` block in that file’s frontmatter for decision guidance.
4. Execute `defaultActions`.
5. If escalation condition applies, stop and transfer to the right owner/lead.
