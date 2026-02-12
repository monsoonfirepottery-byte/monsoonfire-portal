Status: Completed

# P1 - Durable rate limiting for functions

- Repo: portal
- Area: Backend
- Evidence: `functions/src/shared.ts` uses in-memory `Map` for rate limits.
- Recommendation: move to durable store (Firestore/Redis) or document best-effort limits.
- Effort: M
- Risk: Med
- What to test: rapid requests across instances are still throttled.
