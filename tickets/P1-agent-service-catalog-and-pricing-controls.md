# P1 — Agent Service Catalog and Pricing Controls

Status: Completed

## Problem
- Agent orders need deterministic SKUs and pricing rules.
- Ad-hoc descriptions make quoting and fraud controls unreliable.

## Goals
- Add an agent-only service catalog for paid studio services.
- Encode eligibility, required inputs, and pricing constraints.

## Scope
- Catalog groups: kiln firing services, expert consults, X1C print services.
- Config docs for `productId/priceId`, minimum charge, rush add-ons, and lead time.
- Staff-managed feature flags per service.

## Security
- Disabled products must not be quotable.
- Validate all service inputs server-side.
- Keep Stripe secret configuration server-only.

## Acceptance
- Agents can request quotes only for enabled catalog items.
- Pricing is deterministic from server config.
- Staff can toggle service availability without deploy.

## Progress notes
- Service catalog config and staff endpoints implemented in `functions/src/agentCatalog.ts`:
  - `staffGetAgentServiceCatalog`
  - `staffUpdateAgentServiceCatalog`
- Agent quote/pay flows enforce catalog enablement + deterministic pricing in `functions/src/apiV1.ts`.
- Staff catalog editor is implemented in `web/src/views/staff/AgentOpsModule.tsx` with pricing mode and per-service controls.
