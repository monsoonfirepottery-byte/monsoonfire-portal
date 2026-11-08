# Today pickup review implementation plan

**Goal:** Staff can open an exact firing ticket from Today and see the queue change when review is saved.

**Architecture:** Today reads the existing staff ticket endpoint on entry and reuses the ticket screen's last successful response. A one-time focus request selects the matching ticket in Tickets & payments. Failure leaves the last known queue visible and allows retry.

- [x] Share the pickup-review predicate and wire the read-only Today queue.
- [x] Route a Today item to the exact ticket and keep the existing billing save flow.
- [x] Verify selection, failure, refresh, and return-to-Today behavior in tests and a browser preview.
