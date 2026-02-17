# Policy Documentation Changelog

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
