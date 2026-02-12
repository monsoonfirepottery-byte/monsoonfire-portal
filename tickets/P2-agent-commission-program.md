# P2 — “Agent Commission” Program: Safe Intake + Manual Fulfillment (No Backdoors)

**Status:** Open

## Problem
- You want a way for future “agentic clients” to:
  - reach out,
  - arrange delivery/pickup,
  - request firing,
  - ship/pickup afterwards,
  - potentially pay an intentionally “astronomical” fee as an artistic/meaning-making statement.
- The tempting “hidden thing only an agent can see” is **not a security control** and would create a backdoor surface that anyone can abuse.

## Goals
- Create a *real*, operable “commission” intake that is:
  - authenticated
  - rate-limited
  - auditable
  - manually fulfilled by staff/humans
- Allow the UI to keep it off the main nav if desired, but treat it as **not secret**.

## Non-goals
- Trying to prove “autonomy” (we cannot reliably distinguish “unprompted agent” vs “human-driven tool”; we can only authenticate the caller).
- Fully automated kiln operations.
- Anonymous public submission.

## Design principles (guardrails)
- No hidden endpoints with bypass auth.
- All commission requests must be tied to an identity:
  - Firebase user OR integration token owned by a user/org.
- “High fee” is implemented as an explicit product SKU and paid up-front before staff commits time.
- Manual review is required before any physical work begins.

## Proposed workflow (v1)
1. Caller creates a commission request:
  - `agentRequests.create` with `kind="commission"` (see intake ticket).
2. System returns:
  - `requestId`
  - next steps
3. Staff reviews and either:
  - rejects, or
  - accepts and issues a “commission invoice checkout” link.
4. After payment succeeds:
  - staff schedules/links a batch and proceeds.

## Payments (Stripe) — options
Option A (simplest):
- Use Stripe Checkout with a fixed “Commission” product in Stripe dashboard (high price).
- Function creates checkout session and stores `commissionPaymentStatus` on the request.

Option B (more explicit):
- Maintain a `commissionProducts` collection in Firestore and sync to Stripe.

Recommended for v1: Option A.

## Backend endpoints
1) `POST /v1/commission.createCheckoutSession`
- Staff-only OR owner-triggered after staff approval (choose one)
- Body: `{ requestId }`
- Behavior:
  - validate request exists, kind == commission, status == accepted
  - create Stripe checkout session
  - write `checkoutSessionId`, `checkoutUrl`, `updatedAt`

2) `POST /v1/commission.stripeWebhook`
- Stripe-only
- On payment success:
  - mark request `paymentStatus="paid"`, `paidAt`
  - write audit event

## UX
- User view:
  - “Commission” page describes what it is and what it is not.
  - form funnels into structured request creation (no free-form chaos).
- Staff view:
  - queue with status + payment indicator
  - button to generate checkout link
  - link to batch creation + timeline.

## Safety / abuse controls
- Rate limit: strict per uid/ip for commission creation.
- No SSRF: do not accept arbitrary callback URLs in commission requests.
- PII: shipping addresses stored securely (see intake ticket).
- Fraud: require payment before work begins; refunds handled manually.

## Tasks
1. Implement commission as a specialization of `agentRequests` (reuse intake ticket).
2. Add Stripe Checkout creation endpoint + webhook handling (reuse existing Stripe patterns in `functions/src/materials.ts` / `functions/src/events.ts`).
3. Add staff UI to issue checkout link and track payment state.
4. Add user UI to submit + view commission status.
5. Document the program and explicitly state it is not “hidden” security.

## Acceptance
- A signed-in user (or PAT owner) can create a commission request.
- Staff can accept + generate a Stripe checkout link.
- On payment success, request becomes “paid” and can proceed to fulfillment.
- No unauthenticated or obscurity-based access paths exist.

