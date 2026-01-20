# Monsoon Fire Portal — Agent Guide

This repo ships a **React/Vite web portal** as a reference implementation for an eventual **iOS (Swift/SwiftUI) client**. Keep patterns explicit, debuggable, and portable.

## Architecture (high level)
Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.

- `web/` — React/Vite client
  - Firebase Auth (Google sign-in)
  - Firestore queries (active + history)
  - Calls Firebase Cloud Functions (HTTP endpoints)
  - Safety rails: ErrorBoundary, in-flight guards, troubleshooting capture, admin token persistence

- `functions/` — Firebase Cloud Functions (HTTP)
  - Stateless request/response JSON contracts
  - Authorization: Bearer `<idToken>`
  - Dev-only admin token header: `x-admin-token` (user-pasted; never hardcode)

## Non-negotiables / do-not-regress

1) **continueJourney requires uid + fromBatchId**
- Request body MUST include: `{ uid: user.uid, fromBatchId }`
- Must send `Authorization: Bearer <idToken>`

2) **Firestore rejects undefined**
- Never write `undefined` into Firestore payloads.
- Omit the field or use `null` if allowed.

3) **Composite indexes**
- Queries like `(ownerUid == X) AND (isClosed == false) ORDER BY updatedAt desc` can require a composite index.
- If you see “failed-precondition: query requires an index”, create it via the console link.

4) **Safety rails are required**
- Guard double-submit / repeated calls.
- Use ErrorBoundary near top-level UI to prevent blank-screen failures.
- Preserve troubleshooting info (payload, response, status, curl).

## How to change code (delivery format)

- Default to **full-file replacements** when modifying code files.
- Keep changes minimal and localized, but tidy.
- Do not hardcode secrets; `x-admin-token` is always user-provided input.

## Debugging priority order

1) Missing composite Firestore index
2) Undefined value written to Firestore
3) Missing required request fields (uid/fromBatchId)
4) Missing auth or x-admin-token headers
5) Duplicate imports/state vars or stale closures

## Definition of Done (required for every coding response)

1) Files changed or generated (exact filenames)
2) What behavior changed (1–3 bullets)
3) Manual test checklist (short, copyable)
4) Known follow-ups (indexes, deploy order, cache, mobile parity)
