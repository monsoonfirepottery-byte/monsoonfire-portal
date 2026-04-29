---
schema: wiki-page.v1
id: wiki:context-pack:studio-brain-wiki
title: Studio Brain Wiki
kind: context_pack
status: SYNTHESIZED
confidence: 1
owner: platform
source_refs: []
last_verified: null
valid_until: null
last_changed_by: script:wiki-postgres
agent_allowed_use: planning_context
supersedes: []
superseded_by: []
related_pages: []
export_hash: 7ca7d930ea4c3da1c3801ff303ceba2e26045442b83ad9a402a687faa7f90a31
---
# Studio Brain Wiki Context Pack

Snapshot: 666300ae0c3cc752fdf46011626b2123192dec3384c8672ac7782110806ef8d1

## Verified Operational Context
- Monsoon Fire has decommissioned all membership tiers and uses straight pricing for services only. [claim_57ec680d6070e4f40169; docs/policies/service-pricing-and-membership-decommission.md#L1]
- Monsoon Fire kiln firing service pricing has three lanes: low fire, mid fire, and custom; each lane is priced by the half shelf. Volume pricing and cubic-inch pricing are not used. [claim_ae5fcb85bab41a024b86; docs/policies/service-pricing-and-membership-decommission.md#L1]

## Warnings
- unverified-claim-excluded: package-script:studio:ops:host:heartbeat:once
- unverified-claim-excluded: source-of-truth:studio-brain-memory-bridge-startup-context-search-handoffs-loop-ops
- unverified-claim-excluded: agents:agents.md
- unverified-claim-excluded: package-script:open-memory:pst:continuity:gate
- unverified-claim-excluded: package-script:open-memory:context:sync
- unverified-claim-excluded: repo-config:firestore.rules
- unverified-claim-excluded: package-script:codex:handoff:pack
- unverified-claim-excluded: package-script:studio:ops:cockpit:state
- unverified-claim-excluded: policy-doc:docs/policies/community-conduct.md
- unverified-claim-excluded: package-script:wiki:validate
- source-drift-after-operational-truth: membership-required-vs-decommission (current truth: claim_57ec680d6070e4f40169; update stale sources before customer-facing use)
