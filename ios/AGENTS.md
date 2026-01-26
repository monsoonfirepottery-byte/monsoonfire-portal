# Monsoon Fire Portal — Agent Guide

This repo ships a React/Vite web portal as a reference implementation for an eventual iOS (Swift/SwiftUI) client. Keep patterns explicit, debuggable, and portable.

## Architecture (high level)

Always use Context7 MCP when you need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.

- web/ — React/Vite client
  - Firebase Auth (Google sign-in)
  - Firestore queries (active + history)
  - Calls Firebase Cloud Functions (HTTP endpoints)
  - Safety rails: ErrorBoundary, in-flight guards, troubleshooting capture, admin token persistence

- functions/ — Firebase Cloud Functions (HTTP)
  - Stateless request/response JSON contracts
  - Authorization: Bearer <idToken>
  - Dev-only admin token header: x-admin-token (user-pasted; never hardcode; stored in localStorage for convenience)

---

## Tooling quick commands

Web dev:
- cd web
- npm install
- npm run dev

Typecheck / lint (if configured):
- npm run typecheck
- npm run lint

Firebase emulators (from repo root or web — depends on your setup):
- firebase emulators:start --only firestore,functions

Deploy:
- firebase deploy --only functions
- firebase deploy --only firestore:rules

---

## Preflight (do this before big edits)

- Confirm Node version matches Vite requirement (or use nvm)
- Confirm firebase-tools version is installed and Java is compatible for emulators
- Confirm you can run web dev server
- Confirm emulators start cleanly (firestore + functions)

---

## Tooling conventions

- Package manager: npm (do not switch to pnpm/yarn without explicit request)
- Formatting: do not run repo-wide formatters unless requested
- Git: keep commits small; no mass renames

---

## Canonical docs and contracts

- API contracts: docs/API_CONTRACTS.md
- Firestore schema notes: docs/SCHEMA_*.md
- Mobile parity notes: docs/MOBILE_PARITY_TODOS.md (if present)

---

## Non-negotiables / do-not-regress / lessons learned

1) continueJourney requires uid + fromBatchId
- Request body MUST include: { uid: user.uid, fromBatchId }
- Must send Authorization: Bearer <idToken>

2) Firestore rejects undefined
- Never write undefined into Firestore payloads
- Omit the field or use null if allowed

3) Composite indexes
- Queries like (ownerUid == X) AND (isClosed == false) ORDER BY updatedAt desc may require a composite index
- If you see “failed-precondition: query requires an index”, create it via the console link

4) Safety rails are required
- Guard double-submit / repeated calls
- Use ErrorBoundary near top-level UI to prevent blank-screen failures
- Preserve troubleshooting info (payload, response, status, curl)

---

## How to change code (credit-smart delivery format)

Goal: spend credits on reasoning and precise edits, not on rewriting files.

### Default: patch-first edits (preferred)

- Prefer minimal diffs over full-file rewrites
- Only change the smallest possible surface area needed
- Keep edits surgical:
  - update 1–3 functions/components at a time
  - avoid reformatting unrelated code
  - do not “cleanup” unless explicitly requested

### When full-file replacement is appropriate

Use a full-file replacement only when:
- the file is small and the change is broad, or
- a refactor touches many scattered sections and a patch would be noisy or risky, or
- the file is already unstable and a clean baseline is safer

### Patch mechanics (Codex CLI friendly)

Use one of:
- unified diffs (git apply style)
- explicit find → replace with unique anchors
- in-place edits showing only the changed hunks

Avoid full rewrites unless the criteria above is met.

### Credit-saving workflow rules

- Read first, then edit: open target files before proposing changes
- Batch related changes in one pass, preferably within one file
- Pick one reasonable implementation; do not generate multiple alternatives
- Preserve working behavior; do not expand scope
- Do not refactor “for cleanliness,” “consistency,” or “future-proofing” unless explicitly requested
- Never hardcode secrets; x-admin-token is always user-provided input

---

## Codex Prompt Template (Credit-Optimized)

Use this structure when invoking Codex (CLI or UI).
It is designed to minimize token usage while maintaining correctness.

### Recommended prompt text

You can paste the following directly into Codex:

You are working in the Monsoon Fire Portal repo.

Constraints:
- Prefer minimal diffs over full-file rewrites
- Do NOT reformat unrelated code
- Do NOT rename variables or restructure unless required
- Read files before editing
- Limit changes to the smallest surface area needed
- Do not open more than 2 files unless necessary to understand the change

Process:
1) Open and read the relevant file(s)
2) State a brief plan (max 5 bullets)
3) Apply the minimal patch needed
4) Preserve all existing working behavior
5) If network or Firestore code is touched:
   - keep in-flight guards
   - keep troubleshooting capture
6) Summarize:
   - files changed
   - behavior changed
   - how to manually test

Output rules:
- Show only changed hunks or diffs
- Avoid full file replacement unless explicitly requested
- Do not generate multiple alternative solutions

### When to override this template

Only override if:
- a full-file replacement is explicitly requested, or
- a large refactor spans many files and patches would be unclear

---

## Stop conditions (ask / halt instead of thrashing)

Stop and report if:
- The change requires touching more than 2 existing files (new files are allowed only if explicitly requested)
- A Firestore index is required (provide the index hint and where it’s triggered)
- You hit auth/permission errors you can’t resolve from repo config
- You cannot find the referenced function/route/schema

---

## Troubleshooting capture format (when network calls change)

Record:
- endpoint + method
- request headers (redact tokens)
- request body (omit secrets)
- response status + body
- curl equivalent (with <TOKEN> placeholders)

---

## Debugging priority order

1) Missing composite Firestore index
2) Undefined value written to Firestore
3) Missing required request fields (uid / fromBatchId)
4) Missing auth or x-admin-token headers
5) Duplicate imports, duplicate state variables, or stale closures

---

## Definition of Done (required for every coding response)

1) Files changed or generated (exact filenames)
2) What behavior changed (1–3 bullets)
3) Manual test checklist (short, copyable)
4) Known follow-ups (indexes, deploy order, cache, mobile parity)

---

## Coordination / File Ownership (anti-collision)

- Claim a file before editing by adding your name/initials + timestamp
- Only one active editor per file
- Prefer new files under web/src/views or web/src/components
- Release claims when merged or done

### Ownership (edit this list)

- web/src/App.tsx: (unclaimed)
- web/src/App.css: (unclaimed)
- web/src/views/ReservationsView.tsx: (unclaimed)
- functions/src/createReservation.ts: (unclaimed)
- docs/API_CONTRACTS.md: (unclaimed)

### Coordination log

- YYYY-MM-DD HH:MM — [agent] claimed [file] for [task]
