# Monsoon Fire Portal Cost Controls (Phase 0 + Phase 1)

## What changed

- Added idempotent backend bootstrap endpoint:
  - `functions/src/ensureUserDoc.ts`
  - Creates `users/{uid}` and `profiles/{uid}` only when missing.
  - Never overwrites existing docs.
- Wired bootstrap into app auth flow:
  - `web/src/api/ensureUserDoc.ts`
  - `web/src/App.tsx`
  - Runs once per session with in-memory + `localStorage` dedupe (`bootstrapped:<uid>:<projectId>`).
- Added lightweight Firestore telemetry:
  - `web/src/lib/firestoreTelemetry.ts`
  - `web/src/components/FirestoreTelemetryPanel.tsx`
  - `web/src/App.tsx` + `web/src/App.css`
- Reduced read amplification in hotspots:
  - `web/src/App.tsx`
    - Startup query gating for `directMessages` and `announcements` (load when `Messages` view is opened).
  - `web/src/views/MessagesView.tsx`
    - Default thread message load: `50`.
    - Incremental "Load older messages" up to `200`.
  - `web/src/views/MyPiecesView.tsx`
    - Batch-window pagination with defaults (`5` batches initially).
    - Per-batch piece query cap (`50` docs).
    - "Load more check-ins" and "Load more pieces" controls.
  - `web/src/views/GlazeBoardView.tsx`
    - Listener query caps (`300` docs) for `comboTiles`, `singleTiles`, `glazes`.
    - Attach-piece flow now bounded to latest `8` batches and `12` pieces per batch.
  - `web/src/views/StaffView.tsx`
    - Removed automatic bootstrap loading of all modules on mount.
    - Added explicit "Load current module" action.

## How to open telemetry panel

- Run portal in dev mode.
- Sign in as normal.
- Open any portal screen.
- Use the bottom-right `Firestore telemetry` panel.
- Panel shows:
  - Current view
  - Last 60s reads/writes/listener reads
  - Session totals
  - Top views by reads
- Session summary also persists to:
  - `localStorage["mf_firestore_telemetry:last"]`

## Known expensive views

- `staff` (especially all-module refresh and broad collection scans)
- `glazes` (listener-heavy and media metadata)
- `pieces` (multi-batch piece detail fetches)
- `messages` (long message thread history)

## Cost-control knobs (safe defaults in code)

- `web/src/views/MessagesView.tsx`
  - `DEFAULT_MESSAGE_FETCH_LIMIT = 50`
  - `MAX_MESSAGE_FETCH_LIMIT = 200`
- `web/src/views/MyPiecesView.tsx`
  - `BATCHES_PAGE_SIZE = 5`
  - `BATCH_PIECES_QUERY_LIMIT = 50`
  - `PIECES_PAGE_SIZE = 25`
- `web/src/views/GlazeBoardView.tsx`
  - `GLAZE_LISTENER_LIMIT = 300`
  - `ATTACH_BATCH_LIMIT = 8`
  - `ATTACH_PIECES_PER_BATCH_LIMIT = 12`

## How to measure improvements

1. Reset telemetry counters in the panel.
2. Record startup baseline on `dashboard` after sign-in (60s reads).
3. Navigate to `messages`, `pieces`, `glazes`, `staff` one at a time and record:
   - last 60s reads
   - session total reads increase
4. Compare against previous baseline captures (same navigation flow).
5. Track at least 3 runs to reduce variance.

## Suggested blob offload trigger (R2) for later

- Keep Firebase Storage for now.
- Revisit R2/offload when **either**:
  - Monthly Storage + egress spend is consistently greater than Firestore spend for 2+ months, or
  - Public/static media exceeds ~`50GB` active with high repeat delivery, or
  - You need long-lived public CDN caching and lower egress costs for non-sensitive assets.
- Do **not** move privileged/private portal uploads without equivalent auth controls and signed URL flow.

## Index follow-ups

- Added index definition for direct message inbox query:
  - Collection: `directMessages`
  - Fields: `participantUids (array-contains)` + `lastMessageAt (desc)`
  - File: `firestore.indexes.json`
- If you still see a Firestore console prompt for a missing index, capture and add the generated URL into this section.
- Known non-index risk to watch:
  - `StaffView` count query uses `where(\"participants\", \"array-contains\", uid)` while thread docs use `participantUids`. If counts look wrong, align this field name in `web/src/views/StaffView.tsx`.

## Emulator reproducibility and telemetry evidence

- Java prerequisite:
  - Current `firebase-tools` in this environment requires Java 21+.
  - Portable runtime used: `~/.local/jre21-portable`.
- Start emulators:
  - `JAVA_HOME=/home/wuff/.local/jre21-portable PATH=/home/wuff/.local/jre21-portable/bin:$PATH firebase emulators:start --config firebase.emulators.local.json --project monsoonfire-portal --only auth,firestore,functions`
- Seed deterministic data:
  - `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 GCLOUD_PROJECT=monsoonfire-portal npm run seed:emulators`
- Capture evidence:
  - `TELEMETRY_OUT_DIR=artifacts/telemetry/after-seed node scripts/capture-telemetry-evidence.mjs`
- Evidence paths:
  - `artifacts/telemetry/after-seed/telemetry-results.md`
  - `artifacts/telemetry/after-seed/telemetry-results.json`
  - `artifacts/telemetry/after-seed/*.png`
  - `artifacts/telemetry/ensureUserDoc-errors.log`

## ensureUserDoc stabilization note

- Symptom:
  - Repeated ensureUserDoc errors/noise during emulator runs.
- Root cause:
  - Previous transaction pattern mixed reads after writes in a single transaction path under repeated bootstrap calls.
- Fix:
  - Idempotent create-only flow with explicit existence checks, strict method handling, and undefined-field stripping.
  - Client bootstrap remains non-blocking and now throttles retries to prevent log spam loops.
- Production safety:
  - `emulatorGrantStaffRole` is emulator-only (`FUNCTIONS_EMULATOR` gate) and unavailable in production.

## Telemetry artifact git policy (Option A)

- Ignored in Git:
  - All files under `artifacts/telemetry/` except the two stable summaries.
  - This includes screenshots (`*.png`, `*.jpg`), logs, and timestamped capture folders.
- Tracked in Git:
  - `artifacts/telemetry/latest-telemetry-results.md`
  - `artifacts/telemetry/latest-telemetry-results.json`
- Why:
  - Keep reviewable telemetry history lightweight and avoid long-term binary bloat in repository history.

### Regenerate telemetry locally

- Capture a fresh run:
  - `TELEMETRY_OUT_DIR=artifacts/telemetry/after-seed-2 node scripts/capture-telemetry-evidence.mjs`

### Promote latest for commit

- `cp artifacts/telemetry/after-seed-2/telemetry-results.md artifacts/telemetry/latest-telemetry-results.md`
- `cp artifacts/telemetry/after-seed-2/telemetry-results.json artifacts/telemetry/latest-telemetry-results.json`
- `git add artifacts/telemetry/latest-telemetry-results.md artifacts/telemetry/latest-telemetry-results.json`
