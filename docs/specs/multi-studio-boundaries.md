# Multi-Studio Boundaries (Readiness Spec)

## Objective
Define strict tenancy boundaries before any multi-studio rollout so privileged actions remain scoped, auditable, and deny-by-default.

## Tenant Model
- `tenantId` is required on privileged capability proposals and execution requests.
- Single-tenant default remains supported (`monsoonfire-main`) for current rollout.
- Proposal records persist `tenantId`; execution is denied when actor tenant differs.

## Boundary Rules
1. Capability proposals are tenant-scoped at creation time.
2. Capability execution must match proposal tenant (`TENANT_MISMATCH` on conflict).
3. Pilot write actions require tenant-scoped resource pointers and idempotency keys.
4. Audit metadata must include tenant context for privileged actions.

## Config Isolation
- Runtime config should support allowlisted tenant IDs per deployment.
- Connector credentials must remain tenant-isolated (no shared mutable credential objects across tenants).

## Cockpit Requirements
- Staff cockpit displays tenant context for proposals and audit chains.
- Tenant filters are available for proposal triage.

## Security Guardrails
- Default deny on missing tenant context for privileged paths.
- Cross-tenant attempts are audited and surfaced for ops review.
