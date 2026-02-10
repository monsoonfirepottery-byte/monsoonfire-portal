# Monsoon Fire — AGENTS.md (Codex CLI Operating Guide)

This repo contains two sibling codebases under one roof:

1) **Portal (product):** a React/Vite “Monsoon Fire Portal” web app (reference implementation for a future iOS Swift/SwiftUI client).
2) **Website (marketing):** monsoonfire.com marketing site (separate deploy + different UX goals).

Codex, treat this file as your **ground truth** for how to work here: what matters, what breaks, how to stay credit-smart, and how to avoid the known foot-guns.

---

## 0) Prime Directive

**Ship stable, client-facing value without breaking working behavior.**
- Portal: batch-first kiln workflow (Active → History → Continue Journey → Timeline) with safety rails + debuggability.
- Website: fast, accessible, calm “creative studio” vibe with clean content and zero jank.

**Optimize for mobile parity** (iOS eventual target):
- Stateless request/response patterns
- Explicit JSON contracts
- Thin UI logic; business rules in Cloud Functions
- Defensive typing: tolerate missing/extra Firestore fields
- Avoid browser-only hacks and hidden implicit behavior

---

## 1) Human + Roles in the World (tight mental model)

### People
- **Client (end user):** a maker/potter checking in pieces, seeing where they are in queue, and tracking firings.
- **Staff:** studio operator. Needs admin tools, verification, overrides, and auditability.
- **Owner/operator (Micah / Wuff):** shipping-focused, momentum-sensitive. Prefers small decisive increments and strong guardrails.

### Environments
- **Local dev:** Vite + Firebase emulators (functions + firestore). Windows + PowerShell is common.
- **Production:** Firebase hosting/functions + Firestore rules/indexes.
- **Website hosting:** separate path/deploy (cPanel / static hosting style). Don’t assume Firebase deploy handles it.

---

## 2) Repo Map (what lives where)

- `web/` — **Portal** React/Vite client
  - Firebase Auth (Google sign-in)
  - Firestore (active/history/timeline)
  - Cloud Functions via HTTP endpoints
  - Safety rails: ErrorBoundary, in-flight guards, last-request capture, dev admin token input + persistence

- `functions/` — **Portal** backend (Firebase Cloud Functions)
  - Stateless JSON contracts
  - Authorization: `Bearer <idToken>`
  - Dev-only staff/admin header: `x-admin-token` (user supplied; never hardcode)

- `website/` (or similarly named dir) — **Marketing site**
  - Treat as distinct product: content + design + performance
  - Priorities: SEO basics, accessibility, clean nav, predictable deploy steps

---

## 3) Non-Negotiables (do not regress)

### Auth + Functions contracts
- All protected function calls must include:
  - `Authorization: Bearer <idToken>`
  - Optional dev admin: `x-admin-token: <value>`
- **continueJourney** requires body:
  - `{ uid: user.uid, fromBatchId }`

### Firestore “undefined” foot-gun
- Firestore rejects `undefined`. Never write it.
  - Omit the field OR set `null` if schema allows.

### Composite indexes
- Queries like:
  - `(ownerUid == X) AND (isClosed == false) ORDER BY updatedAt desc`
  - `(ownerUid == X) AND (isClosed == true) ORDER BY closedAt desc`
  often require composite indexes. If you see “failed-precondition… requires an index”, stop and surface the index hint.

### Blank screen is severity-1
- App must not white-screen. Keep an ErrorBoundary near the top-level UI when touching App shell.

### Safety rails by default
- Disable double-submit
- In-flight guards for network actions
- Clear button labels (ex: “Continue journey (creates new batch)”)
- Capture last request payload/response/status and produce a curl equivalent when possible

---

## 4) “Memory” of what we’ve already accomplished (don’t re-learn it)

Known fixed issues + patterns:
- Composite Firestore indexes were required for active/history queries.
- continueJourney needed `{ uid, fromBatchId }` in request body.
- Firestore rejected `undefined` (kilnName) — omit or null.
- Dev-only admin token header `x-admin-token` is supported and should be pasteable in UI.
- UI safety rails A1–A3 implemented historically: clearer labels, disable re-submit, troubleshooting panel.
- Common frontend pitfalls seen:
  - duplicate imports / duplicate state names
  - type-only imports for `User` from `firebase/auth`
  - undefined state referenced in render

(If you touch any of the above areas, keep the fixes intact.)

---

## 5) Tooling: Commands (fast reference)

### Portal (web)
```bash
cd web
npm install
npm run dev
