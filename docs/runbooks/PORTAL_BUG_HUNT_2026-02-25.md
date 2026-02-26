# Portal Bug Hunt - 2026-02-25

Status: In progress  
Owner: Staff + QA + Engineering

## Session Goal

Capture production issues from `portal.monsoonfire.com` with reproducible steps, evidence, severity, and fix status.

## Bug Entry Template

- Bug ID:
- Severity:
- Surface:
- Reported by:
- Reported at (UTC):
- Environment:
- Repro steps:
- Expected:
- Actual:
- Evidence:
- Root cause:
- Fix status:
- Validation checklist:

## Bugs Logged

### BUG-2026-02-25-001 - My Pieces permission error flashes repeatedly

- Severity: P1
- Surface: My Pieces (`web/src/views/MyPiecesView.tsx`)
- Reported by: Monsoon Fire staff account
- Reported at (UTC): 2026-02-25
- Environment: Production (`portal.monsoonfire.com`)

Repro steps:
1. Sign in with staff account.
2. Open `My Pieces`.
3. Observe permission error repeatedly flashing/bouncing.

Expected:
- A single stable error state (or normal data load), no repeated flashing.

Actual:
- Permission error repeatedly clears and reappears.
- Console stack shows repeated Firebase core traffic.

Evidence:
- User-provided repeated stack trace referencing `vendor-firebase-core-q9zIU6UK.js` from production.

Root cause:
- `MyPiecesView` background loaders (`loadPieces`, `loadPieceDetails`) used `isBusy`/`setBusy` state that mutated `inFlight`.
- `isBusy` depends on `inFlight`, so callback identity changed whenever busy flags flipped.
- Those callbacks were included in effect dependencies, causing repeated effect reruns and repeated Firestore reads.

Fix status:
- Mitigated in code on 2026-02-25:
  - Removed busy-key loop coupling from background loaders.
  - Added cancellation guards to avoid stale state updates.
  - Effect dependencies now track query inputs only.

Validation checklist:
- [ ] Re-open `My Pieces` in production and verify error does not flash.
- [ ] If permission is genuinely denied, verify message remains stable (single render path).
- [ ] Verify normal owner account still loads piece list once per filter/window change.
- [ ] Open piece details and confirm no repeated detail-query loop.

Follow-up:
- If stable permission errors persist after this fix, verify auth claims (`staff`) and batch ownership/read rule alignment for affected accounts.

### BUG-2026-02-25-002 - Dashboard "Your pieces" chiplet shows batch initials (example: `T`) instead of piece identities

- Severity: P2
- Surface: Dashboard `Your pieces` chiplet (`web/src/views/DashboardView.tsx`)
- Reported by: Monsoon Fire staff account
- Reported at (UTC): 2026-02-25
- Environment: Production (`portal.monsoonfire.com`)

Repro steps:
1. Sign in and open Dashboard.
2. Observe `Your pieces` chiplet.
3. See one-letter bubble/label (example: `T`) that does not map to a distinct piece code.

Expected:
- Chiplet reflects actual piece-level data (piece code/title/identity), not batch-only labels.

Actual:
- Chiplet renders initials from `active` batch titles, which can appear as single letters (for example `T`).

Evidence:
- User report from production session.
- Code path in `DashboardView` maps `activePreview` from `useBatches(user)` and derives initials via `piece.title`.

Root cause:
- `DashboardView` treats active batches as if they were pieces:
  - `const activePreview = active.slice(...)`
  - bubble label uses `piece.title` (actually batch title)
- The card is titled `Your pieces`, but the underlying dataset is batches from `useBatches`.

Fix status:
- Open (not yet patched in this pass).

Validation checklist:
- [ ] Dashboard chiplet reads from piece-level docs or is relabeled to `Your check-ins` if batch-level data is intentional.
- [ ] Bubble label shows stable piece identity (piece code/description-derived abbreviation).
- [ ] No regressions in `Open My Pieces` navigation and counts.

### BUG-2026-02-25-003 - `My Pieces` hard-fails when any one batch query hits permission denied

- Severity: P1
- Surface: My Pieces list loader (`web/src/views/MyPiecesView.tsx`)
- Reported by: Monsoon Fire staff account
- Reported at (UTC): 2026-02-25
- Environment: Production (`portal.monsoonfire.com`)

Repro steps:
1. Open `My Pieces`.
2. Observe inline error:
   - `Pieces failed: Missing or insufficient permissions.`

Expected:
- One denied batch should not block all piece visibility.
- Page should still render authorized pieces.

Actual:
- A single failing batch/subquery rejects the whole Promise chain and the page shows a hard failure.

Root cause:
- `loadPieces` and `loadPieceDetails` used all-or-nothing `Promise.all`.
- Any permission-denied subquery bubbled to a fatal `piecesError` / `pieceDetailError`.

Fix status:
- Mitigated in production on 2026-02-25:
  - switched loaders to `Promise.allSettled`
  - render partial results for successful queries
  - show stable partial-warning copy instead of full hard fail when possible
  - added auth refresh retry (`user.getIdToken(true)`) when all list reads deny
  - added fallback list query without `orderBy("updatedAt")` when ordered query denies

Validation checklist:
- [ ] `My Pieces` renders available pieces even if one batch is denied.
- [ ] `QA-20260225-*` seeded piece remains visible.
- [ ] Detail panel loads available tabs even when one detail stream is denied.

### BUG-2026-02-26-004 - Partial warnings suppressed visible pieces

- Severity: P1
- Surface: My Pieces list render path (`web/src/views/MyPiecesView.tsx`)
- Reported by: QA regression test authoring session
- Reported at (UTC): 2026-02-26
- Environment: Local + Production risk

Repro steps:
1. Have at least one readable batch and one denied batch.
2. Open `My Pieces`.
3. Observe partial warning rendered.

Expected:
- Keep showing readable pieces.
- Show warning as non-fatal context.

Actual:
- Any non-empty `piecesError` rendered a blocking inline alert branch.
- Piece rows were hidden even when `setPieces` had successful rows.

Root cause:
- Loader used one shared `piecesError` string for both fatal and non-fatal states.
- Render branch prioritized `piecesError` over `visiblePieces`, masking partial success.

Fix status:
- Mitigated in production on 2026-02-26:
  - introduced `piecesWarning` (non-fatal) separate from `piecesError` (fatal)
  - render warning above list while preserving piece rows
  - keep fatal branch for true all-fail conditions only

Validation checklist:
- [ ] With mixed permission outcomes, warning appears and readable pieces remain visible.
- [ ] Fatal all-fail still shows `Pieces failed: ...`.

### BUG-2026-02-26-005 - Firestore rules release drift (`cloud.firestore` vs `cloud.firestore/default`)

- Severity: P1
- Surface: Firestore auth/rules deployment (`firebaserules.googleapis.com` releases)
- Reported by: Engineering virtual staff probe
- Reported at (UTC): 2026-02-26
- Environment: Production (`portal.monsoonfire.com`, project `monsoonfire-portal`)

Repro steps:
1. Mint ID token for dedicated staff bot account.
2. Create batch via `createBatch` function (succeeds).
3. Attempt Firestore `POST/GET/LIST` on `batches/{batchId}/pieces/*`.
4. Observe `403 PERMISSION_DENIED`.

Expected:
- If current `firestore.rules` allows piece reads/writes for signed-in/authorized users, piece subtree checks should pass.

Actual:
- Batch reads passed, but all piece subtree reads/writes returned `Missing or insufficient permissions`.

Root cause:
- Rules deploy updated release `projects/monsoonfire-portal/releases/cloud.firestore/default`.
- Legacy release `projects/monsoonfire-portal/releases/cloud.firestore` remained pinned to an older ruleset (2026-01-02).
- Runtime evaluation for this surface followed the stale release, so piece rules in current `firestore.rules` were not active.

Fix status:
- Mitigated in production on 2026-02-26:
  - patched `cloud.firestore` release to the same ruleset as `cloud.firestore/default`.
  - added guard script `scripts/sync-firestore-rules-releases.mjs`.
  - added smoke probe `scripts/check-portal-mypieces-authz.mjs`.
  - extended portal smoke (`scripts/portal-playwright-smoke.mjs`) to exercise `My Pieces` and fail on blocking permission errors.

Validation checklist:
- [ ] `npm run firestore:rules:sync:check` returns in-sync.
- [ ] `npm run portal:mypieces:authz:check` returns passed.
- [ ] Authenticated portal smoke includes `My Pieces` and no `Pieces failed:` blocking error.

### BUG-2026-02-26-006 - Messages query hard-fails on missing composite index

- Severity: P1
- Surface: Messages (`web/src/App.tsx`, direct threads query)
- Reported by: Staff QA
- Reported at (UTC): 2026-02-26
- Environment: Production (`portal.monsoonfire.com`)

Repro steps:
1. Sign in.
2. Open Messages.
3. Observe `Direct messages failed: The query requires an index ... (failed-precondition)`.

Expected:
- Messages inbox loads without blocking errors.

Actual:
- Direct message list fails when Firestore composite index is missing/not ready.

Evidence:
- Console/runtime error with Firestore index creation link for `directMessages`.

Root cause:
- Ordered `directMessages` query (`participantUids array-contains` + `orderBy(lastMessageAt desc)`) depends on a composite index.
- If index is absent or still building, the UI surfaced a blocking error and no fallback path existed.

Fix status:
- Mitigated in code on 2026-02-26:
  - Added no-index fallback in `useDirectMessages`:
    - retry query without `orderBy`
    - sort results client-side by `lastMessageAt`
    - cap list to latest 50 rows
  - Triggered production `firestore:indexes` deploy to provision required index.

Validation checklist:
- [ ] Open Messages and verify no blocking `requires an index` error.
- [ ] Confirm direct message rows render in newest-first order.
- [ ] Once index is ready, confirm primary ordered query path resumes with no fallback dependency.

### BUG-2026-02-26-007 - Dashboard studio updates did not load until Messages view was opened

- Severity: P1
- Surface: Dashboard announcements chiplet (`web/src/App.tsx`, `web/src/views/DashboardView.tsx`)
- Reported by: Staff QA
- Reported at (UTC): 2026-02-26
- Environment: Production (`portal.monsoonfire.com`)

Repro steps:
1. Seed a new announcement.
2. Open Dashboard directly after sign-in.
3. Observe `Studio updates` chiplet remains empty.

Expected:
- Dashboard should load and display latest announcements without needing a Messages page visit.

Actual:
- Announcements fetch was disabled outside `messages` nav state, leaving dashboard stale/empty.

Root cause:
- `shouldLoadAnnouncements` was gated to `nav === "messages"` only.

Fix status:
- Mitigated in code on 2026-02-26:
  - load announcements for `dashboard` and `messages` nav states.
  - aligned direct messages preload for dashboard preview as well.

Validation checklist:
- [ ] Refresh Dashboard and verify seeded QA announcement appears in `Studio updates`.
- [ ] Confirm Messages still shows the same announcement list and unread behavior.

### BUG-2026-02-26-008 - Notifications mark-read can fail with permission denied in production

- Severity: P1
- Surface: Notifications (`web/src/views/NotificationsView.tsx`, Firestore rules)
- Reported by: Staff QA (incognito Chrome)
- Reported at (UTC): 2026-02-26
- Environment: Production (`portal.monsoonfire.com`)

Repro steps:
1. Sign in and open Notifications.
2. Click `Mark read` on an unread item.
3. Observe `Mark read failed: Missing or insufficient permissions.`

Expected:
- Mark-read should succeed for the signed-in owner and update unread state immediately.

Actual:
- Some sessions hit Firestore permission-denied on direct document update.

Root cause:
- Client relied solely on direct Firestore `updateDoc` for `readAt`.
- Any transient/strict rule mismatch path caused user-visible failure with no fallback mutation path.

Fix status:
- Mitigated in code on 2026-02-26:
  - Added `/v1/notifications.markRead` route in `apiV1` for authenticated owner/staff-safe update.
  - Notifications UI now falls back to API mark-read when direct Firestore write is denied.
  - Hardened `users/{uid}/notifications` update rule to allow `readAt` and optional `updatedAt` affected keys.

Validation checklist:
- [ ] In production, mark unread notification as read from Notifications page and confirm success toast.
- [ ] Confirm unread counter decrements immediately.
- [ ] Confirm no `Missing or insufficient permissions` alert for normal owner flow.

### BUG-2026-02-26-009 - Check-ins page can hard-fail when reservations query index is missing

- Severity: P1
- Surface: Check-ins / Reservations (`web/src/views/ReservationsView.tsx`, `functions/src/apiV1.ts`)
- Reported by: Staff QA (incognito Chrome)
- Reported at (UTC): 2026-02-26
- Environment: Production (`portal.monsoonfire.com`)

Repro steps:
1. Open Check-ins page.
2. Trigger reservations list load for owner.
3. Observe `Check-ins failed: The query requires an index ...`.

Expected:
- Check-ins list should load even while composite indexes are building.

Actual:
- Ordered query path could hard-fail on missing index.

Root cause:
- Query shape (`ownerUid == ...` + `orderBy(createdAt desc)`) requires composite index.
- No client/server fallback for missing-index condition in this surface.

Fix status:
- Mitigated in code on 2026-02-26:
  - Added client fallback in `ReservationsView` to retry owner-only query without `orderBy`, then sort client-side.
  - Added backend fallback for `/v1/reservations.list` to retry without `orderBy` and sort server-side.

Validation checklist:
- [ ] Open Check-ins page and confirm list renders without index error banner.
- [ ] Confirm items still appear newest-first.
- [ ] Verify behavior remains stable while index build is pending.

### BUG-2026-02-26-010 - Check-in form regressed to an overly long default layout

- Severity: P2
- Surface: Check-ins / Reservations form UX (`web/src/views/ReservationsView.tsx`, `web/src/views/ReservationsView.css`)
- Reported by: Staff QA (incognito Chrome)
- Reported at (UTC): 2026-02-26
- Environment: Production (`portal.monsoonfire.com`)

Repro steps:
1. Open Check-ins page.
2. Start a new check-in.
3. Observe long form with many optional sections expanded by default.

Expected:
- Core path should be short and scannable; optional sections should stay out of the way.

Actual:
- Optional content creates a long default scroll and higher completion friction.

Root cause:
- Optional sections (photo, extras, piece rows, notes) rendered fully expanded in the default form flow.

Fix status:
- Mitigated in code on 2026-02-26:
  - Converted optional sections into collapsed `<details>` blocks by default.
  - Added clear Show/Hide affordance for optional sections.

Validation checklist:
- [ ] Open Check-ins form and confirm optional sections are collapsed by default.
- [ ] Expand each optional section and verify inputs still work and persist into submission payload.
- [ ] Validate both light and dark themes for readability/affordance.
