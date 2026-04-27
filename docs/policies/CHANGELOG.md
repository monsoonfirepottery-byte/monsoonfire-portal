# Policy Documentation Changelog

## 2026-04-15

- Refined `payments-refunds` so the canonical policy now states:
  - firing services are charged when work is accepted into service
  - no-penalty cancellations only apply before service acceptance/payment capture
  - confirmed studio-side firing mistakes route to generous credit review
  - non-kiln services keep their published payment timing
- Refined `damage-responsibility` so the canonical policy now states:
  - confirmed studio-side firing mistakes default to generous firing-service credits after review
  - larger remedies beyond the default service credit remain human-reviewed case-by-case

## 2026-04-02

- Refined `payments-refunds` so the canonical policy now states:
  - full refunds for paid requests when work has not started
  - no-penalty cancellations when payment has not been captured
  - prorated review once work has started
- Refined `firing-scheduling` so the canonical policy now states:
  - estimate bands rather than guaranteed firing or pickup dates
  - deadline requests require staff confirmation
  - no-penalty changes before loading starts
  - best-effort changes only after staging or loading
  - pickup-ready notices start the pickup/storage timeline
- Refined `storage-abandoned-work` so the canonical policy now states:
  - prepaid storage must be added before billed storage begins
  - missed pickup windows do not reset the original pickup-ready timeline
  - support replies should disclose billing-start, billing-end, and reclamation dates
- Refined `studio-access` so the canonical policy now states:
  - the studio is appointment-only
  - access details are shared only after verified booking context
  - walk-in requests without a confirmed reservation require review
- Refined `damage-responsibility` so the canonical policy now states:
  - customer-facing damage reports receive acknowledgment and a documented review path
  - compensation, remake, and replacement outcomes remain human-reviewed only
- Refined `clay-materials`, `safety-kiln-rules`, `community-conduct`, `accessibility`, and `media-accessibility` to make first-use review, labeling requirements, interim safety steps, interim accessibility alternatives, and release-blocking accessibility gaps explicit in the canonical source.
- Added customer-service governance generation under `.governance/customer-service-policies/`:
  - `policy-program.json`
  - `policy-inventory.json`
  - `policy-resolution-contract.json`
- Added cross-surface policy linkage fields for FAQ and support workflows:
  - `policySlug`
  - `policyVersion`
  - `sourceType`
  - `policyResolution.*`
- Cleared the final customer-service discrepancy register item by reconciling `damage-responsibility` with Kiln Fire firing-issue acknowledgment practice.

## 2026-02-17

- Added canonical policy documentation files for all website policy routes:
  - `studio-access`
  - `safety-kiln-rules`
  - `clay-materials`
  - `firing-scheduling`
  - `storage-abandoned-work`
  - `damage-responsibility`
  - `payments-refunds`
  - `community-conduct`
  - `accessibility`
  - `media-accessibility`
- Updated `website/data/policies.json` policy entries from draft to active status for
  support policy summaries.
- Added documentation maintenance workflow and ownership guidance in
  `docs/policies/README.md`.
- Added `docs/policies/policies-index.json` as a policy source-of-truth index.
- Added `website/scripts/sync-policies.mjs` to regenerate support summaries from the
  source-of-truth index.
- Added `agent` action blocks to `docs/policies/policies-index.json` for self-service and
  third-party (delegated) policy handling.
- Added `docs/policies/AGENT_POLICY_ACTIONS.md` as the agent execution playbook for policy
  actions.
- Added `agent` metadata blocks in policy frontmatter so delegated-action guidance, required
  signals, escalation criteria, and response templates are now part of the single markdown
  source for each policy.
- Removed duplicated in-body `## Agent action layer` sections from policy markdown files
  once the frontmatter model was verified.
- Migrated policy `agent` and support metadata into each policy markdown frontmatter, and
  updated `website/scripts/sync-policies.mjs` to generate both
  `docs/policies/policies-index.json` and `website/data/policies.json` from those files.
- Added CI-enforced policy frontmatter linting by inserting
  `node website/scripts/lint-policies.mjs` into `.github/workflows/ci-smoke.yml`.
