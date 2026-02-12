# P2 — Security: Pin GitHub Actions to Immutable Revisions

**Status:** Done

**Problem**
- Some workflows use third-party actions pinned only to a major tag:
  - `.github/workflows/firebase-hosting-merge.yml`: `FirebaseExtended/action-hosting-deploy@v0`
  - `.github/workflows/firebase-hosting-pull-request.yml`: `FirebaseExtended/action-hosting-deploy@v0`
  - `.github/workflows/android-compile.yml`: `android-actions/setup-android@v3`
- Major tags can move, which is a supply-chain risk for CI.

**Tasks**
1. Pin third-party actions to full commit SHAs (or at least to a specific minor/patch tag if SHA pinning is not desired).
2. Keep first-party actions on stable majors (e.g. `actions/checkout@v4`) unless you want SHA pins across the board.
3. Verify workflows still run:
   - PR preview deploy
   - merge deploy
   - android compile

**Acceptance**
- All third-party actions are pinned to immutable refs (SHA preferred).
- Workflows continue to succeed without behavior changes.

**Progress**
- Pinned:
  - `FirebaseExtended/action-hosting-deploy@092436dca3ec6dacb231d965ae56f7ff6c09f258` in Firebase hosting workflows
  - `android-actions/setup-android@9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407` in Android compile workflow
