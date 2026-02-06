# Sprint 03 - Commerce + Events

Window: Week 3  
Goal: Complete event attendance and checkout-dependent flows.

## Ticket S3-01
- Title: Events list/detail/signup/cancel parity
- Swarm: `Swarm C`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S1-01, S1-02
- Deliverables:
  - list/get/signup/cancel flows
  - attendee status rendering parity
- Verification:
1. Signup flow transitions status correctly.
2. Cancel flow updates state and roster visibility.
3. Missing auth token fails with user-visible status (no crash).

## Ticket S3-02
- Title: Events staff roster + check-in parity
- Swarm: `Swarm C`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S3-01
- Deliverables:
  - roster fetch and filtering
  - staff check-in action
- Verification:
1. Staff check-in updates signup status.
2. Unpaid status is visible after check-in.
3. Roster filter/search and include-cancelled/expired toggles update visible rows.

## Ticket S3-03
- Title: Materials catalog/cart/checkout session parity
- Swarm: `Swarm C`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S1-01, S1-02
- Deliverables:
  - catalog retrieval + cart actions
  - create checkout session + redirect
- Verification:
1. Checkout session URL returned and opened.
2. Cancel/success status messaging parity.
3. Empty cart is blocked from checkout submit.

## Ticket S3-04
- Title: Billing summary parity
- Swarm: `Swarm C`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S3-02, S3-03
- Deliverables:
  - event charges + materials orders visibility
  - unpaid/event checkout triggers
- Verification:
1. Billing rows map to expected collections.
2. Checkout actions from billing launch correctly.
3. Empty-state messaging is shown when no billing activity exists.
