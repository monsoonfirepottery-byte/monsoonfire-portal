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
operating_layer_role: compiled_operating_layer
serves_system: studio-brain
memory_relationship: not_a_competing_memory_source
source_of_truth_mode: compiled_from_repo_and_postgres_claims
export_hash: a241a222706e2c59cb690f32fb6e05ca92c050707b7e9eb49009496bc25fbf80
---
# Studio Brain Wiki Context Pack

Snapshot: d168c33319ec22e8b5d7d518d1202366d47e3ee4588a71b79ea6ab43da18f401

## Operating Layer Contract

- repo/runtime: behavior_source_of_truth
- Studio Brain memory: continuity_and_event_memory
- wiki: compiled_audited_context_layer
- verified wiki claims: usable_with_source_refs_when_agent_allowed_use_permits
- unverified wiki claims: planning_hint_only
- human-gated wiki claims: approval_queue_only

## Claim State Summary

- claims: 270
- verified: 0
- operational_truth: 1
- unverified_excluded: 269
- human_gated: 21

## Usefulness Signals

- outcome verdict: useful
- wiki-relevant outcomes: 3; helpful: 3; stale_or_misleading: 0; minutes_saved: 0

## Verified Operational Context
- Monsoon Fire is decommissioning membership and reservation systems during May 2026. Both systems reach end-of-life on May 31, 2026. Monsoon Fire uses straight pricing for services only. Kiln firing service pricing has three lanes: low fire, mid fire, and custom. Each lane is priced by the half shelf. There is no volume pricing, cubic-inch pricing, or membership-tier pricing for kiln services. Website and portal edits for this decommission are approved for May 2026 EOL cleanup. Preserve safe redirects or explicit transition messaging for legacy membership and reservation entry points. Pricing amounts are not defined here. Do not infer current prices from older whole-kiln, bisque/glaze, firing-credit, discount, or membership-tier copy. [claim_e2387dc9714da3f1b596; wiki/40_decisions/2026-04-28-service-pricing-and-membership-decommission.md#L1, docs/epics/EPIC-MEMBERSHIP-DECOMMISSION-AND-STUDIO-FOCUS.md#L1]

## Warnings
- unverified-claims-excluded-summary: 269 backlog claims across 5 categories; full ledger: wiki/00_source_index/extracted-facts.jsonl; approval snapshot: wiki/00_source_index/human-gates-snapshot.json
- human-gated-claims-summary: 21 pending approval-only claims (policy-doc=15, package-procedure=5, source-of-truth=1); state: wiki/00_source_index/human-gate-approval-state.json; packets: npm run wiki:human-gates:packets
- unverified-claims-excluded-category: package-procedure total=192; human_gated=5; sample_claims=claim_00c03fe6155ee3b86e34,claim_062f640887fbbdbb3d37,claim_072dcf2a05097e5b3a4c
- unverified-claims-excluded-category: source-of-truth total=44; human_gated=1; sample_claims=claim_029400bcad71933d3a65,claim_0ca126a61276ed1de7f1,claim_17d6dc08447473329549
- unverified-claims-excluded-category: policy-doc total=15; human_gated=15; sample_claims=claim_0a980fd7ad96521d29b1,claim_11aadfb99e47d9e923f9,claim_18949bc7109060654ed2
- unverified-claims-excluded-category: agent-guardrail total=14; sample_claims=claim_16f0d3cee64a2f8cc868,claim_1c857bc70225dc03ae94,claim_4a95c283c64166d4b533
- unverified-claims-excluded-category: repo-config total=4; sample_claims=claim_0832649608241568acf6,claim_77eb3f223771d1ddc109,claim_7eb0b6c702c6c2a5488c
