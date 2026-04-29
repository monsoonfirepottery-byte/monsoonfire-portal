---
schema: wiki-page.v1
id: wiki:contradiction:membership-required-vs-decommission
title: membership-required-vs-decommission
kind: contradiction
status: CONTRADICTORY
confidence: 0.8
owner: policy
source_refs: ["web/src/views/MembershipView.tsx#L321","web/src/views/SupportView.tsx#L81","website/data/announcements.json#L1","docs/epics/EPIC-MEMBERSHIP-DECOMMISSION-AND-STUDIO-FOCUS.md#L1","docs/epics/EPIC-MEMBERSHIP-DECOMMISSION-AND-STUDIO-FOCUS.md#L148","docs/policies/service-pricing-and-membership-decommission.md#L1"]
last_verified: null
valid_until: null
last_changed_by: script:wiki-postgres
agent_allowed_use: cite_only
supersedes: []
superseded_by: []
related_pages: []
export_hash: d0398a7ca602394d44b521ce288407c1a55d9a837e5815d8e3d2087c4978c67e
---

# membership-required-vs-decommission

Severity: hard

Recommended action: Treat the service-pricing decommission decision as current operational truth and update or retire stale membership-tier/member-only sources before using them in customer-facing context.

## Source References

- `web/src/views/MembershipView.tsx` lines 321-400
- `web/src/views/SupportView.tsx` lines 81-160
- `website/data/announcements.json` lines 1-80
- `docs/epics/EPIC-MEMBERSHIP-DECOMMISSION-AND-STUDIO-FOCUS.md` lines 1-2
- `docs/epics/EPIC-MEMBERSHIP-DECOMMISSION-AND-STUDIO-FOCUS.md` lines 148-155
- `docs/policies/service-pricing-and-membership-decommission.md` lines 1-7

## Evidence Path Counts

### Side A

- `website/data/announcements.json`: 2
- `website/data/faq.json`: 2
- `web/src/views/MembershipView.tsx`: 1
- `web/src/views/SupportView.tsx`: 1
- `website/highlights/index.html`: 1
- `website/ncsitebuilder/data/faq.json`: 1
- `website/ncsitebuilder/highlights/index.html`: 1

### Side B

- `docs/epics/EPIC-MEMBERSHIP-DECOMMISSION-AND-STUDIO-FOCUS.md`: 2
- `docs/policies/service-pricing-and-membership-decommission.md`: 2
- `wiki/40_decisions/2026-04-28-service-pricing-and-membership-decommission.md`: 2
- `docs/runbooks/PRICING_COMMUNITY_SHELF_QA.md`: 1
- `tickets/P1-service-pricing-and-membership-decommission-source-alignment.md`: 1
