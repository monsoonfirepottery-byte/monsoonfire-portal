# P1: Align Sources With Service Pricing And Membership Decommission

Status: In progress; customer-facing source edits blocked by active redesign
Owner: policy/platform
Decision source: `docs/policies/service-pricing-and-membership-decommission.md`

## Context

The human-approved operational truth is now:

- All membership tiers are decommissioned.
- Monsoon Fire uses straight pricing for services only.
- Kiln firing has three service lanes: low fire, mid fire, and custom.
- Each kiln service lane is priced by the half shelf.
- There is no volume pricing, cubic-inch pricing, or membership-tier pricing.

Website and portal edits are intentionally paused because a redesign is active in another agent window.

## Progress

2026-04-29:

- Added source-grounded operational truth for membership decommission and service-only pricing.
- Added wiki decision and context-pack exports that agents can use as operational context.
- Aligned support-policy docs and generated governance artifacts away from membership plan-change routing.
- Tightened wiki contradiction detection to avoid generic `current plan`, schema enum, notification role, and firing-credit false positives.
- Added contradiction evidence path and surface counts so future agents can distinguish safe docs/governance cleanup from redesign-blocked public surfaces.

Current wiki contradiction state:

- Hard source drift remains expected until the redesign updates public and portal surfaces.
- Losing-side evidence is currently concentrated in `website-redesign-paused` and `portal-redesign-paused` surfaces.
- Winning-side truth is grounded in docs, wiki decision records, and this ticket.

## Follow-Up Work

- Replace membership-tier, member-only benefit, firing-credit, storage-discount, and membership-plan language in active customer-facing surfaces after the redesign owner reopens those files.
- Align pricing copy to low fire, mid fire, and custom half-shelf lanes after the redesign owner confirms final amounts and wording.
- Retire or redirect stale membership acquisition and membership management surfaces.
- Regenerate customer-service policy inventory after active source updates land.
- Re-run the wiki contradiction scan and confirm only expected redesign follow-ups remain.

## Guardrails

- Do not edit `website/`, `web/`, or portal UI/content surfaces from this ticket while the redesign is active unless the user explicitly reopens that surface.
- Do not infer pricing amounts from older whole-kiln, bisque/glaze, discount, or membership-tier copy.
- Treat stale customer-facing copy as a review target, not as operational truth.
