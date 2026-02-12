# P2 — Privacy/Security: Hash IP in Rate Limit Keys (Avoid Storing Raw IPs)

Status: Completed

## Problem
- `functions/src/shared.ts` durable rate limiting stores state in Firestore:
  - `rateLimits/{bucketKey}`
- `bucketKey` previously included the **raw client IP** (`x-forwarded-for`), which is unnecessary PII to persist.

## Fix
- Updated `functions/src/shared.ts` to hash the client IP before using it in the bucket key:
  - `ipHash = sha256(ip).slice(0, 16)`
  - `bucketKey = ${key}:${uid}:${ipHash}`
- Rate limiting behavior remains per-uid/per-ip, but Firestore no longer stores raw IPs in doc IDs.

## Acceptance
- Rate limiting continues to work as before.
- New `rateLimits` document IDs do not contain raw IP addresses.
- Existing rate limit docs using the previous format can expire via TTL (if enabled) or be ignored.

## Notes
- Ensure Firestore TTL is enabled on `rateLimits.expiresAt` (see `tickets/P2-ratelimits-ttl.md`).
