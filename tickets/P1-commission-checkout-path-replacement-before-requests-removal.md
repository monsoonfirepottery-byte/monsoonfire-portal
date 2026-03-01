# P1 — Commission Checkout Path Replacement Before Requests Removal

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Commerce + Portal Frontend
Type: Ticket
Parent Epic: tickets/P1-EPIC-19-requests-surface-deprecation-and-agent-intake-rationalization.md

## Problem

Unpaid commission orders currently expose a member checkout action in `AgentRequestsView`.

## Objective

Ship a replacement checkout entry path before deleting Requests UI.

## Tasks

1. Define replacement destination (for example Billing or dedicated Commission detail card).
2. Surface pending commission checkout CTA in the replacement destination.
3. Preserve existing backend `createAgentCheckoutSession` contract.
4. Add regression coverage for checkout link generation and redirect behavior.

## Acceptance Criteria

1. Members can complete commission payment without visiting Requests.
2. Checkout failure states remain visible and actionable.
3. Removal of Requests UI does not reduce commission conversion ability.

## Completion Evidence (2026-02-28)

1. Billing now loads pending commission checkout actions through `apiV1/v1/agent.requests.listMine` and renders a dedicated `Commission payments` section in `web/src/views/BillingView.tsx`.
2. Members can open Stripe checkout directly from Billing using existing `createAgentCheckoutSession` backend contract.
3. Checkout and failure feedback surfaces are preserved in Billing status messaging and existing user-facing error mapping.
