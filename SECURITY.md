# Monsoon Fire Portal — Security Checklist

This document captures the app’s current threat model, guardrails, and a lightweight manual test plan.

**Threat Model**
Assets:
- Firebase ID tokens and custom claims (staff role)
- Firestore data (batches, pieces, messages, library, events, materials, reservations)
- Stripe checkout sessions and webhook integrity
- Admin-only operations (event rosters, materials catalog seeding, calendar sync, library imports)

Trust boundaries:
- Browser client (untrusted)
- Cloud Functions (trusted boundary; must enforce authZ + validation)
- Firestore rules (enforce least privilege for direct SDK access)
- Third‑party APIs (Stripe, Google Calendar, OpenLibrary, Google Books)

Attacker profiles:
- Unauthenticated users attempting direct API or Firestore access
- Authenticated users attempting privilege escalation or data scraping
- Compromised client (token theft, replay, CSRF-like abuse)

Highest‑risk flows:
- Admin‑gated Functions (event rosters, seeding catalogs, calendar sync)
- Direct Firestore writes to multi‑tenant data
- Event signups and payments (capacity + billing)
- Library imports and ISBN lookups (external fetches)

**Config & Secrets**
- `ALLOW_DEV_ADMIN_TOKEN=true` and `ADMIN_TOKEN=...` are required for dev admin tokens in the emulator.
- Dev admin token UI only appears when `VITE_ENABLE_DEV_ADMIN_TOKEN=true` and the Functions base URL is localhost.
- Dev admin token session persistence is opt-in via `VITE_PERSIST_DEV_ADMIN_TOKEN=true`; otherwise token storage is memory-only per page session.
- Production must never enable the dev admin token path.
- Optional abuse control flags:
  - `AUTO_COOLDOWN_ON_RATE_LIMIT=true` auto-applies delegated client cooldowns after agent route rate-limit denials.
  - `AUTO_COOLDOWN_MINUTES=<n>` controls auto cooldown duration (default `5`).
- Prefer `ALLOWED_ORIGINS` for Cloud Functions CORS allowlist.
- Agentic identity hardening flags:
  - `V2_AGENTIC_ENABLED` (default false)
  - `STRICT_DELEGATION_CHECKS_ENABLED` (default false)
  - `ENFORCE_APPCHECK` (default false)
  - `ALLOW_APPCHECK_BYPASS_IN_EMULATOR` (default true)
  - `STRICT_TOKEN_REVOCATION_CHECK` (default false)
  - `DELEGATED_TOKEN_MAX_AGE_MS` (default 600000)

**Preflight (Quick Checks)**
1. `npm --prefix web run build`
2. `npm --prefix functions run build`
3. `firebase emulators:start --only firestore,functions` (optional for manual rule validation)

**Manual Security Test Plan**
1. Unauthenticated API access: call a function without `Authorization` and confirm 401.
2. Non‑staff admin access: call `listEventSignups` or `seedMaterialsCatalog` and confirm 403.
3. Dev admin token in prod: set `VITE_ENABLE_DEV_ADMIN_TOKEN=true` with prod base URL and confirm the token UI is still hidden.
4. Firestore rules: attempt to update another user’s batch/piece/profile and confirm permission denied.
5. Event signups: attempt to write directly to `eventSignups` via Firestore SDK and confirm permission denied.
6. Messages: attempt to read a directMessages thread you are not a participant in and confirm permission denied.
7. Reservations: submit with invalid shelf values or missing firing type and confirm 400 from the function.
8. Stripe webhooks: send a fake webhook with invalid signature and confirm 400.
9. Rate limits: spam `createBatch` or `createReservation` and confirm 429 with `Retry-After`.
10. Delegation strict mode: enable strict flags and verify missing/expired/revoked delegation is denied.
11. App Check strict mode: enable `ENFORCE_APPCHECK=true` and verify missing header returns auth failure.
12. Audit events: verify privileged actions generate entries in `auditEvents`.

**Notes**
- Avoid storing sensitive tokens in localStorage.
- Only staff custom claims should unlock staff UI; dev admin token is emulator‑only.
- Canonical privilege audit records are written to `auditEvents` (staff-readable).
