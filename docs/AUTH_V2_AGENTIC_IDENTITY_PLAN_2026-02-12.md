# Monsoon Fire Portal Auth Strategy Review + V2 Agentic Identity Plan

Date: 2026-02-12  
Scope: Firebase Auth + Firestore Rules + Cloud Functions + Web client auth handling.

Official references used:
- Firebase Auth best practices: https://firebase.google.com/docs/auth
- Firebase custom claims: https://firebase.google.com/docs/auth/admin/custom-claims
- Firebase session management: https://firebase.google.com/docs/auth/admin/manage-cookies
- Firebase Auth blocking functions: https://firebase.google.com/docs/functions/auth-blocking-events
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

---

## 1) Current State Summary (trust boundaries + auth map)

### Principals in use
- Human principal via Firebase ID token (`Authorization: Bearer <idToken>`).
- Staff principal via custom claims (`staff: true` or roles includes `staff`).
- PAT principal (`mf_pat_v1.<tokenId>.<secret>`) mapped to an owner UID and scopes.
- Delegated agent principal (`mf_dlg_v1...`) mapped to `principalUid` and `agentClientId`.

### Entry points
- Web SPA (`web/src/App.tsx`) sign-in and token refresh via `onIdTokenChanged` (`web/src/App.tsx:827`).
- Cloud Functions HTTP endpoints (many onRequest handlers in `functions/src/index.ts`).
- API v1 multiplexer (`functions/src/apiV1.ts`) for deterministic agent routes.
- Direct Firestore access from web SDK (reads/writes constrained by `firestore.rules`).

### Auth artifacts
- Firebase ID token verified server-side in `requireAuthUid` (`functions/src/shared.ts:120`).
- PAT verified using HMAC hash with pepper (`functions/src/shared.ts:483`).
- Delegated token verified with HMAC signature + nonce anti-replay (`functions/src/shared.ts:395`, `functions/src/shared.ts:442`).
- Optional emulator-only `x-admin-token` fallback for staff-like dev access (`functions/src/shared.ts:629`).

### Authorization enforcement points
- Cloud Functions:
  - `requireAdmin` for staff/dev admin endpoints (`functions/src/shared.ts:629`).
  - `requireScopes` + owner checks in `apiV1` route handlers (`functions/src/apiV1.ts:983`, `functions/src/apiV1.ts:1249`).
- Firestore Rules:
  - Owner/staff rules for `batches`, `profiles`, `users`, commerce/events/library collections.
  - Rules already deny writes for most privileged collections.

---

## 2) Ranked Gap List

1. Delegated token validity previously depended on agentClient + nonce only, without mandatory delegation grant object binding owner/resources when strict mode is desired.
2. App Check was not centrally enforceable for agent/API surfaces.
3. Privileged action audit trail existed in multiple collections but lacked one canonical append-only actor/resource stream for security review.
4. `verifyIdToken` revocation-check mode was not configurable for strict environments.
5. Delegated token age skew control was missing (issued-in-future / too-old token checks).
6. Delegation revocation management endpoints were missing.
7. No explicit Firestore rules existed for delegation/audit collections introduced for V2 model.

---

## 3) V2 Target Architecture (Firebase-native)

### Principals
- Human: Firebase user UID.
- Staff: Firebase user UID + custom claim (`staff` or `roles[]` contains `staff`).
- Agent delegated: delegated token + `agentClientId` + delegation grant.
- Agent PAT: PAT token + scoped owner UID.

### Delegation model (V2)
- Collection: `delegations/{delegationId}`
- Fields:
  - `ownerUid`
  - `agentClientId`
  - `scopes[]`
  - `resources[]` (ex: `owner:<uid>`, `batch:<id>`, `route:/v1/agent.pay`)
  - `status` (`active|revoked|suspended`)
  - `createdAt`, `updatedAt`, `expiresAt`, `revokedAt`
  - `createdBy`, `updatedBy`, `note`

### Authorization policy
- Every server action uses actor context + owner binding + scope check.
- Delegated actors in strict mode must include valid `delegationId` in token and pass:
  - owner binding
  - scope containment
  - resource containment
  - active/non-revoked/non-expired status

### Revocation
- Owner/staff can revoke delegation (`revokeDelegation` endpoint).
- Strict mode blocks revoked/expired delegation immediately on next request.

### Audit model
- Canonical append-only collection: `auditEvents`
- Contains: actor, action, owner/resource, requestId, outcome, reasonCode, hashed IP, user-agent, metadata.

### App Check + token hardening
- Feature-flagged App Check gate at API edge.
- Optional strict Firebase token revocation check (`verifyIdToken(token, true)`).
- Delegated token sanity checks:
  - expiry
  - iat not in future
  - max token age window
  - nonce replay single-use guard

---

## 4) Ticket Backlog (repo-native; issue-ready)

See ticket files:
- `tickets/P1-v2-principals-and-delegation-schema.md`
- `tickets/P1-v2-server-actor-authorization-helper.md`
- `tickets/P1-v2-firestore-rules-hardening-sensitive-collections.md`
- `tickets/P1-v2-privileged-action-audit-ledger.md`
- `tickets/P1-v2-agent-abuse-throttling-and-rate-limits.md`
- `tickets/P1-v2-delegation-revocation-expiry-staff-tooling.md`
- `tickets/P1-v2-session-token-storage-hardening.md`
- `tickets/P2-v2-mfa-and-strong-auth-roadmap.md`
- `tickets/P2-v2-auth-blocking-functions-roadmap.md`
- `tickets/P1-v2-threat-model-and-security-test-checklist.md`

---

## 5) Implemented Now (Top 35 high-ROI / low-blast-radius items)

Feature-flagged and backward compatible:

1. Added centralized authz module `functions/src/authz.ts`.
2. Added feature flag reader (`V2_AGENTIC_ENABLED`).
3. Added feature flag reader (`STRICT_DELEGATION_CHECKS_ENABLED`).
4. Added feature flag reader (`ENFORCE_APPCHECK`).
5. Added feature flag reader (`ALLOW_APPCHECK_BYPASS_IN_EMULATOR`).
6. Added canonical App Check verifier helper.
7. Added canonical privileged audit logger (`auditEvents` writer).
8. Added delegation grant evaluator (`evaluateDelegationAuthorization`).
9. Added owner/scope/resource actor authorization helper (`assertActorAuthorized`).
10. Added actor typing (`human`, `staff`, `agent_pat`, `agent_delegated`) in audit output.
11. Added delegated token payload support for `delegationId`.
12. Added delegated auth context field `delegationId`.
13. Added strict delegated token maximum-age guard.
14. Added delegated token future-issued skew rejection.
15. Added optional strict Firebase token revocation verification (`STRICT_TOKEN_REVOCATION_CHECK`).
16. Added App Check gate to `createIntegrationToken`.
17. Added App Check gate to `listIntegrationTokens`.
18. Added App Check gate to `revokeIntegrationToken`.
19. Added App Check gate to `createDelegatedAgentToken`.
20. Added request correlation IDs to auth-sensitive endpoints.
21. Added audit log on token creation success/deny/error.
22. Added audit log on token listing success/deny.
23. Added audit log on token revocation success/deny.
24. Added delegation document persistence at delegated token issuance.
25. Added delegation ID in delegated token issuance response.
26. Added strict-mode delegated token issuance behavior (`delegationId` embedded).
27. Added `listDelegations` endpoint.
28. Added `revokeDelegation` endpoint.
29. Added audit logging for `helloPat`.
30. Added API v1 edge App Check gate.
31. Added API v1 auth-failure audit entries.
32. Added API v1 route-level strict authz check for agent routes via scope hints.
33. Added owner-bound authz enforcement in `batches.list`.
34. Added owner-bound authz enforcement in `batches.get`.
35. Added owner-bound authz enforcement in `batches.timeline.list`.

Additional hardening in payment path:
- Added owner/scope-based authorization + audit logging to `createAgentCheckoutSession`.

Rules + tests:
- Added Firestore rules for `delegations` and `auditEvents`.
- Added unit tests for delegation authorization edge cases (`functions/src/authz.test.ts`).

---

## 6) Manual Security Test Checklist (post-change)

1. `V2_AGENTIC_ENABLED=false`: confirm existing delegated/PAT flows remain unchanged.
2. `V2_AGENTIC_ENABLED=true`, `STRICT_DELEGATION_CHECKS_ENABLED=true`:
   - delegated token without `delegationId` is denied.
3. Revoke a delegation and verify delegated call fails immediately.
4. Expire a delegation and verify delegated call fails.
5. Attempt owner mismatch with delegated token (`ownerUid` different) and verify deny.
6. Set `ENFORCE_APPCHECK=true` (non-emulator), call API without header, verify `APPCHECK_REQUIRED`.
7. Verify `auditEvents` receives allow/deny/error rows for token and delegated actions.
8. Verify `firestore.rules` still block client writes to privileged collections.

