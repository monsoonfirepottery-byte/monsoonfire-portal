Status: Completed

# P2 - Rate limit docs need TTL/cleanup

- Repo: functions
- Area: Cost control / Ops
- Evidence:
  - `functions/src/shared.ts` writes durable rate limit state to `rateLimits/{bucketKey}` with no cleanup path
- Recommendation:
  - Add a TTL field (or `expiresAt`) and configure Firestore TTL policy, or add a scheduled cleanup function.
- Fix applied:
  - `functions/src/shared.ts` now writes `expiresAt` (Firestore `Timestamp`) alongside `count/resetAt`.
  - Follow-up (manual): enable Firestore TTL on `rateLimits.expiresAt` in the Firebase/Google Cloud Console.
- Effort: M
- Risk: Low
- What to test: rate limiting still works; old docs expire; no auth bypass.
