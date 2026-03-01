# Requests Surface Deprecation Audit (2026-02-27)

Status: Completed
Date: 2026-02-27
Owner: Platform + Product
Related Epic: docs/epics/EPIC-REQUESTS-SURFACE-DEPRECATION-AND-AGENT-INTAKE-RATIONALIZATION.md

## Scope

Audit of member Requests UI dependencies and backend/API couplings before hard removal.

## Findings Matrix

### Member-Critical (must preserve)

1. Commission payment handoff:
   - Previous entry path: `web/src/views/AgentRequestsView.tsx` (`createAgentCheckoutSession` action).
   - Replacement shipped: `web/src/views/BillingView.tsx` commission payment section and checkout CTA.

### Staff-Critical (retain)

1. Staff request triage + operations:
   - `web/src/views/staff/AgentOpsModule.tsx`
   - Uses:
     - `apiV1/v1/agent.requests.listStaff`
     - `apiV1/v1/agent.requests.updateStatus`
     - `apiV1/v1/agent.requests.linkBatch`
     - `apiV1/v1/agent.requests.createCommissionOrder`

### System-Only / Automation Coupling (retain unless intentionally replaced)

1. API contracts and guards:
   - `functions/src/apiV1.ts` (`/v1/agent.requests.*` routes, scopes, authz).
2. Smoke/deep probes:
   - `scripts/portal-playwright-smoke.mjs`
   - `scripts/functions-cors-smoke.mjs`

### Retirable Member UI Surface

1. `web/src/views/AgentRequestsView.tsx`
2. `web/src/views/AgentRequestsView.css`
3. Legacy nav/routing wiring in `web/src/App.tsx` (already removed in soft deprecation step).

## Removal Gate

Hard deletion of `AgentRequestsView` is allowed when all are true:

1. Commission checkout replacement in Billing is validated in production.
2. No active user journey relies on Requests deep links.
3. Staff AgentOps request flows remain green.
4. Canary/smoke docs are updated to no longer imply member Requests navigation.

## Recommended Next Steps

1. Add targeted UI test for Billing commission checkout CTA visibility.
2. Remove `AgentRequestsView` files after one release cycle of no regressions.
3. Keep backend `agent.requests.*` routes until staff/system migration scope is complete.
