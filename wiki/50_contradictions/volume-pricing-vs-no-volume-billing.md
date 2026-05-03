---
schema: wiki-page.v1
id: wiki:contradiction:volume-pricing-vs-no-volume-billing
title: volume-pricing-vs-no-volume-billing
kind: contradiction
status: DEPRECATED
confidence: 0.9
owner: policy
source_refs: ["docs/policies/service-pricing-and-membership-decommission.md#L1","docs/runbooks/PRICING_COMMUNITY_SHELF_QA.md#L1","scripts/check-pricing-and-intake-policy.mjs#L92","website/data/faq.json#L52"]
last_verified: 2026-04-28
valid_until: null
last_changed_by: codex
agent_allowed_use: cite_only
supersedes: []
superseded_by: ["wiki:decision:2026-04-28-service-pricing-and-membership-decommission"]
related_pages: ["wiki/40_decisions/2026-04-28-service-pricing-and-membership-decommission.md"]
export_hash: null
---

# volume-pricing-vs-no-volume-billing

Status: deprecated false-positive contradiction.

The human-approved operational truth is that Monsoon Fire has no volume pricing. Kiln firing service pricing has three lanes: low fire, mid fire, and custom, each priced by the half shelf.

The previous hard contradiction came from the scanner treating QA guardrail text, such as forbidden-term grep checks and no-volume assertions, as if it were an active volume-pricing claim. The detector now ignores guardrail/no-volume contexts and still flags a future active positive claim such as customer-facing copy that says work is priced by volume.

Keep this page as audit history. Do not use it as evidence that volume pricing exists.
