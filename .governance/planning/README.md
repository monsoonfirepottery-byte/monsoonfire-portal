# Planning Council Governance

This directory holds the planning-only control-plane inputs that the Studio Brain planning subsystem consumes at runtime.

## Files

- `stakeholder-ontology.json`
  Canonical stakeholder classes, omission risk, trigger touchpoints, and representative role hints.
- `council-seat-rules.json`
  Baseline and conditional seat-selection rules. This decides which perspectives must sit on a council.
- `council-auditor-rules.json`
  Legitimacy checks for councils before structured review begins.
- `evidence-grading.json`
  Allowed evidence labels and the operational meaning of each label.
- `role-quality-rubric.json`
  Scoring weights and minimum expectations for promoting role material into curated manifests.
- `stop-conditions.json`
  Planning packet release criteria for `ready_for_human`.
- `role-sources.allowlist.json`
  Pinned role-corpus sources. These are source inputs only, not runtime seats.
- `curated-role-manifests.json`
  Internal role manifests promoted for actual council use.

## Operating posture

- External repositories are treated as source material, not trusted seats.
- Curated manifests are the only role records that may occupy council seats.
- Planning artifacts remain separate from execution approvals and action proposals.
