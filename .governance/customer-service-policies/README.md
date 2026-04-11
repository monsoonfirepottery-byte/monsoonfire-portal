# Customer-Service Policy Governance

This folder is generated from the canonical policy docs in `docs/policies/*.md`.

Artifacts:

- `policy-program.json`
  - Policy bundle for customer-service agents and workflow tooling.
- `policy-inventory.json`
  - Cross-surface inventory and discrepancy register across docs, FAQ, announcements, and Kiln Fire evidence.
- `policy-resolution-contract.json`
  - Deterministic routing contract for support-policy intent resolution and reply shaping.

Source of truth:

- Canonical policies: `docs/policies/*.md`
- Policy program config and evidence mappings:
  - `docs/policies/customer-service-policy-program.config.json`

Regenerate with:

- `node website/scripts/sync-policies.mjs`
